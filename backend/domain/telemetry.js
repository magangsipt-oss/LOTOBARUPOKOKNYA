const aliases = { IDLE_READY: 'STATE_IDLE', IDLE: 'STATE_IDLE', WAIT_SPV: 'STATE_WAIT_SPV_IN', WAIT_SPV_IN: 'STATE_WAIT_SPV_IN', SET_QUOTA: 'STATE_SET_MEKANIK_COUNT', MEK_IN: 'STATE_MEKANIK_IN', LOCKED_ACTIVE: 'STATE_LOTO_LOCKED_ACTIVE', CHOOSE_ACT: 'STATE_CHOOSE_ACTION', MEK_OUT: 'STATE_MEKANIK_OUT', SPV_OUT: 'STATE_WAIT_SPV_OUT', MAINT_DONE: 'STATE_MAINTENANCE_DONE', REGISTER: 'STATE_REGISTER_RFID' };
export const normalizeState = state => aliases[state] || (state.startsWith('STATE_') ? state : `STATE_${state}`);
export const eventType = event => ['SUPERVISOR_LOCK_IN', 'MECHANIC_LOG_IN', 'REFUEL_START'].includes(event) ? 'IN' : ['SUPERVISOR_LOG_OUT', 'MECHANIC_LOG_OUT', 'REFUEL_END'].includes(event) ? 'OUT' : 'CHECK';
export const isTap = event => eventType(event) !== 'CHECK';
export function validateTelemetry(body) {
  const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Invalid telemetry');

  // Auto-generate event_id if not provided (ESP32 may not send it)
  if (!body.event_id || typeof body.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.event_id)) {
    body.event_id = `${body.event || 'heartbeat'}-${body.uid || 'system'}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  for (const [key, max] of [['event',100],['uid',50],['state',50],['ip',50],['ssid',100],['lcd0',100],['lcd1',100],['supervisor_uid',50],['active_fuelman',100]]) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > max)) invalid(`Invalid ${key}`);
  }
  for (const [key,max] of [['lat',90],['lng',180]]) if (body[key] != null && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || Math.abs(body[key]) > max)) invalid(`Invalid ${key}`);
  for (const key of ['gps_fix','relay_open','is_online','replay']) if (body[key] != null && ![true,false,0,1].includes(body[key])) invalid(`Invalid ${key}`);
  if (body.queue != null && (!Array.isArray(body.queue) || body.queue.length > 100 || body.queue.some(x => !x || typeof x.uid !== 'string' || x.uid.length > 50 || typeof x.name !== 'string' || x.name.length > 100 || typeof x.role !== 'string' || x.role.length > 50))) invalid('Invalid queue');
  if (body.uptime_ms != null && (!Number.isSafeInteger(body.uptime_ms) || body.uptime_ms < 0)) invalid('Invalid uptime');
  return body;
}
