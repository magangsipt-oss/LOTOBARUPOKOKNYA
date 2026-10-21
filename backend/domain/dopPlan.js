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

export function parseDOPPayload(row) {
  let payload = row.payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Data payload DOP ${row.id} tidak valid di database.`);
  }
  return payload;
}

export function formatDOPPlan(row) {
  return {
    ...parseDOPPayload(row),
    id: Number(row.id),
    createdAt: row.created_at,
    status: row.status || 'FINAL',
    idBox: row.id_box ?? null,
    sessionId: row.session_id ?? null
  };
}

// Zona waktu lokasi tambang (WITA) untuk tanggal & shift draft otomatis.
const DOP_TIMEZONE = process.env.DOP_TIMEZONE || 'Asia/Makassar';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: DOP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: Number(parts.hour) };
}

const personKey = person => person.sid;

// Draft DOP dari sesi box: hanya tanggal, shift, unit, dan personel yang tap; sisanya diisi pengawas.
export function buildSessionDraft({ unit, people, now = new Date() }) {
  const { year, month, day, hour } = localParts(now);
  const supervisors = people.filter(person => person.role === 'pengawas');
  return {
    tanggal: `${day}-${MONTHS[Number(month) - 1]}-${year.slice(2)}`,
    tanggalISO: `${year}-${month}-${day}`,
    // Shift 1 = 06.00-17.59, Shift 2 = 18.00-05.59 waktu lokal.
    shift: hour >= 6 && hour < 18 ? '1' : '2',
    aktivitas: '',
    keluhan: '',
    departemen: '',
    lokasi: '',
    tools: '',
    hazard: '',
    goldenRules: '',
    sib: '',
    kritis: '',
    ibpr: '',
    jsa: '',
    loto: 'Wajib LOTO',
    pemantauan: '',
    foto: false,
    fleetUnits: unit ? [String(unit).trim().slice(0, 50)] : [],
    pja: {
      layer1s1: [],
      layer1s2: [],
      layer2: supervisors.map(person => ({ nama: person.nama, jabatan: 'Spv/Act Spv', hp: '' })),
      layer3: [],
      layer4: []
    },
    personel: people
  };
}

// Tambahkan personel yang baru tap; pengawas baru ikut ke PJA selama masih draft.
export function mergeSessionPeople(payload, people, isDraft) {
  const known = new Set((payload.personel || []).map(personKey));
  const added = people.filter(person => !known.has(personKey(person)));
  if (!added.length) return null;
  const next = { ...payload, personel: [...(payload.personel || []), ...added] };
  if (isDraft) {
    const layer2 = payload.pja?.layer2 || [];
    const names = new Set(layer2.map(entry => entry.nama));
    const newSupervisors = added.filter(person => person.role === 'pengawas' && !names.has(person.nama));
    next.pja = { ...payload.pja, layer2: [...layer2, ...newSupervisors.map(person => ({ nama: person.nama, jabatan: 'Spv/Act Spv', hp: '' }))] };
  }
  return next;
}
