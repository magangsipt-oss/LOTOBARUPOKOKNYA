import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { subscribe, announceChanges, closeAll, liveClientCount } from '../realtime.js';
import authorization from '../middleware/authorization.js';

function stream() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.frames = [];
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.write = frame => { res.frames.push(frame); return true; };
  res.end = () => { res.ended = true; };
  return { req, res };
}

function write(auth, body, statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  announceChanges({ method: 'POST', auth, body }, res, () => {});
  res.emit('finish');
}

test('successful box writes are pushed to every live dashboard', () => {
  const a = stream();
  const b = stream();
  subscribe(a.req, a.res);
  subscribe(b.req, b.res);
  assert.equal(a.res.headers['Content-Type'], 'text/event-stream');
  assert.equal(a.res.headers['X-Accel-Buffering'], 'no');

  write({ type: 'device', boxId: 'BOX-1' }, { id_box: 'SPOOFED' });
  for (const { res } of [a, b]) {
    const frame = res.frames.at(-1);
    assert.match(frame, /^event: change\n/);
    const data = JSON.parse(frame.split('data: ')[1]);
    assert.equal(data.source, 'device');
    assert.equal(data.id_box, 'BOX-1');
  }

  a.req.emit('close');
  b.req.emit('close');
  assert.equal(liveClientCount(), 0);
});

test('failed writes and reads do not notify dashboards', () => {
  const a = stream();
  subscribe(a.req, a.res);
  const before = a.res.frames.length;
  write({ type: 'device', boxId: 'BOX-1' }, {}, 400);
  let nextCalled = false;
  announceChanges({ method: 'GET' }, new EventEmitter(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(a.res.frames.length, before);
  closeAll();
  assert.equal(a.res.ended, true);
  assert.equal(liveClientCount(), 0);
});

test('boxes cannot subscribe to the live dashboard stream', () => {
  let status;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  authorization({ method: 'GET', path: '/live', auth: { type: 'device', boxId: 'BOX-1' }, query: {} }, res, () => {
    throw new Error('device must be denied');
  });
  assert.equal(status, 403);
});
