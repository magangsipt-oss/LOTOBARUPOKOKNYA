const PJA_LAYERS = ['layer1s1', 'layer1s2', 'layer2', 'layer3', 'layer4'];
const TEXT_FIELDS = {
  tanggal: 32,
  tanggalISO: 10,
  aktivitas: 500,
  keluhan: 1000,
  departemen: 100,
  lokasi: 200,
  tools: 2000,
  hazard: 4000,
  goldenRules: 500,
  sib: 200,
  kritis: 200,
  ibpr: 2000,
  jsa: 2000,
  loto: 100,
  pemantauan: 2000
};

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function validateDOPPlanPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Data DOP tidak valid.');

  const payload = {};
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string' || fieldValue.length > max) fail(`Kolom ${field} tidak valid.`);
    payload[field] = fieldValue.trim();
  }

  const date = new Date(`${payload.tanggalISO}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.tanggalISO) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== payload.tanggalISO) {
    fail('Tanggal DOP tidak valid.');
  }
  if (!['1&2', '1', '2'].includes(value.shift)) fail('Shift DOP tidak valid.');
  payload.shift = value.shift;
  for (const field of ['aktivitas', 'departemen', 'lokasi', 'hazard']) {
    if (!payload[field]) fail(`Kolom ${field} wajib diisi.`);
  }
  if (value.foto !== undefined && typeof value.foto !== 'boolean') fail('Status foto tidak valid.');
  payload.foto = value.foto === true;

  if (!Array.isArray(value.fleetUnits) || value.fleetUnits.length > 50 ||
      value.fleetUnits.some(unit => typeof unit !== 'string' || !unit.trim() || unit.length > 50)) {
    fail('Daftar unit DOP tidak valid.');
  }
  payload.fleetUnits = [...new Set(value.fleetUnits.map(unit => unit.trim()))];

  if (!value.pja || typeof value.pja !== 'object' || Array.isArray(value.pja)) fail('Data pengawas/PJA tidak valid.');
  payload.pja = {};
  for (const layer of PJA_LAYERS) {
    const entries = value.pja[layer];
    if (!Array.isArray(entries) || entries.length > 30) fail(`Data PJA ${layer} tidak valid.`);
    payload.pja[layer] = entries.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          ['nama', 'jabatan', 'hp'].some(field => typeof entry[field] !== 'string' || entry[field].length > 100)) {
        fail(`Data PJA ${layer} tidak valid.`);
      }
      return {
        nama: entry.nama.trim(),
        jabatan: entry.jabatan.trim(),
        hp: entry.hp.trim()
      };
    });
  }

  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 100_000) fail('Ukuran data DOP terlalu besar.');
  return payload;
}

export function formatDOPPlan(row) {
  let payload = row.payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Data payload DOP ${row.id} tidak valid di database.`);
  }
  return { ...payload, id: Number(row.id), createdAt: row.created_at };
}
