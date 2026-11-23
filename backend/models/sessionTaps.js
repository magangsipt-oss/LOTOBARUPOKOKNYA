import { groupSessionTaps } from '../domain/personnel.js';

// Tap kartu (masuk pertama, keluar terakhir) per orang untuk sesi box milik baris-baris formulir.
// Tap offline yang diputar ulang tidak punya sesi, jadi tidak ikut terhitung sebagai tanda tangan.
export async function loadSessionTaps(c, rows) {
  const pairs = [...new Map(rows
    .filter(r => r.id_box && r.session_id != null)
    .map(r => [`${r.id_box}#${r.session_id}`, [r.id_box, Number(r.session_id)]])).values()];
  if (!pairs.length) return new Map();
  const [taps] = await c.query(
    `SELECT t.id_box, t.session_id, t.event_type, MIN(t.created_at) AS first_at, MAX(t.created_at) AS last_at,
       u.sid, u.nama, u.role
     FROM tapping_history t JOIN users u ON u.rfid_uid = t.rfid_uid OR u.sid = t.rfid_uid
     WHERE (t.id_box, t.session_id) IN (${pairs.map(() => '(?, ?)').join(', ')})
       AND t.event_type IN ('IN', 'OUT') AND t.event_text NOT LIKE 'REFUEL%'
     GROUP BY t.id_box, t.session_id, t.event_type, u.sid, u.nama, u.role`,
    pairs.flat()
  );
  return groupSessionTaps(taps);
}

export const tapsFor = (taps, row) => (row.id_box && row.session_id != null ? taps.get(`${row.id_box}#${row.session_id}`) || [] : []);
