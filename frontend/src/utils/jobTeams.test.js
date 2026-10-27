import test from 'node:test';
import assert from 'node:assert/strict';
import { groupQueueByJob, isSupervisorRole, preferDetailedQueue } from './jobTeams.js';

test('device queue is grouped per job in supervisor tap order', () => {
  const jobs = groupQueueByJob([
    { uid: 'A', name: 'Budi', role: 'PENGAWAS', team: 1 },
    { uid: 'M1', name: 'Mek 1', role: 'MEKANIK', team: 1 },
    { uid: 'B', name: 'Sari', role: 'PENGAWAS', team: 3 },
    { uid: 'M2', name: 'Mek 2', role: 'MEKANIK', team: 3 },
    { uid: 'M3', name: 'Mek 3', role: 'MEKANIK', team: 1 }
  ]);
  assert.deepEqual(jobs.map(job => [job.number, job.supervisor.uid, job.members.map(m => m.uid)]), [
    [1, 'A', ['A', 'M1', 'M3']],
    [2, 'B', ['B', 'M2']]
  ]);
});

test('older firmware without team or role is shown as one job led by the first tap', () => {
  const jobs = groupQueueByJob(['A', 'M1', { uid: 'ADMIN1' }], { skipUid: uid => uid === 'ADMIN1' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].supervisor.uid, 'A');
  assert.deepEqual(jobs[0].members.map(m => [m.uid, m.isSupervisor]), [['A', true], ['M1', false]]);
});

test('supervisor roles match the firmware role check', () => {
  assert.ok(isSupervisorRole('PENGAWAS'));
  assert.ok(isSupervisorRole('pengawas k3'));
  assert.ok(!isSupervisorRole('MEKANIK'));
});

test('detailed telemetry queue replaces the UID-only table queue only when members match', () => {
  const snapshot = [{ uid: 'A', role: 'PENGAWAS', team: 1 }, { uid: 'M1', role: 'MEKANIK', team: 1 }];
  assert.equal(preferDetailedQueue(snapshot, ['A', 'M1']), snapshot);
  assert.equal(preferDetailedQueue(snapshot, ['m1', 'a']), snapshot);
  assert.deepEqual(preferDetailedQueue(snapshot, ['A']), ['A']);
  assert.deepEqual(preferDetailedQueue(undefined, ['A']), ['A']);
  assert.equal(preferDetailedQueue(snapshot, undefined), snapshot);
});
