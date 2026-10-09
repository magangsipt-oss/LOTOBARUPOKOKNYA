import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('tapping-history repair restores only canonical tap audit events', async () => {
  const queries = [];
  const migration = require('../migrations/20260930-rebuild-tapping-history.cjs');
  await migration.up({ sequelize: { query: async sql => { queries.push(sql); } } });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /INSERT INTO tapping_history/);
  assert.match(queries[0], /MECHANIC_LOG_IN/);
  assert.match(queries[0], /NOT EXISTS/);
  assert.doesNotMatch(queries[0], /HEARTBEAT_SYNC/);
});
