import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import api, { normalizeApiBaseUrl, resolveApiBaseUrl, setCsrfToken, getSessionVersion, beginAuthChange, cancelAuthChange } from '../../frontend/src/services/api.js';

const originalWindow = globalThis.window;
let expirations;
beforeEach(() => {
  expirations = 0;
  globalThis.window = new EventTarget();
  window.addEventListener('eloto-session-expired', () => expirations++);
  setCsrfToken('session-before');
});
after(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

async function pendingFailure(url = '/boxes') {
  let fail;
  const { promise: started, resolve } = Promise.withResolvers();
  const request = api.get(url, { adapter: config => new Promise((_resolve, reject) => {
    fail = () => reject(Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } }));
    resolve();
  }) });
  const result = request.catch(error => error);
  await started;
  return { fail, result };
}

test('late 401 from the previous session cannot expire a new login or clear its CSRF token', async () => {
  const pending = await pendingFailure();
  setCsrfToken('new-session');
  pending.fail();
  await pending.result;
  assert.equal(expirations, 0);
  await api.post('/users/logout', {}, { adapter: async config => {
    assert.equal(config.headers.get('X-CSRF-Token'), 'new-session');
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  } });
});

test('current session 401 expires the session and clears CSRF', async () => {
  const pending = await pendingFailure();
  pending.fail();
  await pending.result;
  assert.equal(expirations, 1);
  await api.post('/users/logout', {}, { adapter: async config => {
    assert.equal(config.headers.get('X-CSRF-Token'), undefined);
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  } });
});

test('background 401 cannot cancel an in-progress login; failed login re-enables session checks', async () => {
  const version = beginAuthChange();
  const pending = await pendingFailure();
  pending.fail();
  await pending.result;
  assert.equal(expirations, 0);
  assert.equal(getSessionVersion(), version);
  cancelAuthChange(version);
  const next = await pendingFailure();
  next.fail();
  await next.result;
  assert.equal(expirations, 1);
});

test('invalid login credentials do not expire an existing session', async () => {
  const pending = await pendingFailure('/users/login');
  pending.fail();
  await pending.result;
  assert.equal(expirations, 0);
});

test('API base URL consistently includes the /api contract prefix', () => {
  assert.equal(normalizeApiBaseUrl(), '/api');
  assert.equal(normalizeApiBaseUrl('https://eloto.example.com'), 'https://eloto.example.com/api');
  assert.equal(normalizeApiBaseUrl('https://eloto.example.com/api/'), 'https://eloto.example.com/api');
});

test('production API URL stays on the HTTPS app origin while local preview remains usable', () => {
  assert.equal(resolveApiBaseUrl('/api', 'https://eloto.example.com', true), '/api');
  assert.equal(resolveApiBaseUrl('https://eloto.example.com/api', 'https://eloto.example.com', true), 'https://eloto.example.com/api');
  assert.equal(resolveApiBaseUrl('/api', 'http://localhost:4173', true), '/api');
  assert.throws(() => resolveApiBaseUrl('/v1', 'https://eloto.example.com', true), /HTTPS origin/);
  assert.throws(() => resolveApiBaseUrl('http://api.eloto.example.com/api', 'https://eloto.example.com', true), /HTTPS origin/);
  assert.throws(() => resolveApiBaseUrl('/api', 'http://eloto.example.com', true), /HTTPS origin/);
});
