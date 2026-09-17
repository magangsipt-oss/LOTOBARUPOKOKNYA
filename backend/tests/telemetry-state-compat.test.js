import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, validateTelemetry, eventType, isTap } from '../domain/telemetry.js';

// ============================================================================
// ESP32 stateToString() output vs backend aliases — full coverage
// ============================================================================
const ESP32_STATES = [
  'BOOT_IP', 'IDLE_READY', 'START_CONFIRM', 'WAIT_SPV', 'SET_QUOTA',
  'MEK_IN', 'LOCKED_ACTIVE', 'CHOOSE_ACT', 'MEK_OUT', 'SPV_OUT',
  'SPV_OUT_CONFIRM', 'MAINT_DONE', 'REGISTER', 'WORKER_LIST', 'WORKER_DETAIL',
  'RFID_DETECTED', 'RFID_VALID', 'MENU', 'EVENT_LOG', 'LOGOUT_DENIED',
  'STACK_STATUS', 'SERVER_OFFLINE', 'SYSTEM_ERROR', 'INITIALIZING',
  'CONNECTING', 'SHOW_IP', 'SYSTEM_READY', 'COUNTDOWN', 'SUPERVISOR_VALID',
  'MECHANIC_VALID', 'ALL_WORKERS_REGISTERED', 'LOGOUT_SUCCESS', 'ALL_WORKERS_OUT',
  'UNLOCKING', 'SYSTEM_READY_FINAL', 'WELCOME'
];

const EXPECTED_BACKEND_STATES = {
  BOOT_IP: 'STATE_BOOT_IP',
  IDLE_READY: 'STATE_IDLE',
  START_CONFIRM: 'STATE_START_CONFIRM',
  WAIT_SPV: 'STATE_WAIT_SPV_IN',
  SET_QUOTA: 'STATE_SET_MEKANIK_COUNT',
  MEK_IN: 'STATE_MEKANIK_IN',
  LOCKED_ACTIVE: 'STATE_LOTO_LOCKED_ACTIVE',
  CHOOSE_ACT: 'STATE_CHOOSE_ACTION',
  MEK_OUT: 'STATE_MEKANIK_OUT',
  SPV_OUT: 'STATE_WAIT_SPV_OUT',
  SPV_OUT_CONFIRM: 'STATE_SPV_OUT_CONFIRM',
  MAINT_DONE: 'STATE_MAINTENANCE_DONE',
  REGISTER: 'STATE_REGISTER_RFID',
  WORKER_LIST: 'STATE_WORKER_LIST',
  WORKER_DETAIL: 'STATE_WORKER_DETAIL',
  RFID_DETECTED: 'STATE_RFID_DETECTED',
  RFID_VALID: 'STATE_RFID_VALID',
  MENU: 'STATE_MENU',
  EVENT_LOG: 'STATE_EVENT_LOG',
  LOGOUT_DENIED: 'STATE_LOGOUT_DENIED',
  STACK_STATUS: 'STATE_STACK_STATUS',
  SERVER_OFFLINE: 'STATE_SERVER_OFFLINE',
  SYSTEM_ERROR: 'STATE_SYSTEM_ERROR',
  INITIALIZING: 'STATE_INITIALIZING',
  CONNECTING: 'STATE_CONNECTING',
  SHOW_IP: 'STATE_SHOW_IP',
  SYSTEM_READY: 'STATE_SYSTEM_READY',
  COUNTDOWN: 'STATE_COUNTDOWN',
  SUPERVISOR_VALID: 'STATE_SUPERVISOR_VALID',
  MECHANIC_VALID: 'STATE_MECHANIC_VALID',
  ALL_WORKERS_REGISTERED: 'STATE_ALL_WORKERS_REGISTERED',
  LOGOUT_SUCCESS: 'STATE_LOGOUT_SUCCESS',
  ALL_WORKERS_OUT: 'STATE_ALL_WORKERS_OUT',
  UNLOCKING: 'STATE_UNLOCKING',
  SYSTEM_READY_FINAL: 'STATE_SYSTEM_READY_FINAL',
  WELCOME: 'STATE_WELCOME'
};

test('every ESP32 state string normalizes to expected backend state', () => {
  for (const espState of ESP32_STATES) {
    const normalized = normalizeState(espState);
    assert.equal(normalized, EXPECTED_BACKEND_STATES[espState],
      `ESP32 state "${espState}" normalized to "${normalized}", expected "${EXPECTED_BACKEND_STATES[espState]}"`);
  }
});

test('normalizeState handles STATE_ prefix passthrough', () => {
  assert.equal(normalizeState('STATE_IDLE'), 'STATE_IDLE');
  assert.equal(normalizeState('STATE_WAIT_SPV_IN'), 'STATE_WAIT_SPV_IN');
  assert.equal(normalizeState('STATE_MAINTENANCE_DONE'), 'STATE_MAINTENANCE_DONE');
});

test('normalizeState adds STATE_ prefix to unknown bare names', () => {
  assert.equal(normalizeState('SOME_NEW_STATE'), 'STATE_SOME_NEW_STATE');
  assert.equal(normalizeState('CUSTOM'), 'STATE_CUSTOM');
});

// ============================================================================
// Telemetry body field validation — ESP32 payload shape
// ============================================================================
const ESP32_TELEMETRY_SAMPLES = [
  {
    desc: 'heartbeat without GPS',
    body: {
      event_id: 'evt-abc123-def456-ghi789-jkl012',
      id_box: 'BOX ELOTO 1',
      event: 'HEARTBEAT_SYNC',
      uid: 'SYSTEM',
      last_uid: '---',
      is_tap: 0,
      is_register_scan: 0,
      ip: '192.168.1.100',
      ssid: 'vivoV29',
      lat: null,
      lon: null,
      lng: null,
      gps_fix: false,
      state: 'IDLE_READY',
      lcd0: 'TUNGGU PENGAWAS',
      lcd1: '',
      relay_open: 0,
      supervisor_uid: '',
      active_fuelman: '',
      uptime_ms: 123456,
      is_online: 1,
      queue: []
    }
  },
  {
    desc: 'supervisor lock-in with GPS and queue',
    body: {
      event_id: 'evt-abcd1234efgh5678ijkl9012mnop3456',
      id_box: 'BOX ELOTO 1',
      event: 'SUPERVISOR_LOCK_IN',
      uid: '9D88FA1200',
      last_uid: '9D88FA1200',
      is_tap: 1,
      is_register_scan: 0,
      ip: '192.168.1.100',
      ssid: 'vivoV29',
      lat: -6.123456,
      lon: 106.123456,
      lng: 106.123456,
      gps_fix: true,
      state: 'SUPERVISOR_VALID',
      lcd0: 'PENGAWAS VERIFIED',
      lcd1: 'Budi Santoso',
      relay_open: 0,
      supervisor_uid: '9D88FA1200',
      active_fuelman: '',
      uptime_ms: 200000,
      is_online: 1,
      queue: [
        { uid: '9D88FA1200', name: 'Budi Santoso', role: 'PENGAWAS' }
      ]
    }
  },
  {
    desc: 'mechanic log-in',
    body: {
      event_id: 'evt-11112222333344445555666677778888',
      id_box: 'BOX ELOTO 1',
      event: 'MECHANIC_LOG_IN',
      uid: '1A2B3C4D5E',
      last_uid: '1A2B3C4D5E',
      is_tap: 1,
      is_register_scan: 0,
      ip: '192.168.1.100',
      ssid: 'vivoV29',
      lat: -6.123456,
      lon: 106.123456,
      lng: 106.123456,
      gps_fix: true,
      state: 'MEK_IN',
      lcd0: 'MEKANIK MASUK',
      lcd1: 'Agus Prayitno',
      relay_open: 0,
      supervisor_uid: '9D88FA1200',
      active_fuelman: '',
      uptime_ms: 250000,
      is_online: 1,
      queue: [
        { uid: '9D88FA1200', name: 'Budi Santoso', role: 'PENGAWAS' },
        { uid: '1A2B3C4D5E', name: 'Agus Prayitno', role: 'MEKANIK' }
      ]
    }
  },
  {
    desc: 'refuel start',
    body: {
      event_id: 'evt-aabbccdd112233445566778899001122',
      id_box: 'BOX ELOTO 1',
      event: 'REFUEL_START',
      uid: 'FF00112233',
      last_uid: 'FF00112233',
      is_tap: 1,
      is_register_scan: 0,
      ip: '192.168.1.100',
      ssid: 'vivoV29',
      lat: -6.123456,
      lon: 106.123456,
      lng: 106.123456,
      gps_fix: true,
      state: 'LOCKED_ACTIVE',
      lcd0: 'PENGISIAN BBM',
      lcd1: 'Fuelman On Duty',
      relay_open: 0,
      supervisor_uid: '9D88FA1200',
      active_fuelman: 'FF00112233',
      uptime_ms: 300000,
      is_online: 1,
      queue: [
        { uid: '9D88FA1200', name: 'Budi Santoso', role: 'PENGAWAS' },
        { uid: '1A2B3C4D5E', name: 'Agus Prayitno', role: 'MEKANIK' }
      ]
    }
  },
  {
    desc: 'offline replay payload',
    body: {
      event_id: 'evt-ffeeddccbbaa99887766554433221100',
      id_box: 'BOX ELOTO 1',
      event: 'MECHANIC_LOG_OUT',
      uid: '1A2B3C4D5E',
      replay: true,
      gps_fix: true,
      lat: -6.123456,
      lng: 106.123456
    }
  }
];

test('all ESP32 telemetry payload shapes pass validateTelemetry', () => {
  for (const sample of ESP32_TELEMETRY_SAMPLES) {
    assert.doesNotThrow(() => validateTelemetry(sample.body),
      `Payload "${sample.desc}" should pass validation`);
  }
});

// ============================================================================
// Event type classification
// ============================================================================
test('eventType maps ESP32 events correctly', () => {
  const inEvents = ['SUPERVISOR_LOCK_IN', 'MECHANIC_LOG_IN', 'REFUEL_START'];
  const outEvents = ['SUPERVISOR_LOG_OUT', 'MECHANIC_LOG_OUT', 'REFUEL_END'];
  const checkEvents = ['HEARTBEAT_SYNC', 'REGISTER_NEW_CARD', 'GPS_FIX_LOCKED',
    'WIFI_CONNECTED', 'SCAN_REJECTED_UNREGISTERED', 'SCAN_REJECTED_DUPLICATE',
    'SCAN_REJECTED_NOT_SPV', 'SESSION_CLOSED_NORMAL', 'HARDWARE_HARD_RESET'];

  for (const ev of inEvents) assert.equal(eventType(ev), 'IN', `${ev} should be IN`);
  for (const ev of outEvents) assert.equal(eventType(ev), 'OUT', `${ev} should be OUT`);
  for (const ev of checkEvents) assert.equal(eventType(ev), 'CHECK', `${ev} should be CHECK`);
});

test('isTap returns true for IN/OUT events, false for CHECK', () => {
  assert.equal(isTap('SUPERVISOR_LOCK_IN'), true);
  assert.equal(isTap('MECHANIC_LOG_OUT'), true);
  assert.equal(isTap('REFUEL_START'), true);
  assert.equal(isTap('REFUEL_END'), true);
  assert.equal(isTap('HEARTBEAT_SYNC'), false);
  assert.equal(isTap('REGISTER_NEW_CARD'), false);
  assert.equal(isTap('GPS_FIX_LOCKED'), false);
});

// ============================================================================
// GPS field handling — lon vs lng
// ============================================================================
test('validateTelemetry accepts both lon and lng fields from ESP32', () => {
  const withLng = { event_id: 'evt-gps-lng', gps_fix: true, lat: -6.123, lng: 106.456 };
  const withLon = { event_id: 'evt-gps-lon', gps_fix: true, lat: -6.123, lng: 106.456, lon: 106.456 };
  assert.doesNotThrow(() => validateTelemetry(withLng));
  assert.doesNotThrow(() => validateTelemetry(withLon));
});

test('validateTelemetry rejects GPS fix without lat/lng', () => {
  assert.throws(() => validateTelemetry({ event_id: 'evt-no-gps', gps_fix: true }), /GPS fix/);
  assert.throws(() => validateTelemetry({ event_id: 'evt-no-lat', gps_fix: true, lat: -6.0, lng: null }), /GPS fix/);
  assert.throws(() => validateTelemetry({ event_id: 'evt-no-lng', gps_fix: true, lat: null, lng: 106.0 }), /GPS fix/);
});

// ============================================================================
// Queue validation — ESP32 sends full queue each heartbeat
// ============================================================================
test('validateTelemetry accepts ESP32 queue format', () => {
  const body = {
    event_id: 'evt-queue-test',
    queue: [
      { uid: '9D88FA1200', name: 'Budi Santoso', role: 'PENGAWAS' },
      { uid: '1A2B3C4D5E', name: 'Agus Prayitno', role: 'MEKANIK' }
    ]
  };
  assert.doesNotThrow(() => validateTelemetry(body));
});

test('validateTelemetry rejects oversized queue from ESP32', () => {
  const body = {
    event_id: 'evt-queue-overflow',
    queue: Array.from({ length: 101 }, (_, i) => ({
      uid: `USER${i}`.padEnd(10, '0'),
      name: `Worker ${i}`,
      role: 'MEKANIK'
    }))
  };
  assert.throws(() => validateTelemetry(body), /queue/);
});

test('validateTelemetry rejects malformed queue entries', () => {
  // missing role (undefined type)
  assert.throws(() => validateTelemetry({ event_id: 'evt-bq1', queue: [{ uid: 'ABC', name: 'X' }] }), /queue/);
  // name too long
  assert.throws(() => validateTelemetry({ event_id: 'evt-bq2', queue: [{ uid: 'ABC', name: 'X'.repeat(101), role: 'MEKANIK' }] }), /queue/);
  // role too long
  assert.throws(() => validateTelemetry({ event_id: 'evt-bq3', queue: [{ uid: 'ABC', name: 'OK', role: 'X'.repeat(51) }] }), /queue/);
  // uid too long
  assert.throws(() => validateTelemetry({ event_id: 'evt-bq4', queue: [{ uid: 'X'.repeat(51), name: 'OK', role: 'MEKANIK' }] }), /queue/);
  // not an array
  assert.throws(() => validateTelemetry({ event_id: 'evt-bq5', queue: 'bad' }), /queue/);
  // queue entry is null
  assert.throws(() => validateTelemetry({ event_id: 'evt-bq6', queue: [null] }), /queue/);
});

// ============================================================================
// Edge cases — replay flag, numeric vs boolean
// ============================================================================
test('validateTelemetry accepts replay flag as boolean or number', () => {
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-r1', replay: true }));
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-r2', replay: 1 }));
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-r3', replay: false }));
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-r4', replay: 0 }));
  assert.throws(() => validateTelemetry({ event_id: 'evt-r5', replay: 'yes' }), /replay/);
});

test('validateTelemetry accepts relay_open as boolean or number', () => {
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-rel1', relay_open: true }));
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-rel2', relay_open: 0 }));
  assert.throws(() => validateTelemetry({ event_id: 'evt-rel3', relay_open: 'false' }), /relay/);
});

test('validateTelemetry accepts uptime_ms from ESP32', () => {
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-up1', uptime_ms: 0 }));
  assert.doesNotThrow(() => validateTelemetry({ event_id: 'evt-up2', uptime_ms: 86400000 }));
  assert.throws(() => validateTelemetry({ event_id: 'evt-up3', uptime_ms: -1 }), /uptime/);
  assert.throws(() => validateTelemetry({ event_id: 'evt-up4', uptime_ms: 1.5 }), /uptime/);
});
