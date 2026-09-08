import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { sequelize, User, Box, TappingHistory, Queue } from '../orm/models/index.js';

async function seed() {
  if (process.env.NODE_ENV === 'production' || !process.argv.includes('--demo')) throw new Error('Demo seeding is disabled; use bootstrap-admin for production');
  await sequelize.authenticate();
  console.log('DB Connected');

  // Disable FK checks temporarily


  // ===== USERS =====
  const users = [
    { sid: 'Admin', nama: 'Master Administrator', role: 'ADMIN', rfid_uid: '0000', foto: null },
    { sid: 'SPV001', nama: 'Budi Santoso', role: 'PENGAWAS', rfid_uid: '9D88FA1200', foto: null },
    { sid: 'SPV002', nama: 'Eltha Putri', role: 'PENGAWAS', rfid_uid: '3C001E9494', foto: null },
    { sid: 'MEK001', nama: 'Agus Prayitno', role: 'WORKER', rfid_uid: '1A2B3C4D5E', foto: null },
    { sid: 'MEK002', nama: 'Rahmat Hidayat', role: 'WORKER', rfid_uid: 'F4E5D6C7B8', foto: null },
    { sid: 'MEK003', nama: 'Joko Widodo', role: 'WORKER', rfid_uid: 'A1B2C3D4E5', foto: null },
    { sid: 'MEK004', nama: 'Andi Saputra', role: 'WORKER', rfid_uid: '3E0028F54F', foto: null },
    { sid: 'MEK005', nama: 'Rizki Pratama', role: 'WORKER', rfid_uid: '3D001266BB', foto: null },
    { sid: 'FUL001', nama: 'Dedi Kurniawan', role: 'FUELMAN', rfid_uid: '3C00035095', foto: null },
    { sid: 'FUL002', nama: 'Hendra Wijaya', role: 'FUELMAN', rfid_uid: '3E0027D5B2', foto: null }
  ];

  for (const u of users) {
    await User.findOrCreate({ where: { sid: u.sid }, defaults: { ...u, password: await bcrypt.hash(u.sid, 12) } });
  }
  console.log(`Users: ${users.length} seeded`);

  // ===== BOXES =====
  const now = new Date();
  const boxes = [
    { id_box: 'BOX ELOTO 1', unit: 'Unit Excavator CAT 320', ip: '192.168.1.131', state: 'STATE_IDLE', lat: 2.144691, lng: 117.477526, is_online: 1, last_ping: now },
    { id_box: 'BOX ELOTO 2', unit: 'Unit Dozer D6T', ip: '192.168.1.132', state: 'STATE_WAIT_SPV_IN', lat: 2.145100, lng: 117.478000 }
  ];

  for (const b of boxes) {
    await Box.upsert(b);
  }
  console.log(`Boxes: ${boxes.length} seeded`);

  // ===== ACTIVE REGISTERED PEOPLE (COUNTING TEST) =====
  const registeredPeople = [
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: '9D88FA1200' },
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: '1A2B3C4D5E' },
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: 'F4E5D6C7B8' }
  ];
  for (const person of registeredPeople) {
    await Queue.findOrCreate({ where: person, defaults: person });
  }
  console.log(`Active registered people: ${registeredPeople.length} (BOX ELOTO 1)`);

  // ===== TAPPING HISTORY (Session 1: BOX ELOTO 1) =====
  const tappingData = [
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: '9D88FA1200', nama: 'Budi Santoso', event_type: 'IN', event_text: 'SUPERVISOR_LOCK_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 3600000) },
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: '1A2B3C4D5E', nama: 'Agus Prayitno', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 3300000) },
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: 'F4E5D6C7B8', nama: 'Rahmat Hidayat', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 3000000) },
    { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: 'A1B2C3D4E5', nama: 'Joko Widodo', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 2700000) },
    // Session 2: BOX ELOTO 2
    { id_box: 'BOX ELOTO 2', session_id: 1, rfid_uid: '3C001E9494', nama: 'Eltha Putri', event_type: 'IN', event_text: 'SUPERVISOR_LOCK_IN', lat: 2.145100, lng: 117.478000, created_at: new Date(now - 1800000) },
    { id_box: 'BOX ELOTO 2', session_id: 1, rfid_uid: '3E0028F54F', nama: 'Andi Saputra', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.145100, lng: 117.478000, created_at: new Date(now - 1500000) }
  ];

  for (const t of tappingData) {
    await TappingHistory.findOrCreate({
      where: { id_box: t.id_box, session_id: t.session_id, rfid_uid: t.rfid_uid, event_text: t.event_text },
      defaults: t
    });
  }
  console.log(`TappingHistory: ${tappingData.length} seeded`);

  console.log('People counting: waiting for realtime camera worker');

  // Re-enable FK checks


  console.log('\nSeed complete!');
  await sequelize.close();
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
