// Validasi kolom formulir bersama (izin LOTO, daftar hadir). Pesan galat berbahasa Indonesia untuk pengguna.

export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function text(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) fail(`Kolom ${field} tidak valid.`);
  return value.trim();
}

export function flag(value, field) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail(`Kolom ${field} tidak valid.`);
  return value;
}

export function isoDate(value, field, required = false) {
  const v = text(value, field, 10);
  if (!v) {
    if (required) fail(`Kolom ${field} wajib diisi.`);
    return '';
  }
  const date = new Date(`${v}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== v) {
    fail(`Kolom ${field} tidak valid.`);
  }
  return v;
}

export function clock(value, field) {
  const v = text(value, field, 5);
  if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(`Kolom ${field} tidak valid.`);
  return v;
}

export function object(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Kolom ${field} tidak valid.`);
  return value;
}
