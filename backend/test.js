const BASE_URL = 'http://localhost:5002/api';

async function runTests() {
  console.log('🧪 Memulai Pengujian Endpoint Backend ELOTO (Struktur Baru)...\n');

  const tests = [
    {
      name: '1. Health Check & Koneksi DB',
      url: `${BASE_URL}/health`,
      method: 'GET'
    },
    {
      name: '2. Ambil Data Users (Tabel users)',
      url: `${BASE_URL}/users`,
      method: 'GET'
    },
    {
      name: '3. Ambil Data Boxes (Tabel boxes)',
      url: `${BASE_URL}/boxes`,
      method: 'GET'
    },
    {
      name: '4. Ambil Riwayat Logs (Tabel audit_logs)',
      url: `${BASE_URL}/logs`,
      method: 'GET'
    },
    {
      name: '5. Ambil Tapping History (Tabel tapping_history)',
      url: `${BASE_URL}/logs/tapping-history`,
      method: 'GET'
    },
    {
      name: '6. Simulasi Cek Kartu RFID (POST rfid_uid)',
      url: `${BASE_URL}/users/check-card`,
      method: 'POST',
      body: { rfid_uid: '16V4K_BFF0BE85' }
    }
  ];

  for (const t of tests) {
    try {
      const options = {
        method: t.method,
        headers: { 'Content-Type': 'application/json' }
      };
      if (t.body) options.body = JSON.stringify(t.body);

      const res = await fetch(t.url, options);
      const data = await res.json();

      console.log(`✅ [HTTP ${res.status}] ${t.name}`);
      console.log('   Data:', JSON.stringify(data).slice(0, 120) + '...\n');
    } catch (err) {
      console.error(`❌ [GAGAL] ${t.name}`);
      console.error('   Error:', err.message, '\n');
    }
  }

  console.log('🏁 Pengujian Selesai!');
}

runTests();