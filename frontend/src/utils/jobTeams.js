// Antrean perangkat multi-pekerjaan: setiap personel membawa nomor `team` dari firmware.
// Tiap pekerjaan dipimpin pengawas pertama pada team tersebut. Firmware lama tanpa `team`
// dianggap satu pekerjaan.

// Sama dengan checkIsSupervisorRole() di firmware.
export const isSupervisorRole = role => /PENGAWAS|SUPERVISOR|SPV|K3|ADMIN/i.test(String(role || ''));

export const queueItemUid = item => String(typeof item === 'string' ? item : (item?.uid || item?.last_uid || ''));

/**
 * Kelompokkan antrean per pekerjaan, berurutan sesuai pengawasnya tap masuk.
 * @returns {{ key: string, number: number, supervisor: object|null, members: object[] }[]}
 */
export function groupQueueByJob(queue, { skipUid = () => false } = {}) {
  const jobs = [];
  const byKey = new Map();
  (Array.isArray(queue) ? queue : []).forEach((item, index) => {
    const uid = queueItemUid(item);
    if (!uid || skipUid(uid)) return;
    const key = typeof item === 'object' && item?.team != null ? String(item.team) : 'default';
    let job = byKey.get(key);
    if (!job) {
      job = { key, number: 0, supervisor: null, members: [] };
      byKey.set(key, job);
      jobs.push(job);
    }
    const role = typeof item === 'object' ? item?.role : '';
    // Data lama tanpa role: orang pertama pekerjaan adalah pengawasnya.
    const isSupervisor = role ? isSupervisorRole(role) : job.members.length === 0;
    const member = { item, uid, index, isSupervisor };
    if (isSupervisor && !job.supervisor) job.supervisor = member;
    job.members.push(member);
  });
  jobs.forEach((job, position) => { job.number = position + 1; });
  return jobs;
}

// Tabel `queue` backend hanya menyimpan UID; snapshot telemetri (hw_data) membawa role dan team.
// Pakai snapshot bila berisi personel yang sama, agar pengelompokan pekerjaan tetap tersedia.
export function preferDetailedQueue(snapshotQueue, tableQueue) {
  if (!Array.isArray(snapshotQueue) || !snapshotQueue.every(item => item && typeof item === 'object' && item.uid)) {
    return tableQueue ?? snapshotQueue;
  }
  if (!Array.isArray(tableQueue)) return snapshotQueue;
  // Urutan tabel tidak dijamin (baris disisipkan ulang dengan joined_at yang sama), jadi bandingkan himpunan UID.
  const key = item => queueItemUid(item).toUpperCase();
  const tableMembers = new Set(tableQueue.map(key));
  const sameMembers = snapshotQueue.length === tableQueue.length && snapshotQueue.every(item => tableMembers.has(key(item)));
  return sameMembers ? snapshotQueue : tableQueue;
}
