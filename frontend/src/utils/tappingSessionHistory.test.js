import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTappingSessionHistory } from './tappingSessionHistory.js';

const row = (id, sessionId, uid, event, eventType, second, boxId = 'BOX-1') => ({
  id,
  session_id: sessionId,
  id_box: boxId,
  rfid_uid: uid,
  nama: uid,
  event_text: event,
  event_type: eventType,
  created_at: `2026-10-04 01:00:${String(second).padStart(2, '0')}`
});

const build = history => buildTappingSessionHistory(history, {
  getName: uid => `Name ${uid}`,
  isAdminUid: uid => uid === 'ADMIN'
});

test('history combines all participants and repeated supervisor taps into one session row', () => {
  const sessions = build([
    row(5, 5, 'MECH-1', 'MECHANIC_LOG_OUT', 'OUT', 40),
    row(4, 5, 'MECH-1', 'MECHANIC_LOG_IN', 'IN', 30),
    row(3, 5, 'SPV-1', 'SUPERVISOR_LOCK_IN', 'IN', 20),
    row(2, 4, 'SPV-1', 'SUPERVISOR_LOCK_IN', 'IN', 10),
    row(6, 5, 'SPV-1', 'SUPERVISOR_LOG_OUT', 'OUT', 50)
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].totalPersonel, 2);
  assert.deepEqual(sessions[0].participants.map(person => [person.uid, person.status]), [
    ['SPV-1', 'KELUAR'],
    ['MECH-1', 'KELUAR']
  ]);
  assert.equal(sessions[0].sessionStart, '2026-10-04 01:00:10');
  assert.equal(sessions[0].sessionEnd, '2026-10-04 01:00:50');
  assert.deepEqual(sessions[0].deleteIds, [2, 3, 4, 5, 6]);
});

test('history keeps separate closed sessions and separate boxes apart', () => {
  const sessions = build([
    row(1, 1, 'SPV-1', 'SUPERVISOR_LOCK_IN', 'IN', 0),
    row(2, 1, 'MECH-1', 'MECHANIC_LOG_IN', 'IN', 1),
    row(3, 1, 'SPV-1', 'SUPERVISOR_LOG_OUT', 'OUT', 2),
    row(4, 2, 'SPV-1', 'SUPERVISOR_LOCK_IN', 'IN', 3),
    row(5, 2, 'SPV-1', 'SUPERVISOR_LOG_OUT', 'OUT', 4, 'BOX-2')
  ]);

  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map(session => session.id_box).sort(), ['BOX-1', 'BOX-1', 'BOX-2']);
});

test('history excludes non-person system/admin rows and refueling events', () => {
  const sessions = build([
    row(1, 1, 'ADMIN', 'SUPERVISOR_LOCK_IN', 'IN', 0),
    row(2, 1, 'FUEL-1', 'REFUEL_START', 'IN', 1)
  ]);
  assert.deepEqual(sessions, []);
});

test('supervisor logout closes the session even when a legacy row has no session id', () => {
  const sessions = build([
    row(1, 9, 'SPV-1', 'SUPERVISOR_LOCK_IN', 'IN', 0),
    row(2, null, 'SPV-1', 'SUPERVISOR_LOG_OUT', 'OUT', 1),
    row(3, null, 'SPV-1', 'SUPERVISOR_LOCK_IN', 'IN', 2)
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find(session => session.sessionEnd)?.sessionEnd, '2026-10-04 01:00:01');
});
