import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import boxService from '../services/boxService';
import logService from '../services/logService';

const STATE_DESC = {
  STATE_BOOT_IP: 'Menghubungkan boks ke jaringan Wi-Fi...',
  STATE_IDLE: 'Boks Standby. Tekan Tombol 1 di boks untuk memulai penguncian.',
  STATE_REGISTER_RFID: 'Mode Daftarkan Kartu Aktif! Tempelkan kartu di boks untuk membaca UID.',
  STATE_WAIT_SPV_IN: 'Menunggu Pengawas memindai kartu untuk membuka sesi.',
  STATE_SET_MEKANIK_COUNT: 'Pengawas sedang mengatur jumlah mekanik yang bekerja.',
  STATE_MEKANIK_IN: 'Mekanik dapat menempelkan kartu satu per satu untuk mulai bekerja.',
  STATE_LOTO_LOCKED_ACTIVE: 'Penguncian Aktif. Tekan Tombol 2 di boks jika ingin menambah mekanik atau keluar.',
  STATE_CHOOSE_ACTION: 'Menu Pilihan: Tekan 1 untuk Tambah Mekanik, Tekan 2 untuk Selesai/Keluar.',
  STATE_MEKANIK_OUT: 'Mekanik menempelkan kartu untuk keluar dari pekerjaan.',
  STATE_WAIT_SPV_OUT: 'Semua mekanik sudah keluar. Menunggu kartu Pengawas untuk menutup sesi.',
  STATE_MAINTENANCE_DONE: 'Pekerjaan selesai. Tekan Tombol 3 untuk membuka gembok.',
  STATE_RFID_DETECTED: 'Kartu RFID terdeteksi. Sistem sedang memeriksa identitas kartu.',
  STATE_RFID_VALID: 'Kartu RFID valid dan akses diterima.',
  STATE_INITIALIZING: 'Perangkat sedang menginisialisasi ESP32, TFT, RFID, dan storage.',
  STATE_SYSTEM_READY: 'Perangkat siap memulai proses E-LOTO.'
};

const Dashboard = () => {
  const [boxes, setBoxes] = useState([]);
  const [selectedBox, setSelectedBox] = useState(null);
  const [isHwOnline, setIsHwOnline] = useState(true);
  const [downtimeSeconds, setDowntimeSeconds] = useState(0);
  const [isTrackingDowntime, setIsTrackingDowntime] = useState(false);
  const [boxSearchTerm, setBoxSearchTerm] = useState('');
  
  // Data telemetri hardware boks
  const [hwData, setHwData] = useState({
    lcd0: '  SISTEM READY',
    lcd1: 'TEKAN 1 UTK MULAI',
    state: 'STATE_IDLE',
    relay_open: false,
    last_event: 'SYS_INIT',
    last_event_ok: true,
    gps_fix: true,
    supervisor_uid: '—',
    active_fuelman: '',
    last_uid: '—',
    queue: [],
    ssid: 'ELOTO-MESH-NET'
  });

  // State Form Tambah Unit Boks
  const [formAlatBerat, setFormAlatBerat] = useState({
    box_number: '',
    location_name: '',
    department: 'Maintenance',
    ip: '192.168.1.100',
    lat: '2.144691',
    lng: '117.477526'
  });

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});

  // 1. Mengambil Data Unit Boks dari Backend
  const fetchBoxes = async () => {
    try {
      const res = await boxService.getAllBoxes();
      if (res && res.success) {
        const data = res.data || [];
        setBoxes(data);
        if (!selectedBox && data.length > 0) {
          setSelectedBox(data[0]);
        }
      }
    } catch (error) {
      console.error('Gagal mengambil data box:', error);
    }
  };

  useEffect(() => {
    fetchBoxes();
    const interval = setInterval(fetchBoxes, 4000);
    return () => clearInterval(interval);
  }, []);

  // 2. Timer Penghitung Downtime Penguncian
  useEffect(() => {
    let timer;
    if (isTrackingDowntime) {
      timer = setInterval(() => {
        setDowntimeSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isTrackingDowntime]);

  const formatWaktuDowntime = (totalDetik) => {
    const jam = Math.floor(totalDetik / 3600);
    const menit = Math.floor((totalDetik % 3600) / 60);
    const detik = totalDetik % 60;
    return `${jam.toString().padStart(2, '0')}:${menit.toString().padStart(2, '0')}:${detik.toString().padStart(2, '0')}`;
  };

  // 3. Inisialisasi Peta Satelit Leaflet
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [2.144691, 117.477526],
        zoom: 14,
        zoomControl: true
      });

      // Layer Satelit Hybrid
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Google Satellite Hybrid'
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Render Marker Unit Boks
    boxes.forEach((box) => {
      const lat = Number(box.lat) || 2.144691;
      const lng = Number(box.lng) || 117.477526;
      const isLocked = box.status?.toUpperCase() === 'LOCKED';
      const markerColor = isLocked ? '#ef4444' : '#22c55e';

      const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: `<svg width="28" height="38" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 32 12 32C12 32 24 21 24 12C24 5.37 18.63 0 12 0ZM12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16Z" fill="${markerColor}"/>
               </svg>`,
        iconSize: [28, 38],
        iconAnchor: [14, 38],
        popupAnchor: [0, -36]
      });

      if (markersRef.current[box.id]) {
        markersRef.current[box.id].setLatLng([lat, lng]);
      } else {
        const marker = L.marker([lat, lng], { icon: customIcon })
          .addTo(map)
          .bindPopup(`<b>${box.box_number}</b><br>Lokasi: ${box.location_name || '-'}<br>Status: ${box.status}`);
        
        marker.on('click', () => setSelectedBox(box));
        markersRef.current[box.id] = marker;
      }
    });
  }, [boxes]);

  // 4. Handler Tambah Boks Baru
  const handleTambahBoks = async (e) => {
    e.preventDefault();
    try {
      await boxService.createBox(formAlatBerat);
      setFormAlatBerat({
        box_number: '',
        location_name: '',
        department: 'Maintenance',
        ip: '192.168.1.100',
        lat: '2.144691',
        lng: '117.477526'
      });
      fetchBoxes();
    } catch (err) {
      alert('Gagal menambahkan boks alat: ' + err.message);
    }
  };

  const filteredBoxes = boxes.filter((b) =>
    b.box_number?.toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
    b.location_name?.toLowerCase().includes(boxSearchTerm.toLowerCase())
  );

  const lockedCount = boxes.filter((b) => b.status?.toUpperCase() === 'LOCKED').length;

  return (
    <div className="space-y-6 text-slate-900">
      {/* 1. BARIS 5 KARTU STATUS ATAS (IDENTIK DENGAN ELOTO-v1) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* KARTU 1: WAKTU KUNCI */}
        <div className="bg-white border border-red-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Waktu Kunci</p>
            <h3 className={`text-lg font-black font-mono mt-1 ${isTrackingDowntime ? 'text-amber-600 animate-pulse' : 'text-slate-700'}`}>
              {formatWaktuDowntime(downtimeSeconds)}
            </h3>
          </div>
          <span className="text-xl">⏱️</span>
        </div>

        {/* KARTU 2: TOTAL BOKS */}
        <div className="bg-white border border-red-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total Boks</p>
            <h3 className="text-lg font-black font-mono mt-1 text-slate-900">{boxes.length} Unit</h3>
          </div>
          <span className="text-xl">📦</span>
        </div>

        {/* KARTU 3: BOKS TERKUNCI */}
        <div className="bg-white border border-red-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Boks Terkunci</p>
            <h3 className="text-lg font-black font-mono mt-1 text-red-600">{lockedCount} Unit</h3>
          </div>
          <span className="text-xl">🔒</span>
        </div>

        {/* KARTU 4: STATUS RADAR */}
        <div className="bg-white border border-red-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Status Radar</p>
            <h3 className={`text-lg font-black font-mono mt-1 ${isHwOnline ? 'text-green-600' : 'text-red-600'}`}>
              {isHwOnline ? '1 Aktif' : '0 Standby'}
            </h3>
          </div>
          <span className="text-xl">📡</span>
        </div>

        {/* KARTU 5: DATA PINDAIAN */}
        <div className="bg-red-50 border-2 border-red-300 p-3.5 rounded-xl flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[10px] text-red-700 font-bold uppercase tracking-wider">Data Pindaian</p>
            <h3 className="text-lg font-black font-mono mt-1 text-red-700">
              {hwData.queue.length} Petugas
            </h3>
          </div>
          <span className="text-xl">🪪</span>
        </div>
      </div>

      {/* 2. BARIS STATUS RADAR TARGET */}
      <div className="bg-white border border-red-200 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isHwOnline ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`} />
          <div>
            <span className="text-slate-500 font-bold">RADAR TARGET: </span>
            <span className="text-slate-950 font-black">{selectedBox ? `${selectedBox.box_number} (${selectedBox.location_name || 'Pit 1'})` : 'Belum Ada Boks'}</span>
            <span className="ml-2 text-blue-600 font-bold">[SSID: {hwData.ssid}]</span>
          </div>
        </div>

        <span className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest ${isHwOnline ? 'bg-green-50 text-green-700 border border-green-300' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          {isHwOnline ? 'RADAR ONLINE' : 'RADAR OFFLINE'}
        </span>
      </div>

      {/* 3. AREA UTAMA: PETA SATELIT + TERMINAL LCD + SENSOR */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          {/* Peta Satelit Leaflet */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-2 font-mono">
              <span>📍 Peta Lokasi Alat Berat (Satelit)</span>
            </div>
            <div
              ref={mapContainerRef}
              className="w-full h-[280px] sm:h-[350px] rounded-2xl border border-red-200 shadow-lg z-10"
              style={{ background: '#e5e7eb' }}
            />
          </div>

          {/* Simulasi Layar LCD Fisik & Status Sistem */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Terminal LCD Fisik Hijau */}
            <div className="bg-[#06140a] border-2 border-[#16271a] rounded-xl p-4 shadow-inner relative font-mono text-sm text-[#27ff84] min-h-[90px] flex flex-col justify-center">
              <p className="leading-relaxed tracking-wide font-bold">{hwData.lcd0}</p>
              <p className="leading-relaxed tracking-wide text-xs text-[#10b981] mt-1">{hwData.lcd1}</p>
            </div>

            {/* Status Alur Kerja LOTO */}
            <div className="bg-white border border-gray-200 p-4 rounded-xl flex flex-col justify-center shadow-sm">
              <span className="text-[10px] font-mono tracking-widest uppercase text-slate-500">Status Kerja Sistem</span>
              <h4 className="text-sm sm:text-base font-black font-mono tracking-wide mt-1 text-red-600">
                {isHwOnline ? hwData.state : 'OFFLINE'}
              </h4>
              <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                {STATE_DESC[hwData.state] || 'Membaca jalur mesin...'}
              </p>
            </div>
          </div>

          {/* Indikator Sensor Solenoid & GPS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
            <div className="bg-white p-3.5 rounded-xl border border-gray-200 flex items-center gap-3 shadow-sm">
              <div className={`w-3.5 h-3.5 rounded-full ${hwData.relay_open ? 'bg-green-500' : 'bg-red-500'}`} />
              <div>
                <span className="block text-[9px] text-slate-500">KUNCI SOLENOID</span>
                <span className="font-bold text-slate-950">{hwData.relay_open ? 'TERBUKA (HIGH)' : 'TERKUNCI (LOW)'}</span>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-gray-200 flex items-center gap-3 shadow-sm">
              <div className={`w-3.5 h-3.5 rounded-full ${hwData.last_event_ok ? 'bg-green-500' : 'bg-red-500'}`} />
              <div>
                <span className="block text-[9px] text-slate-500">PINDAIAN TERAKHIR</span>
                <span className="font-bold text-slate-950">{hwData.last_event} ✓</span>
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-gray-200 flex items-center gap-3 shadow-sm">
              <div className={`w-3.5 h-3.5 rounded-full ${hwData.gps_fix ? 'bg-green-500' : 'bg-amber-500'}`} />
              <div>
                <span className="block text-[9px] text-slate-500">SINYAL GPS</span>
                <span className="font-bold text-slate-950">{hwData.gps_fix ? 'TERKUNCI SATELIT' : 'STANDBY'}</span>
              </div>
            </div>
          </div>

          {/* Antrean Petugas LOTO di Lapangan */}
          <div className="bg-white border border-red-100 p-4 sm:p-5 rounded-2xl shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono tracking-widest uppercase text-slate-600 font-bold">
                Daftar Antrean Petugas di Lapangan
              </p>
              <button
                type="button"
                onClick={() => {
                  setHwData((prev) => ({ ...prev, queue: [], state: 'STATE_IDLE' }));
                  setIsTrackingDowntime(false);
                }}
                className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-2.5 py-1 rounded text-[10px] font-mono font-bold"
              >
                ⚠️ Buka Paksa Darurat
              </button>
            </div>

            <div className="bg-gray-50 border border-gray-200 p-3 rounded-xl min-h-[50px] flex items-center flex-wrap gap-2">
              {hwData.queue.length > 0 ? (
                hwData.queue.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 font-mono text-xs">
                    {idx > 0 && <span className="text-slate-400 font-bold">→</span>}
                    <span className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 shadow-sm font-bold">
                      👤 {typeof item === 'string' ? item : item.name || 'Mekanik'}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-500 font-mono italic">
                  Antrean kosong — Belum ada gembok terpasang di lapangan.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 4. KOLOM KANAN: FORM TAMBAH BOKS & DAFTAR BOKS */}
        <div className="xl:col-span-1 space-y-6">
          {/* Formulir Registrasi Boks */}
          <div className="bg-red-50/60 border border-red-200 p-4 sm:p-5 rounded-2xl shadow-sm space-y-4">
            <div className="text-xs font-bold text-red-600 uppercase tracking-widest font-mono">
              ➕ Tambah Boks Alat Baru
            </div>
            <form onSubmit={handleTambahBoks} className="space-y-3 text-xs">
              <input
                type="text"
                required
                placeholder="ID Boks (Contoh: BOX ELOTO 1)"
                value={formAlatBerat.box_number}
                onChange={(e) => setFormAlatBerat({ ...formAlatBerat, box_number: e.target.value })}
                className="w-full bg-white border border-red-200 rounded-lg p-2.5 text-slate-900 focus:outline-none"
              />
              <input
                type="text"
                required
                placeholder="Nama Alat / Mesin (Contoh: HD-785 DUMP TRUCK)"
                value={formAlatBerat.location_name}
                onChange={(e) => setFormAlatBerat({ ...formAlatBerat, location_name: e.target.value })}
                className="w-full bg-white border border-red-200 rounded-lg p-2.5 text-slate-900 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Latitude"
                  value={formAlatBerat.lat}
                  onChange={(e) => setFormAlatBerat({ ...formAlatBerat, lat: e.target.value })}
                  className="w-full bg-white border border-red-200 rounded-lg p-2 font-mono text-slate-900"
                />
                <input
                  type="text"
                  placeholder="Longitude"
                  value={formAlatBerat.lng}
                  onChange={(e) => setFormAlatBerat({ ...formAlatBerat, lng: e.target.value })}
                  className="w-full bg-white border border-red-200 rounded-lg p-2 font-mono text-slate-900"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl uppercase font-mono shadow-md transition-colors"
              >
                Simpan Boks ke Peta
              </button>
            </form>
          </div>

          {/* Daftar Boks Terdaftar */}
          <div className="bg-white border border-gray-200 p-4 sm:p-5 rounded-2xl shadow-sm space-y-3">
            <p className="text-xs font-mono tracking-widest uppercase text-slate-600 border-b pb-2">
              Daftar Boks Terdaftar
            </p>

            <input
              type="text"
              placeholder="Cari boks (ID, Unit)..."
              value={boxSearchTerm}
              onChange={(e) => setBoxSearchTerm(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 p-2 rounded-xl text-xs font-mono focus:outline-none"
            />

            <div className="space-y-2 overflow-y-auto max-h-[220px]">
              {filteredBoxes.map((box) => {
                const isSelected = selectedBox?.id === box.id;
                const isLocked = box.status?.toUpperCase() === 'LOCKED';

                return (
                  <div
                    key={box.id}
                    onClick={() => setSelectedBox(box)}
                    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      isSelected ? 'bg-red-50 border-red-500' : 'bg-white border-gray-200'
                    }`}
                  >
                    <div className="truncate text-xs font-mono">
                      <p className="font-bold text-slate-900">📍 {box.box_number}</p>
                      <p className="text-slate-500 text-[10px]">{box.location_name || '-'}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${
                        isLocked
                          ? 'bg-red-600 text-white border-red-700'
                          : 'bg-green-50 text-green-700 border-green-300'
                      }`}
                    >
                      {box.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;