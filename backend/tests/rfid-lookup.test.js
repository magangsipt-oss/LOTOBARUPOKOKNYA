import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { rfidLookupCandidates, selectUniqueRfidMatch } from '../domain/rfid.js';
import userController from '../controllers/userController.js';
import pool from '../config/database.js';

test('RFID lookup includes firmware hexadecimal and decimal representations', () => {
  const candidates = rfidLookupCandidates('0000001A');
  assert.ok(candidates.includes('0000001A'));
  assert.ok(candidates.includes('26'));
  assert.ok(candidates.includes('0000000026'));
});

test('10-digit RFID UIDs do not alias another card through their final eight digits', () => {
  const candidates = rfidLookupCandidates('AA001E9494');
  assert.ok(candidates.includes('AA001E9494'));
  assert.ok(!candidates.includes('001E9494'));
  assert.ok(!candidates.includes('2004116'));
  assert.ok(!candidates.includes('0002004116'));

  const supervisorCandidates = rfidLookupCandidates('3C001E9494');
  assert.ok(supervisorCandidates.includes('3C001E9494'));
  assert.ok(!supervisorCandidates.includes('001E9494'));

  const sameCard = { sid: 'SPV01', rfid_uid: '3C001E9494' };
  assert.deepEqual(selectUniqueRfidMatch([sameCard]), sameCard);
});

test('card lookup prefers an exact 10-digit UID and never accepts a suffix collision', async () => {
  const originalQuery = pool.query;
  const requestedUids = [];
  pool.query = async (_sql, params) => {
    requestedUids.push(params[0]);
    if (params[0] === '3C001E9494' || params[0] === '001E9494') {
      return [[{ sid: 'SPV01', nama: 'Supervisor', role: 'PENGAWAS', rfid_uid: params[0] }]];
    }
    return [[]];
  };

  const responseFor = async (rfid_uid) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await userController.checkCard({ body: { rfid_uid } }, response);
    return response;
  };

  try {
    const exact = await responseFor('3C001E9494');
    assert.equal(exact.statusCode, 200);
    assert.deepEqual(requestedUids, ['3C001E9494']);

    requestedUids.length = 0;
    const collidingNewCard = await responseFor('AA001E9494');
    assert.equal(collidingNewCard.statusCode, 404);
    assert.ok(!requestedUids.includes('001E9494'));
  } finally {
    pool.query = originalQuery;
  }
});

test('photo endpoint crops LCD JPEG photos to a square without changing the stored profile photo', async () => {
  const originalQuery = pool.query;
  pool.query = async (_sql, params) => params[0] === '3E0027D5B2'
    ? [[{
      sid: 'NCOMG',
      rfid_uid: '3E0027D5B2',
      foto: 'uploads/user_profiles/NCOMG_ac16a3adf382.jpeg',
    }]]
    : [[]];

  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    send(body) { this.body = body; return this; },
  };

  try {
    await userController.getPhoto({
      params: { uid: '3E0027D5B2' },
      query: { size: '160', quality: '78', fit: 'cover' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.contentType, 'jpeg');
    assert.ok(Buffer.isBuffer(response.body));
    assert.equal(response.body[0], 0xFF);
    assert.equal(response.body[1], 0xD8);
    const dimensions = await sharp(response.body).metadata();
    assert.equal(dimensions.width, 160);
    assert.equal(dimensions.height, 160);
  } finally {
    pool.query = originalQuery;
  }
});

test('legacy decimal aliases are limited to eight-digit hexadecimal UIDs', () => {
  const shortUid = rfidLookupCandidates('001E9494');
  assert.ok(shortUid.includes('2004116'));
  assert.ok(shortUid.includes('0002004116'));
  const longUid = rfidLookupCandidates('3C001E9494');
  assert.ok(!longUid.includes('2004116'));
  assert.ok(!longUid.includes('0002004116'));
});

test('RFID lookup strips a valid RDM6300 checksum frame only', () => {
  assert.ok(rfidLookupCandidates('123456789098').includes('1234567890'));
  assert.ok(!rfidLookupCandidates('123456789099').includes('1234567890'));
  assert.ok(rfidLookupCandidates('1234567890').includes('123456789098'));
});

test('RFID lookup returns one user for equivalent aliases and rejects conflicting aliases', () => {
  const user = { sid: 'TECH-1' };
  assert.deepEqual(selectUniqueRfidMatch([user, { ...user }]), user);
  assert.equal(selectUniqueRfidMatch([user, { sid: 'TECH-2' }]), null);
  assert.equal(selectUniqueRfidMatch([]), null);
});