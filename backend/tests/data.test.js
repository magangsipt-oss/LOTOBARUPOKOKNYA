import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import { recordTelemetry } from '../models/telemetryModel.js';
import CommandModel from '../models/commandModel.js';
import SupervisorModel from '../models/supervisorModel.js';
import { createRequire } from 'node:module';
import { Sequelize } from 'sequelize';
const require = createRequire(import.meta.url);
const originalConnection = pool.getConnection;
const originalQuery = pool.query;
afterEach(()=>{pool.getConnection=originalConnection; pool.query=originalQuery;});
after(()=>pool.end());
function connectionFixture(handle) {
  const state = {commits:0,rollbacks:0,releases:0,queries:[]};
  const c = {
    async beginTransaction(){}, async commit(){state.commits++;}, async rollback(){state.rollbacks++;}, release(){state.releases++;},
    async query(sql,args=[]) { state.queries.push([sql,args]); return handle(sql,args); }
  };
  pool.getConnection=async()=>c;
  return state;
}
const box={ id_box:'box-1',state:'STATE_IDLE',active_session_id:null,session_counter:3,lcd0:'',lcd1:'',relay_open:0,uptime_ms:0,ssid:'test',ip:'127.0.0.1',supervisor_uid:'',active_fuelman:'' };
function telemetryFixture({duplicate=false,failInsert=false}={}) {
  return connectionFixture(sql=>{
    if(sql.startsWith('SELECT * FROM boxes'))return [[box]];
    if(sql.startsWith('SELECT event_id'))return [duplicate?[{event_id:'event-1'}]:[]];
    if(sql.startsWith('SELECT nama'))return [[{nama:'Test'}]];
    if(failInsert && sql.startsWith('INSERT INTO tapping_history'))throw new Error('simulated storage failure');
    return [{affectedRows:1}];
  });
}
test('duplicate telemetry does not rewrite state or append audit/tapping records',async()=>{
  const state=telemetryFixture({duplicate:true});
  assert.deepEqual(await recordTelemetry('box-1',{event_id:'event-1',event:'SUPERVISOR_LOCK_IN',uid:'ABC'}),{duplicate:true});
  assert.equal(state.queries.filter(([s])=>/^(INSERT|UPDATE|DELETE)/.test(s)).length,0);
  assert.equal(state.commits,1);assert.equal(state.releases,1);
});
test('offline replay records evidence without resetting state or opening a new live session',async()=>{
  const state=telemetryFixture();
  await recordTelemetry('box-1',{event_id:'event-1',event:'SUPERVISOR_LOCK_IN',uid:'ABC',replay:true});
  assert.ok(!state.queries.some(([s])=>s.startsWith('UPDATE boxes')));
  const tap=state.queries.find(([s])=>s.startsWith('INSERT INTO tapping_history'));
  assert.equal(tap[1][1],null);assert.equal(state.commits,1);
});
test('offline refueling replay cannot open or close a current refueling session', async () => {
  for (const event of ['REFUEL_START', 'REFUEL_END']) {
    const state = telemetryFixture();
    await recordTelemetry('box-1', { event_id: `offline-${event}`, event, uid: 'FUEL-1', replay: true });
    assert.ok(!state.queries.some(([sql]) => /^(INSERT INTO refueling_logs|UPDATE refueling_logs|UPDATE boxes)/.test(sql)));
    assert.ok(state.queries.some(([sql]) => sql.startsWith('INSERT INTO tapping_history')));
    assert.equal(state.commits, 1);
  }
});
test('GPS without fix preserves coordinates and session start is serialized on the box row',async()=>{
  const state=telemetryFixture();
  const result=await recordTelemetry('box-1',{event_id:'event-1',event:'SUPERVISOR_LOCK_IN',uid:'ABC',gps_fix:false,state:'SET_QUOTA'});
  assert.equal(result.session_id,4);
  assert.match(state.queries[0][0],/FOR UPDATE/);
  const update=state.queries.find(([s])=>s.startsWith('UPDATE boxes SET state'));
  assert.equal(update[1][0],'STATE_SET_MEKANIK_COUNT');
  assert.equal(update[1][3],null);assert.match(update[0],/COALESCE\(\?, lat\)/);
});
test('a failed tapping write rolls back the telemetry and event receipt together',async()=>{
  const state=telemetryFixture({failInsert:true});
  await assert.rejects(recordTelemetry('box-1',{event_id:'event-1',event:'MECHANIC_LOG_IN',uid:'ABC'}),/storage failure/);
  assert.equal(state.commits,0);assert.equal(state.rollbacks,1);assert.equal(state.releases,1);
});
test('acknowledging command A leaves newer command B pending',async()=>{
  const commands=[{id:'A',box:'box-1',ack:false},{id:'B',box:'box-1',ack:false}];
  pool.query=async(sql,[idBox,id])=>{
    assert.match(sql,/WHERE id_box = \? AND id = \?/);
    const command=commands.find(c=>c.id===id && c.box===idBox);
    if(command)command.ack=true;
    return [{affectedRows:command?1:0}];
  };
  assert.equal(await CommandModel.clearPendingCommand('box-1','A'),true);
  assert.equal(commands[1].ack,false);
  assert.equal(await CommandModel.clearPendingCommand('box-2','B'),false);
});
test('queuing two commands creates independent records, never overwrites a pending slot',async()=>{
  const state=connectionFixture(sql=>sql.startsWith('SELECT id_box')?[[{id_box:'box-1'}]]:sql.startsWith('SELECT id FROM')?[[]]:[{affectedRows:1}]);
  const a=await CommandModel.setCommand('box-1','SYNC_USERS');
  const b=await CommandModel.setCommand('box-1','SYNC_USERS');
  assert.notEqual(a,b);assert.equal(state.queries.filter(([s])=>s.startsWith('INSERT INTO device_commands')).length,2);
});
test('invalid mechanic cannot erase the existing team',async()=>{
  const state=connectionFixture((sql,args)=>{
    if(sql.startsWith('SELECT id_box'))return [[{id_box:'box-1'}]];
    if(sql.startsWith('SELECT role'))return [[{role:args[0]==='supervisor'?'PENGAWAS':'ADMIN'}]];
    return [{affectedRows:1}];
  });
  await assert.rejects(SupervisorModel.replaceTeam('supervisor','box-1',['not-mechanic'],'Mekanikal'),/Mekanik tidak valid/);
  assert.ok(!state.queries.some(([s])=>s.startsWith('DELETE')));assert.equal(state.rollbacks,1);
});
test('team replacement failure rolls back rather than leaving a partially saved team',async()=>{
  const state=connectionFixture((sql,args)=>{
    if(sql.startsWith('SELECT id_box'))return [[{id_box:'box-1'}]];
    if(sql.startsWith('SELECT role'))return [[{role:args[0]==='supervisor'?'PENGAWAS':'WORKER'}]];
    if(sql.startsWith('INSERT INTO supervisor'))throw new Error('storage unavailable');
    return [{affectedRows:1}];
  });
  await assert.rejects(SupervisorModel.replaceTeam('supervisor','box-1',['mechanic'],'Mekanikal'),/storage unavailable/);
  assert.equal(state.rollbacks,1);assert.equal(state.commits,0);
});
test('hardening migration includes durable sessions, event deduplication and command identities',async()=>{
  const tables=new Map();const columns=[];
  const q={createTable:async(name,fields)=>tables.set(name,fields),addIndex:async()=>{},addColumn:async(table,name)=>columns.push(`${table}.${name}`),changeColumn:async()=>{},describeTable:async()=>({}),sequelize:{query:async()=>{}}};
  await require('../migrations/20260908-production-hardening.cjs').up(q,Sequelize);
  assert.ok(tables.get('web_sessions').token_hash.primaryKey);
  assert.ok(tables.get('device_events').event_id.primaryKey);
  assert.ok(tables.get('device_commands').acknowledged_at);
  assert.ok(columns.includes('boxes.active_session_id'));
});

test('deleting a user revokes sessions before the account can be recreated', async () => {
  const { default: UserModel } = await import('../models/userModel.js');
  const state = connectionFixture(sql => {
    if (sql.includes("UPPER(role) = 'ADMIN'")) return [[{ sid: 'admin' }]];
    if (sql.startsWith('SELECT sid, rfid_uid')) return [[{ sid: 'worker', role: 'WORKER', rfid_uid: 'ABC' }]];
    if (sql.startsWith('SELECT')) return [[]];
    return [{ affectedRows: 1 }];
  });
  assert.equal(await UserModel.delete('worker'), true);
  const queries = state.queries.map(([sql]) => sql);
  assert.ok(queries.indexOf('DELETE FROM web_sessions WHERE sid = ?') < queries.indexOf('DELETE FROM users WHERE sid = ?'));
  assert.equal(state.commits, 1);
});
test('last administrator cannot be deleted', async () => {
  const { default: UserModel } = await import('../models/userModel.js');
  const state = connectionFixture(sql => sql.includes("UPPER(role) = 'ADMIN'") ? [[{ sid: 'admin' }]] : [[{ sid: 'admin', role: 'ADMIN' }]]);
  await assert.rejects(UserModel.delete('admin'), /Administrator terakhir/);
  assert.equal(state.rollbacks, 1);
});
