const aliases = { IDLE_READY: 'STATE_IDLE', IDLE: 'STATE_IDLE', WAIT_SPV: 'STATE_WAIT_SPV_IN', WAIT_SPV_IN: 'STATE_WAIT_SPV_IN', SET_QUOTA: 'STATE_SET_MEKANIK_COUNT', MEK_IN: 'STATE_MEKANIK_IN', LOCKED_ACTIVE: 'STATE_LOTO_LOCKED_ACTIVE', CHOOSE_ACT: 'STATE_CHOOSE_ACTION', MEK_OUT: 'STATE_MEKANIK_OUT', SPV_OUT: 'STATE_WAIT_SPV_OUT', SPV_OUT_CONFIRM: 'STATE_SPV_OUT_CONFIRM', MAINT_DONE: 'STATE_MAINTENANCE_DONE', REGISTER: 'STATE_REGISTER_RFID', WORKER_LIST: 'STATE_WORKER_LIST', WORKER_DETAIL: 'STATE_WORKER_DETAIL', RFID_DETECTED: 'STATE_RFID_DETECTED', RFID_VALID: 'STATE_RFID_VALID', MENU: 'STATE_MENU', EVENT_LOG: 'STATE_EVENT_LOG', LOGOUT_DENIED: 'STATE_LOGOUT_DENIED', STACK_STATUS: 'STATE_STACK_STATUS', SERVER_OFFLINE: 'STATE_SERVER_OFFLINE', SYSTEM_ERROR: 'STATE_SYSTEM_ERROR', INITIALIZING: 'STATE_INITIALIZING', CONNECTING: 'STATE_CONNECTING', SHOW_IP: 'STATE_SHOW_IP', SYSTEM_READY: 'STATE_SYSTEM_READY', COUNTDOWN: 'STATE_COUNTDOWN', SUPERVISOR_VALID: 'STATE_SUPERVISOR_VALID', MECHANIC_VALID: 'STATE_MECHANIC_VALID', ALL_WORKERS_REGISTERED: 'STATE_ALL_WORKERS_REGISTERED', LOGOUT_SUCCESS: 'STATE_LOGOUT_SUCCESS', ALL_WORKERS_OUT: 'STATE_ALL_WORKERS_OUT', UNLOCKING: 'STATE_UNLOCKING', SYSTEM_READY_FINAL: 'STATE_SYSTEM_READY_FINAL', WELCOME: 'STATE_WELCOME', BOOT_IP: 'STATE_BOOT_IP', START_CONFIRM: 'STATE_START_CONFIRM', MEKANIK_IN: 'STATE_MEKANIK_IN', MEKANIK_OUT: 'STATE_MEKANIK_OUT', REGISTER_RFID: 'STATE_REGISTER_RFID' };
export const normalizeState = state => aliases[state] || (state.startsWith('STATE_') ? state : `STATE_${state}`);
export const eventType = event => ['SUPERVISOR_LOCK_IN', 'MECHANIC_LOG_IN', 'REFUEL_START'].includes(event) ? 'IN' : ['SUPERVISOR_LOG_OUT', 'MECHANIC_LOG_OUT', 'REFUEL_END'].includes(event) ? 'OUT' : 'CHECK';
export const isTap = event => eventType(event) !== 'CHECK';
export function validateTelemetry(body) {
  const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Invalid telemetry');

  // Retries must retain the device's event identity for deduplication.
  if (typeof body.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.event_id)) invalid('Invalid event_id');

  for (const [key, max] of [['event',100],['uid',50],['state',50],['ip',50],['ssid',100],['lcd0',100],['lcd1',100],['supervisor_uid',50],['active_fuelman',100]]) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > max)) invalid(`Invalid ${key}`);
  }
  for (const [key,max] of [['lat',90],['lng',180]]) if (body[key] != null && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || Math.abs(body[key]) > max)) invalid(`Invalid ${key}`);
  for (const key of ['gps_fix','relay_open','is_online','replay']) if (body[key] != null && ![true,false,0,1].includes(body[key])) invalid(`Invalid ${key}`);
  if (body.gps_fix && (body.lat == null || body.lng == null)) invalid('GPS fix requires lat and lng');
  if (body.queue != null && (!Array.isArray(body.queue) || body.queue.length > 100 || body.queue.some(x => !x || typeof x.uid !== 'string' || x.uid.length > 50 || typeof x.name !== 'string' || x.name.length > 100 || typeof x.role !== 'string' || x.role.length > 50))) invalid('Invalid queue');
  if (body.uptime_ms != null && (!Number.isSafeInteger(body.uptime_ms) || body.uptime_ms < 0)) invalid('Invalid uptime');
  return body;
}
