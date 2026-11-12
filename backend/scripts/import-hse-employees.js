// Import pengawas, mekanik, foreman, dan safety dari JSON HSE Automation (getEmployee).
// Default dry-run: hanya menampilkan rencana. Tambahkan --apply untuk menulis ke database.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import CommandModel from '../models/commandModel.js';
import { extractHseRecords, toLotoUser, planHseImport } from '../domain/hseEmployees.js';

const SALT_ROUNDS = 12;
const USAGE = 'Pakai: pnpm --filter backend run import:hse -- <file-hse.json> [--apply]';

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const files = argv.filter(arg => !arg.startsWith('--'));
  if (files.length !== 1) throw new Error(USAGE);
  return { file: path.resolve(process.env.INIT_CWD || process.cwd(), files[0]), apply };
}

async function loadIncoming(file) {
  let body;
  try {
    body = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Tidak dapat membaca JSON HSE (${file}): ${error.message}`);
  }
  const records = extractHseRecords(body);
  return { total: records.length, users: records.map(toLotoUser).filter(Boolean) };
}

function printSummary({ total, users }, plan) {
  const byRole = users.reduce((counts, user) => ({ ...counts, [user.role]: (counts[user.role] || 0) + 1 }), {});
  console.log(`Karyawan di JSON: ${total}. Lolos filter (aktif + jabatan relevan): ${users.length}.`);
  console.log(`Per role: ${Object.entries(byRole).map(([role, count]) => `${role}=${count}`).join(', ') || '-'}`);
  console.log(`Rencana: ${plan.inserts.length} baru, ${plan.updates.length} diperbarui, ${plan.unchanged} tidak berubah, ${plan.rfidReleases.length} kartu dilepas dari user lain.`);
  for (const { sid, reason } of plan.skipped) console.log(`  Dilewati/dikoreksi ${sid}: ${reason}`);
}

// Password awal akun baru = SID (konvensi akun E-LOTO); admin dapat menggantinya kapan saja.
async function hashInserts(inserts) {
  const hashed = [];
  for (const user of inserts) {
    const password = await bcrypt.hash(user.sid, SALT_ROUNDS);
    hashed.push({ ...user, password });
  }
  return hashed;
}

async function applyPlan(plan) {
  const inserts = await hashInserts(plan.inserts);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const sid of plan.rfidReleases) {
      await connection.query('UPDATE users SET rfid_uid = NULL WHERE sid = ?', [sid]);
    }
    for (const user of plan.updates) {
      await connection.query("UPDATE users SET nama = ?, role = ?, rfid_uid = ? WHERE sid = ? AND UPPER(role) <> 'ADMIN'",
        [user.nama, user.role, user.rfid_uid, user.sid]);
    }
    for (const user of inserts) {
      await connection.query('INSERT INTO users (sid, nama, role, rfid_uid, fp_id, password, foto, created_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, NOW())',
        [user.sid, user.nama, user.role, user.rfid_uid, user.password]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw new Error(`Import dibatalkan, tidak ada perubahan disimpan: ${error.message}`);
  } finally {
    connection.release();
  }
}

// Minta setiap boks memperbarui cache kartu. Gagal di satu boks tidak membatalkan import.
async function requestDeviceSync() {
  const [boxes] = await pool.query('SELECT id_box FROM boxes');
  for (const { id_box: idBox } of boxes) {
    try {
      await CommandModel.setCommand(idBox, 'SYNC_USERS');
      console.log(`SYNC_USERS dikirim ke ${idBox}.`);
    } catch (error) {
      console.error(`SYNC_USERS gagal untuk ${idBox}: ${error.message}`);
    }
  }
}

try {
  const { file, apply } = parseArgs(process.argv.slice(2));
  const incoming = await loadIncoming(file);
  const [existing] = await pool.query('SELECT sid, nama, role, rfid_uid FROM users');
  const plan = planHseImport(incoming.users, existing);
  printSummary(incoming, plan);
  if (!apply) {
    console.log('Dry-run: database tidak diubah. Jalankan ulang dengan --apply untuk menyimpan.');
  } else {
    await applyPlan(plan);
    console.log('Import selesai.');
    await requestDeviceSync();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
