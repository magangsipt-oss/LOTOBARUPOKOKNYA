import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as XLSX from 'xlsx';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';

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
  STATE_MENU: 'Menu LOTO terbuka. Pilih tindakan dengan tombol perangkat.',
  STATE_EVENT_LOG: 'Daftar event perangkat sedang ditampilkan.',
  STATE_LOGOUT_DENIED: 'Logout ditolak karena kartu atau urutan stack tidak sesuai.',
  STATE_STACK_STATUS: 'Status stack personel sedang ditampilkan.',
  STATE_SERVER_OFFLINE: 'Server offline. Perangkat berjalan dalam mode lokal.',
  STATE_SYSTEM_ERROR: 'Perangkat mengalami error sistem. Periksa SD card dan sensor.',
  STATE_INITIALIZING: 'Perangkat sedang menginisialisasi ESP32, TFT, RFID, dan storage.',
  STATE_CONNECTING: 'Perangkat sedang menghubungkan diri ke jaringan.',
  STATE_SYSTEM_READY: 'Perangkat siap memulai proses E-LOTO.',
  STATE_COUNTDOWN: 'Persiapan penguncian sedang berjalan.',
  STATE_SUPERVISOR_VALID: 'RFID pengawas valid dan dapat melanjutkan proses.',
  STATE_MECHANIC_VALID: 'RFID mekanik valid dan terverifikasi.',
  STATE_ALL_WORKERS_REGISTERED: 'Semua pekerja berhasil terdaftar pada sesi ini.',
  STATE_LOGOUT_SUCCESS: 'Logout berhasil sesuai urutan FIFO.',
  STATE_ALL_WORKERS_OUT: 'Semua pekerja sudah keluar dari stack.',
  STATE_UNLOCKING: 'Gembok sedang dibuka.',
  STATE_SYSTEM_READY_FINAL: 'E-LOTO selesai dan sistem kembali siap digunakan.'
};

const safeToFixed = (val, digits = 4) => {
  const num = Number(val);
  return isNaN(num) ? '0.0000' : num.toFixed(digits);
};

const formatWaktuDowntime = (totalDetik) => {
  const seconds = Math.max(0, Number(totalDetik) || 0);
  const jam = Math.floor(seconds / 3600);
  const menit = Math.floor((seconds % 3600) / 60);
  const detik = seconds % 60;
  return [jam, menit, detik].map(value => String(value).padStart(2, '0')).join(':');
};

const resolveProfilePhotoUrl = (photo) => {
  const value = String(photo || '').trim();
  if (!value || value === 'assets/default-avatar.png' || value.startsWith('data:') || value.startsWith('http')) {
    return value || 'assets/default-avatar.png';
  }
  if (value.startsWith('api/uploads/')) return `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5002'}/${value}`;
  if (value.startsWith('uploads/')) return `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5002'}/${value}`;
  return `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5002'}/uploads/user_profiles/${value}`;
};

const resolveUserPhotoUrl = (profile, fallbackPhoto) => {
  const uid = String(profile?.rfidUid || profile?.rfid_uid || profile?.uid || '').trim();
  if (uid) return `${import.meta.env.VITE_API_URL || 'http://localhost:5002/api'}/users/photo/${encodeURIComponent(uid)}`;
  return resolveProfilePhotoUrl(fallbackPhoto || profile?.foto);
};

export default function App() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5002/api';
  const API_SECRET_TOKEN = 'ELOTO_SECURE_KEY_2026';

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionUser, setSessionUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [subTabMaintenance, setSubTabMaintenance] = useState('menu-riwayat');
  const [subTabAdmin, setSubTabAdmin] = useState('daftar-personel');
  const [toast, setToast] = useState({ show: false, msg: '', type: '' });
  const [isProtocolValid, setIsProtocolValid] = useState(true);

  const [downtimeSeconds, setDowntimeSeconds] = useState(0);
  const [isTrackingDowntime, setIsDowntimeTracking] = useState(false);
  const [userDatabase, setUserDatabase] = useState([
    { sid: 'Admin', nama: 'Master Administrator', role: 'admin', rfidUid: '0000', password: 'Admin', foto: 'assets/default-avatar.png' }
  ]);
  const [boxes, setBoxes] = useState([]);
  const [selectedBox, setSelectedBox] = useState(null);
  const [isHwOnline, setIsHwOnline] = useState(false);
  const [hwData, setHwData] = useState({
    lcd0: '  SISTEM READY', lcd1: 'TEKAN 1 UTK MULAI', state: 'STATE_IDLE',
    relay_open: false, last_event: '', last_event_ok: true, gps_fix: false,
    supervisor_uid: '—', active_fuelman: '', last_uid: '—', wifi_connected: false, queue: [], audit_log: [], uptime_ms: 0,
    lat: '', lon: '', lng: '', ssid: '—'
  });
  const [logPemeliharaan, setLogPemeliharaan] = useState([]);
  const [rfidBufferList, setRfidBufferList] = useState([]);
  const [formData, setFormData] = useState({ sid: '', password: '' });
  const [formDeskripsi, setFormDeskripsi] = useState('');
  const [tipeKerusakan, setTipeKerusakan] = useState('Mekanikal');
  const [estimasiWaktu, setEstimasiWaktu] = useState('');
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [formAlatBerat, setFormAlatBerat] = useState({ id: '', unit: '', ip: '', lat: '', lng: '' });
  const [editingBoxId, setEditingBoxId] = useState('');

  const [formAdminNewUser, setFormAdminNewUser] = useState({
    sid: '', nama: '', role: 'teknisi', rfidUid: '', password: '', foto: ''
  });

  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [formEditUser, setFormEditUser] = useState({
    sid: '', nama: '', role: 'teknisi', rfidUid: '', foto: ''
  });
  const [selectedMechanicSids, setSelectedMechanicSids] = useState([]);
  const [teamBoxId, setTeamBoxId] = useState('');
  const [teamMaintenanceType, setTeamMaintenanceType] = useState('Mekanikal');

  // STATE PENCARIAN
  const [boxSearchTerm, setBoxSearchTerm] = useState('');
  const [adminSearchTerm, setAdminSearchTerm] = useState('');
  const [mechanicSearchTerm, setMechanicSearchTerm] = useState('');
  const [tappingSearchTerm, setTappingSearchTerm] = useState('');
  const [auditSearchTerm, setAuditSearchTerm] = useState('');
  const [maintenanceSearchTerm, setMaintenanceSearchTerm] = useState('');
  const [maintenanceTypeFilter, setMaintenanceTypeFilter] = useState('');

  // MODAL UMUM
  const [modalInfo, setModalInfo] = useState({
    open: false,
    title: '',
    icon: '',
    content: null
  });

  // MODAL STATUS RADAR
  const [showRadarModal, setShowRadarModal] = useState(false);
  const [radarModalSearch, setRadarModalSearch] = useState('');
  const [radarDetailBox, setRadarDetailBox] = useState(null);

  const [photoBase64, setPhotoBase64] = useState('');
  const [cropPhotoSrc, setCropPhotoSrc] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const [manualMekanik, setManualMekanik] = useState('');
  const [pengawasLoto, setPengawasLoto] = useState('');
  const [printActiveLog, setPrintActiveLog] = useState(null);

  const mapContainerRef = useRef(null);
  const leafletMapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const geoAddressCacheRef = useRef({});
  const lastProcessedEventRef = useRef({ event: '', uid: '' });
  const lastCenteredBoxIdRef = useRef(null);
  const lastKnownCoordsRef = useRef({});
  const overrideLockoutRef = useRef(false);
  const excelFileInputRef = useRef(null);
  const cropImageRef = useRef(null);
  const cropperRef = useRef(null);
  const cropTargetSetterRef = useRef(null);

  // REFS BUFFER ANTI FLICKER & RACE-CONDITION
  const selectedBoxIdRef = useRef(null);
  const isFetchingRef = useRef(false);
  const lastSeenOnlineRef = useRef({});

  const [localAuditLog, setLocalAuditLog] = useState([]);
  const [deletedAuditIds, setDeletedAuditIds] = useState([]);
  const [tappingHistory, setTappingHistory] = useState([]);

  const pemicuToast = (msg, type = '') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: '' }), 2600);
  };

  const secureFetch = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${API_SECRET_TOKEN}`,
      'X-Device-Token': API_SECRET_TOKEN,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    };
    return fetch(url, { ...options, headers, cache: 'no-store' });
  };

  const getUserProfile = (uid) => {
    const searchId = String(uid || '').split(':')[0].trim().toUpperCase();
    const user = userDatabase.find(item => {
      const rfid = String(item.rfidUid || item.rfid_uid || '').trim().toUpperCase();
      return (rfid && rfid === searchId) || String(item.sid || '').trim().toUpperCase() === searchId;
    });
    return user ? {
      nama: user.nama || 'Personel Tidak Dikenal',
      sid: user.sid || '—',
      role: user.role || 'teknisi',
      foto: user.foto || 'assets/default-avatar.png'
    } : { nama: `Kartu (${uid || '—'})`, sid: '—', role: 'teknisi', foto: 'assets/default-avatar.png' };
  };

  const isSystemUid = (uid) => {
    const value = String(uid || '').trim().toUpperCase();
    return !value || value === 'SYSTEM' || value === '—';
  };

  const isLiveTapPhotoVisible = isHwOnline &&
    !isSystemUid(hwData.last_uid) &&
    ['STATE_SUPERVISOR_VALID', 'STATE_SPV_OUT_CONFIRM', 'STATE_MECHANIC_VALID', 'STATE_WORKER_DETAIL'].includes(hwData.state);

  const isAdminUid = (uid) => getUserProfile(uid).role === 'admin';

  const getInitialAvatar = (name) => {
    const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#fee2e2"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#b91c1c" font-family="Arial" font-size="34" font-weight="700">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  };

  const Avatar = ({ profile, className = 'w-9 h-9' }) => (
    <img src={resolveUserPhotoUrl(profile, profile?.foto)} alt={`Foto ${profile?.nama || 'personel'}`} className={`${className} rounded-full object-cover border-2 border-white shadow-sm bg-red-50 shrink-0`} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getInitialAvatar(profile?.nama); }} />
  );

  const handleProfilePhotoUpload = (event, setter) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      cropTargetSetterRef.current = setter;
      setCropPhotoSrc(loadEvent.target.result);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  useEffect(() => {
    if (!cropPhotoSrc || !cropImageRef.current) return undefined;
    cropperRef.current = new Cropper(cropImageRef.current, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 0.85,
      responsive: true,
      background: false
    });
    return () => {
      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }
    };
  }, [cropPhotoSrc]);

  const handleConfirmProfileCrop = () => {
    if (!cropperRef.current || !cropTargetSetterRef.current) return;
    const croppedCanvas = cropperRef.current.getCroppedCanvas({ width: 600, height: 600, imageSmoothingQuality: 'high' });
    cropTargetSetterRef.current(prev => ({ ...prev, foto: croppedCanvas.toDataURL('image/jpeg', 0.92) }));
    cropTargetSetterRef.current = null;
    setCropPhotoSrc('');
  };

  const handleCancelProfileCrop = () => {
    cropTargetSetterRef.current = null;
    setCropPhotoSrc('');
  };

  const bukaModalUmum = (title, icon, content) => {
    if (title === 'Data Pindaian Kartu & Petugas Masuk') {
      setActiveTab('riwayat-tab');
      setSubTabMaintenance('pindaian-kartu');
      return;
    }
    setModalInfo({
      open: true,
      title,
      icon,
      content
    });
  };

  const bukaModalRadar = () => {
    setRadarModalSearch('');
    setRadarDetailBox(null);
    setShowRadarModal(true);
  };

  useEffect(() => {
    if (window.location.protocol === 'file:') {
      setIsProtocolValid(false);
    } else {
      setIsProtocolValid(true);
    }
  }, []);

  useEffect(() => {
    if (!isProtocolValid) return;
    const muatUserDatabaseGlobal = async () => {
      try {
        const responseUsers = await secureFetch(`${API_BASE_URL}/users?_=${Date.now()}`);
        if (responseUsers.ok) {
          const result = await responseUsers.json();
          const dataUsers = result.data || result;
          const masterAdmin = { sid: 'Admin', nama: 'Master Administrator', role: 'admin', rfidUid: '0000', password: 'Admin', foto: 'assets/default-avatar.png' };
          const dataSteril = Array.isArray(dataUsers)
            ? dataUsers.map(u => {
              const rLower = String(u.role || '').toLowerCase();
              let roleNormalized = 'teknisi';
              if (rLower.includes('pengawas') || rLower.includes('spv') || rLower.includes('k3')) roleNormalized = 'pengawas';
              else if (rLower.includes('fuel') || rLower.includes('bbm') || rLower.includes('refuel')) roleNormalized = 'fuelman';
              else if (rLower.includes('admin')) roleNormalized = 'admin';
              return {
                ...u,
                role: roleNormalized,
                rfidUid: u.rfid_uid || u.rfidUid || '',
                foto: u.foto || 'assets/default-avatar.png'
              };
            }).filter(u => u.sid !== 'Admin')
            : [];
          const dataFinalUsers = [masterAdmin, ...dataSteril];
          setUserDatabase(dataFinalUsers);
        }
      } catch (err) {}
    };
    muatUserDatabaseGlobal();
    const intervalUser = setInterval(muatUserDatabaseGlobal, 5000);
    return () => clearInterval(intervalUser);
  }, [isProtocolValid]);

  useEffect(() => {
    const muatDataLaporanDanBuffer = async () => {
      try {
        const response = await secureFetch(`${API_BASE_URL}/maintenance?_=${Date.now()}`);
        if (response.ok) {
          const result = await response.json();
          const data = result.data || result;
          if (Array.isArray(data)) setLogPemeliharaan(data);
        }

        const responseBuffer = await secureFetch(`${API_BASE_URL}/logs/buffer?_=${Date.now()}`);
        if (responseBuffer.ok) {
          const resultBuffer = await responseBuffer.json();
          const dataBuffer = resultBuffer.data || resultBuffer;
          if (Array.isArray(dataBuffer)) setRfidBufferList(dataBuffer);
        }

        const responseHistory = await secureFetch(`${API_BASE_URL}/logs/tapping-history?limit=200&_=${Date.now()}`);
        if (responseHistory.ok) {
          const dataHistory = await responseHistory.json();
          const normalizedHistory = Array.isArray(dataHistory)
            ? dataHistory
            : (Array.isArray(dataHistory?.data) ? dataHistory.data : []);
          setTappingHistory(normalizedHistory);
        }
      } catch (err) {}
    };

    if (isLoggedIn && isProtocolValid) {
      muatDataLaporanDanBuffer();
      const intervalSync = setInterval(muatDataLaporanDanBuffer, 4000);
      return () => clearInterval(intervalSync);
    }
  }, [isLoggedIn, isProtocolValid, selectedBox?.id]);

  useEffect(() => {
    if (!selectedBox) return undefined;

    const resetTimer = () => {
      setIsDowntimeTracking(false);
      setDowntimeSeconds(0);
      localStorage.removeItem(`downtime_${selectedBox.id}`);
    };
    const lockStates = ['STATE_WAIT_SPV_IN', 'STATE_MEKANIK_IN', 'STATE_LOTO_LOCKED_ACTIVE', 'STATE_CHOOSE_ACTION', 'STATE_ALL_WORKERS_REGISTERED'];
    const timerShouldRun = isHwOnline && lockStates.includes(hwData.state);

    if (!timerShouldRun) {
      resetTimer();
      return undefined;
    }

    const savedDowntime = localStorage.getItem(`downtime_${selectedBox.id}`);
    setDowntimeSeconds(savedDowntime ? Number(savedDowntime) || 0 : 0);
    setIsDowntimeTracking(true);

    const intervalId = setInterval(() => {
      setDowntimeSeconds(previous => {
        const nextValue = previous + 1;
        localStorage.setItem(`downtime_${selectedBox.id}`, String(nextValue));
        return nextValue;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [hwData.state, isHwOnline, selectedBox?.id]);

  useEffect(() => {
    const sesiTersimpan = sessionStorage.getItem('eloto_industrial_session');
    if (sesiTersimpan) {
      try {
        const userAktif = JSON.parse(sesiTersimpan);
        setSessionUser(userAktif);
        setIsLoggedIn(true);
        if (userAktif.role === 'teknisi' || userAktif.role === 'mekanik') setActiveTab('teknisi-tab');
        else setActiveTab('dashboard');
      } catch (e) {
        sessionStorage.removeItem('eloto_industrial_session');
      }
    }
  }, []);

  useEffect(() => {
    if (sessionUser?.role !== 'pengawas' || boxes.length === 0) return;
    setTeamBoxId(current => current || String(boxes[0].id));
  }, [sessionUser?.role, boxes]);

  useEffect(() => {
    if (sessionUser?.role !== 'pengawas' || !teamBoxId) return;
    const loadSupervisorTeam = async () => {
      try {
        const response = await secureFetch(`${API_BASE_URL}/supervisor/team?supervisor_sid=${encodeURIComponent(sessionUser.sid)}&id_box=${encodeURIComponent(teamBoxId)}&_=${Date.now()}`);
        const result = response.ok ? await response.json() : [];
        const team = result.data || result;
        setSelectedMechanicSids(Array.isArray(team) ? team.map(member => member.sid) : []);
        if (Array.isArray(team) && team[0]?.maintenance_type) setTeamMaintenanceType(team[0].maintenance_type);
      } catch (error) {
        setSelectedMechanicSids([]);
      }
    };
    loadSupervisorTeam();
  }, [sessionUser?.sid, sessionUser?.role, teamBoxId]);

  // POLLING TELEMETRI UTAMA - DUAL MODE
  useEffect(() => {
    if (!isLoggedIn || !isProtocolValid) return;

    const muatDataOperasionalMesin = async () => {
      if (overrideLockoutRef.current || isFetchingRef.current) return;
      isFetchingRef.current = true;

      try {
        const responseAset = await secureFetch(`${API_BASE_URL}/boxes?t=${Date.now()}`);
        if (responseAset.ok) {
          const resultAset = await responseAset.json();
          const dataAset = resultAset.data || resultAset;

          const dataMapped = Array.isArray(dataAset)
            ? dataAset.map(b => {
              const id_box = b.id_box || b.id;
              let extraHw = {};
              if (b.hw_data) {
                try {
                  extraHw = typeof b.hw_data === 'string' ? JSON.parse(b.hw_data) : b.hw_data;
                } catch (e) { }
              }

              const realLat = (b.lat && !isNaN(Number(b.lat)) && Number(b.lat) !== 0) ? Number(b.lat) : (extraHw.lat ? Number(extraHw.lat) : 2.144691);
              const realLng = (b.lng && !isNaN(Number(b.lng)) && Number(b.lng) !== 0) ? Number(b.lng) : ((b.lon && !isNaN(Number(b.lon)) && Number(b.lon) !== 0) ? Number(b.lon) : (extraHw.lng || extraHw.lon ? Number(extraHw.lng || extraHw.lon) : 117.477526));

              const merged = {
                ...extraHw,
                ...b,
                id: id_box,
                id_box: id_box,
                lat: realLat,
                lng: realLng,
                lon: realLng
              };

              if (realLat !== 0 && realLng !== 0) {
                const oldCoords = lastKnownCoordsRef.current[id_box];
                if (oldCoords) {
                  const selisih = Math.abs(oldCoords.lat - realLat) + Math.abs(oldCoords.lng - realLng);
                  if (selisih > 0.0001) {
                    pemicuToast(`📡 Posisi GPS Berpindah [${id_box}]!`, "ok");
                  }
                }
                lastKnownCoordsRef.current[id_box] = { lat: realLat, lng: realLng };
              }
              return merged;
            })
            : [];

          setBoxes(dataMapped);

          let boksTerbaru = null;
          if (selectedBoxIdRef.current) {
            boksTerbaru = dataMapped.find(b => String(b.id).toLowerCase().trim() === String(selectedBoxIdRef.current).toLowerCase().trim());
          }
          if (!boksTerbaru && dataMapped.length > 0) {
            boksTerbaru = dataMapped[0];
            selectedBoxIdRef.current = boksTerbaru.id;
          }

          if (boksTerbaru) {
            const bId = boksTerbaru.id;
            const configuredIp = String(boksTerbaru.ip || '').trim();
            const canProbeDevice = configuredIp && configuredIp !== '192.168.1.100' && configuredIp !== '0.0.0.0';
            let isDeviceActive = false;

            if (canProbeDevice) {
              try {
                const targetIp = configuredIp.startsWith('http') ? configuredIp : `http://${configuredIp}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2500);
                const locRes = await fetch(`${targetIp}/status`, { signal: controller.signal, mode: 'cors' });
                clearTimeout(timeoutId);
                if (locRes.ok) {
                  const locData = await locRes.json();
                  isDeviceActive = true;
                  boksTerbaru.is_online = 1;
                  boksTerbaru.lcd0 = locData.lcd0 || boksTerbaru.lcd0;
                  boksTerbaru.lcd1 = locData.lcd1 || boksTerbaru.lcd1;
                  boksTerbaru.state = locData.state || boksTerbaru.state;
                  boksTerbaru.relay_open = locData.relay_open !== undefined ? locData.relay_open : boksTerbaru.relay_open;
                  boksTerbaru.queue = locData.queue || boksTerbaru.queue;
                  boksTerbaru.last_uid = locData.last_uid || boksTerbaru.last_uid;
                  boksTerbaru.supervisor_uid = locData.supervisor_uid || boksTerbaru.supervisor_uid;
                  boksTerbaru.active_fuelman = locData.active_fuelman || boksTerbaru.active_fuelman;
                  boksTerbaru.gps_fix = locData.gps_fix !== undefined ? locData.gps_fix : boksTerbaru.gps_fix;
                  boksTerbaru.ssid = locData.ssid || boksTerbaru.ssid;
                  boksTerbaru.last_event = locData.last_event || boksTerbaru.last_event;
                  lastSeenOnlineRef.current[bId] = Date.now();
                }
              } catch (e) {
                // Fallback database
              }
            } else {
              // Tanpa IP perangkat, hanya heartbeat baru dari backend yang dianggap online.
              isDeviceActive = Number(boksTerbaru.is_online) === 1;
            }

            const lastSeen = lastSeenOnlineRef.current[bId] || 0;
            const isSmoothOnline = canProbeDevice
              ? isDeviceActive
              : (isDeviceActive && Date.now() - lastSeen < 15000);
            if (isDeviceActive) {
              const directIp = boksTerbaru.ip || '';
              if (directIp && directIp !== '192.168.1.100') {
                boksTerbaru.ip = directIp.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
              }
            }

            setSelectedBox(boksTerbaru);
            setIsHwOnline(isSmoothOnline);

            let queueFinal = [];
            if (Array.isArray(boksTerbaru.queue)) {
              queueFinal = boksTerbaru.queue;
            } else if (typeof boksTerbaru.queue === 'string') {
              try { queueFinal = JSON.parse(boksTerbaru.queue); } catch (e) { }
            }

            setHwData({
              lcd0: boksTerbaru.lcd0 || '  SISTEM READY',
              lcd1: boksTerbaru.lcd1 || 'TEKAN 1 UTK MULAI',
              state: boksTerbaru.state || 'STATE_IDLE',
              relay_open: boksTerbaru.relay_open == 1 || boksTerbaru.relay_open === true,
              last_event: boksTerbaru.last_event || '',
              last_event_ok: boksTerbaru.last_event_ok == 1 || boksTerbaru.last_event_ok === true,
              gps_fix: boksTerbaru.gps_fix == 1 || boksTerbaru.gps_fix === true,
              supervisor_uid: boksTerbaru.supervisor_uid || '—',
              active_fuelman: boksTerbaru.active_fuelman || '',
              last_uid: boksTerbaru.last_uid || '—',
              wifi_connected: isSmoothOnline,
              queue: queueFinal,
              audit_log: boksTerbaru.audit_log || [],
              uptime_ms: Number(boksTerbaru.uptime_ms || 0),
              lat: boksTerbaru.lat,
              lng: boksTerbaru.lng,
              lon: boksTerbaru.lng,
              ssid: boksTerbaru.ssid || 'Wi-Fi Hotspot'
            });
          }
        }
      } catch (err) { } finally {
        isFetchingRef.current = false;
      }
    };

    muatDataOperasionalMesin();
    const intervalKoneksi = setInterval(muatDataOperasionalMesin, 2500);
    return () => clearInterval(intervalKoneksi);
  }, [isLoggedIn, isProtocolValid]);

  useEffect(() => {
    if (!isHwOnline || !hwData.last_event || hwData.last_event === '—' || hwData.last_event === '') return;
    if (lastProcessedEventRef.current.event === hwData.last_event && lastProcessedEventRef.current.uid === hwData.last_uid) return;

    lastProcessedEventRef.current = { event: hwData.last_event, uid: hwData.last_uid };

    setLocalAuditLog(prev => [{
      ts: Date.now(),
      event: hwData.last_event,
      uid: hwData.last_uid,
      ok: hwData.last_event_ok,
      lat: selectedBox ? parseFloat(selectedBox.lat) : 2.144691,
      lon: selectedBox ? parseFloat(selectedBox.lng) : 117.477526,
      isLocal: true
    }, ...prev]);
  }, [hwData.last_event, hwData.last_uid, hwData.last_event_ok, isHwOnline, selectedBox?.id]);

  // INITIALISASI MAP LEAFLET
  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'dashboard' || !mapContainerRef.current) {
      if (leafletMapInstanceRef.current) {
        try { leafletMapInstanceRef.current.remove(); } catch (e) { }
        leafletMapInstanceRef.current = null;
        markersRef.current = {};
        lastCenteredBoxIdRef.current = null;
      }
      return;
    }

    const mapLat = (selectedBox && !isNaN(Number(selectedBox.lat)) && Number(selectedBox.lat) !== 0) ? Number(selectedBox.lat) : 2.144691;
    const mapLng = (selectedBox && !isNaN(Number(selectedBox.lng)) && Number(selectedBox.lng) !== 0) ? Number(selectedBox.lng) : 117.477526;

    if (!leafletMapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [mapLat, mapLng],
        zoom: 13,
        zoomControl: true
      });
      leafletMapInstanceRef.current = map;

      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: 'Google Satellite Hybrid'
      }).addTo(map);

      map.on('click', function (e) {
        if (e.originalEvent.target.closest('.custom-gps-marker') || e.originalEvent.target.closest('.leaflet-popup') || e.originalEvent.target.closest('.leaflet-tooltip')) return;
        map.closePopup();
        map.flyTo([2.144691, 117.477526], 13, { animate: true, duration: 1.2 });
      });

      map.on('zoomend', function () {
        if (map.getZoom() < 16) {
          map.closePopup();
        }
      });
    }

    const t1 = setTimeout(() => { if (leafletMapInstanceRef.current) leafletMapInstanceRef.current.invalidateSize(); }, 200);
    const t2 = setTimeout(() => { if (leafletMapInstanceRef.current) leafletMapInstanceRef.current.invalidateSize(); }, 600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isLoggedIn, activeTab]);

  // MANAGEMENT MARKER MAP
  useEffect(() => {
    const map = leafletMapInstanceRef.current;
    if (!map || activeTab !== 'dashboard' || !Array.isArray(boxes) || boxes.length === 0) return;

    const currentMarkerKeys = new Set();

    boxes.forEach((box) => {
      const bLat = Number(box.lat);
      const bLng = Number(box.lng || box.lon);
      if (isNaN(bLat) || isNaN(bLng) || bLat === 0 || bLng === 0) return;

      currentMarkerKeys.add(box.id);
      const isBoxLocked = box.state && box.state !== 'STATE_IDLE' && box.state !== 'STATE_REGISTER_RFID';
      const markerColor = isBoxLocked ? '#ef4444' : (box.state === 'STATE_REGISTER_RFID' ? '#2563eb' : '#22c55e');

      const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: `<svg width="30" height="42" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 32 12 32C12 32 24 21 24 12C24 5.37 18.63 0 12 0ZM12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16Z" fill="${markerColor}"/>
                               </svg>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42],
        popupAnchor: [0, -40]
      });

      const renderPopupContent = (bId, bUnit, bState, lat, lng) => {
        const cacheKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
        const addressText = geoAddressCacheRef.current[cacheKey];

        let locationHtml = `<div id="geo-${bId}" class="text-[10px] text-slate-600 mt-1 font-mono"><i class="fa-solid fa-location-crosshairs text-red-500"></i> Koordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
        if (addressText) {
          locationHtml = `<div id="geo-${bId}" class="text-[10px] text-slate-700 font-semibold mt-1"><i class="fa-solid fa-map-pin text-red-500"></i> ${addressText}</div>`;
        }

        return `<b>${bId}</b><br>Unit: ${bUnit}<br>Status: ${bState || 'STATE_IDLE'}<br>${locationHtml}`;
      };

      if (markersRef.current[box.id]) {
        const existingMarker = markersRef.current[box.id];
        existingMarker.setLatLng([bLat, bLng]);
        existingMarker.setIcon(customIcon);
        existingMarker.setPopupContent(renderPopupContent(box.id, box.unit, box.state, bLat, bLng));
      } else {
        const marker = L.marker([bLat, bLng], { icon: customIcon }).addTo(map)
          .bindPopup(renderPopupContent(box.id, box.unit, box.state, bLat, bLng))
          .bindTooltip(`${box.id} - ${box.unit}`, {
            permanent: true,
            direction: 'top',
            offset: [0, -42],
            className: 'box-permanent-label'
          });

        marker.on('popupopen', function () {
          const cacheKey = `${bLat.toFixed(5)}_${bLng.toFixed(5)}`;
          if (!geoAddressCacheRef.current[cacheKey]) {
            fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${bLat}&lon=${bLng}&zoom=18&addressdetails=1`)
              .then(res => res.json())
              .then(data => {
                const jalan = data.address.road || data.address.suburb || '';
                const desa = data.address.village || data.address.town || data.address.hamlet || '';
                const kec = data.address.subdistrict || data.address.city_district || 'Berau';

                const namaLokasiLengkap = [jalan, desa, kec].filter(Boolean).join(', ') || 'Area Operasional Lapangan';
                geoAddressCacheRef.current[cacheKey] = namaLokasiLengkap;

                const container = document.getElementById(`geo-${box.id}`);
                if (container) {
                  container.innerHTML = `<i class="fa-solid fa-map-pin text-red-500"></i> ${namaLokasiLengkap}`;
                }
              })
              .catch(() => {
                geoAddressCacheRef.current[cacheKey] = `GPS: ${bLat.toFixed(4)}, ${bLng.toFixed(4)}`;
              });
          }
        });
        marker.on('click', function () {
          handleSelectBox(box);
        });
        markersRef.current[box.id] = marker;
      }
    });

    Object.keys(markersRef.current).forEach(id => {
      if (!currentMarkerKeys.has(id)) {
        try { markersRef.current[id].remove(); } catch (e) { }
        delete markersRef.current[id];
      }
    });

    if (selectedBox) {
      const mapLat = !isNaN(Number(selectedBox.lat)) && Number(selectedBox.lat) !== 0 ? Number(selectedBox.lat) : 2.144691;
      const mapLng = !isNaN(Number(selectedBox.lng)) && Number(selectedBox.lng) !== 0 ? Number(selectedBox.lng) : 117.477526;

      const centerNow = map.getCenter();
      const distMoved = Math.abs(centerNow.lat - mapLat) + Math.abs(centerNow.lng - mapLng);

      if (lastCenteredBoxIdRef.current !== selectedBox.id || distMoved > 0.0001) {
        map.flyTo([mapLat, mapLng], 18, { animate: true, duration: 1.2 });
        setTimeout(() => {
          if (markersRef.current && markersRef.current[selectedBox.id]) {
            markersRef.current[selectedBox.id].openPopup();
          }
        }, 500);
        lastCenteredBoxIdRef.current = selectedBox.id;
      }
    }
  }, [boxes, selectedBox?.id, activeTab]);

  const handleAutoGps = async () => {
    setIsSyncing(true);
    pemicuToast("Mencari Sinyal Satelit GPS...", "ok");

    let latHasil = null;
    let lngHasil = null;

    try {
      const responseAset = await secureFetch(`${API_BASE_URL}/boxes?_=${Date.now()}`);
      if (responseAset.ok) {
        const resultAset = await responseAset.json();
        const dataAset = resultAset.data || resultAset;
        const targetId = (formAlatBerat.id || '').toLowerCase().trim();

        const boksTarget = Array.isArray(dataAset) ? dataAset.find(b =>
          String(b.id_box || b.id).toLowerCase().trim() === targetId ||
          (selectedBox && String(b.id_box || b.id).toLowerCase().trim() === String(selectedBox.id).toLowerCase().trim())
        ) || dataAset[0] : null;

        if (boksTarget) {
          const validLat = parseFloat(boksTarget.lat);
          const validLng = parseFloat(boksTarget.lng || boksTarget.lon);
          if (!isNaN(validLat) && !isNaN(validLng) && validLat !== 0 && validLng !== 0) {
            latHasil = validLat;
            lngHasil = validLng;
          }
        }
      }
    } catch (err) { }

    if ((!latHasil || !lngHasil) && formAlatBerat.ip) {
      try {
        const targetUrl = formAlatBerat.ip.startsWith('http') ? formAlatBerat.ip : `http://${formAlatBerat.ip}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const responseLoc = await fetch(`${targetUrl}/status`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (responseLoc.ok) {
          const dataEsps = await responseLoc.json();
          const vLat = parseFloat(dataEsps.lat);
          const vLng = parseFloat(dataEsps.lon || dataEsps.lng);
          if (!isNaN(vLat) && !isNaN(vLng) && vLat !== 0 && vLng !== 0) {
            latHasil = vLat;
            lngHasil = vLng;
          }
        }
      } catch (e) { }
    }

    if (latHasil && lngHasil) {
      setFormAlatBerat(prev => ({
        ...prev,
        lat: safeToFixed(latHasil, 6),
        lng: safeToFixed(lngHasil, 6)
      }));
      pemicuToast(`✓ GPS Terkunci! (${safeToFixed(latHasil, 4)}, ${safeToFixed(lngHasil, 4)})`, "ok");
    } else {
      setFormAlatBerat(prev => ({ ...prev, lat: "2.144691", lng: "117.477526" }));
      pemicuToast("⚠️ Mode Dasar Berau (2.1446, 117.4775)", "ok");
    }

    setIsSyncing(false);
  };

  const terjemahkanIdKeNamaLengkap = (idMentah) => {
    if (!idMentah || idMentah === '—' || idMentah === '') return '—';

    let searchId = String(idMentah).toUpperCase().trim();
    if (searchId.includes(':')) {
      searchId = searchId.split(':')[0].trim();
    }

    const hasilCari = userDatabase.find(u => {
      const uRfid = String(u.rfidUid || u.rfid_uid || '').toUpperCase().trim();
      const uSid = String(u.sid || '').toUpperCase().trim();
      return (uRfid !== '' && uRfid === searchId) || uSid === searchId;
    });

    return hasilCari ? `${hasilCari.nama} [${hasilCari.sid}]` : `Kartu (${idMentah})`;
  };

  const dapatkanMekanikDariAntreanLoto = () => {
    if (!selectedBox || !hwData || !Array.isArray(hwData.queue) || hwData.queue.length === 0) {
      return "";
    }
    const mekanikOnly = hwData.queue.filter(item => {
      const itemUid = typeof item === 'string' ? item : item.uid;
      const uObj = userDatabase.find(u => String(u.rfidUid || u.rfid_uid).toUpperCase() === String(itemUid).toUpperCase() || String(u.sid).toUpperCase() === String(itemUid).toUpperCase());
      const isSpv = (typeof item === 'object' && (item.role === 'spv' || item.role === 'pengawas')) || (uObj && uObj.role === 'pengawas') || (itemUid === hwData.supervisor_uid);
      return !isSpv;
    });
    if (mekanikOnly.length === 0) return "";
    return mekanikOnly.map(m => terjemahkanIdKeNamaLengkap(typeof m === 'string' ? m : m.uid)).join(", ");
  };

  const dapatkanPengawasDariLoto = () => {
    if (!selectedBox || !hwData) return "";
    if (hwData.supervisor_uid && hwData.supervisor_uid !== '—' && hwData.supervisor_uid !== '') {
      return terjemahkanIdKeNamaLengkap(hwData.supervisor_uid);
    }
    if (Array.isArray(hwData.queue)) {
      const spvItem = hwData.queue.find(item => {
        const itemUid = typeof item === 'string' ? item : item.uid;
        const uObj = userDatabase.find(u => String(u.rfidUid || u.rfid_uid).toUpperCase() === String(itemUid).toUpperCase() || String(u.sid).toUpperCase() === String(itemUid).toUpperCase());
        return (typeof item === 'object' && (item.role === 'spv' || item.role === 'pengawas')) || (uObj && uObj.role === 'pengawas');
      });
      if (spvItem) return terjemahkanIdKeNamaLengkap(typeof spvItem === 'string' ? spvItem : spvItem.uid);
    }
    return "";
  };

  const handleSelectBox = (box) => {
    selectedBoxIdRef.current = box.id;
    setSelectedBox(box);

    const clickLat = Number(box.lat);
    const clickLng = Number(box.lng || box.lon);

    if (leafletMapInstanceRef.current && !isNaN(clickLat) && !isNaN(clickLng) && clickLat !== 0 && clickLng !== 0) {
      leafletMapInstanceRef.current.flyTo([clickLat, clickLng], 18, {
        animate: true,
        duration: 1.2
      });

      setTimeout(() => {
        if (markersRef.current && markersRef.current[box.id]) {
          markersRef.current[box.id].openPopup();
        }
      }, 500);
    }
    lastCenteredBoxIdRef.current = box.id;
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setSessionUser(null);
    sessionStorage.removeItem('eloto_industrial_session');
    pemicuToast("Sesi kerja berhasil ditutup.", "ok");
  };

  const handleSaveMechanicTeam = async (event) => {
    event.preventDefault();
    const selectedNames = groupTeknisi.filter(user => selectedMechanicSids.includes(user.sid)).map(user => user.nama);
    try {
      const response = await secureFetch(`${API_BASE_URL}/supervisor/team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supervisor_sid: sessionUser.sid, id_box: teamBoxId, maintenance_type: teamMaintenanceType, mechanic_sids: selectedMechanicSids })
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'success') throw new Error(result.message || 'Gagal menyimpan tim.');
      setManualMekanik(selectedNames.join(', '));
      pemicuToast(`${selectedNames.length} mekanik dipilih untuk ${teamBoxId}.`, 'ok');
    } catch (error) {
      pemicuToast(error.message || 'Gagal menyimpan tim mekanik.', 'fail');
    }
  };

  const handleTambahAlatBerat = async (e) => {
    e.preventDefault();
    const cleanId = formAlatBerat.id.replace(/[<>]/g, "").trim();
    const cleanUnit = formAlatBerat.unit.replace(/[<>]/g, "").trim();
    const cleanIp = formAlatBerat.ip.replace(/[<>]/g, "").trim();
    const cleanLat = parseFloat(formAlatBerat.lat);
    const cleanUnitLng = parseFloat(formAlatBerat.lng);

    const newUnit = {
      id_box: cleanId, unit: cleanUnit, ip: cleanIp || '192.168.1.100',
      lat: isNaN(cleanLat) ? '' : cleanLat, lng: isNaN(cleanUnitLng) ? '' : cleanUnitLng
    };
    try {
      const endpoint = editingBoxId
        ? `${API_BASE_URL}/boxes/${encodeURIComponent(editingBoxId)}`
        : `${API_BASE_URL}/boxes`;
      const response = await secureFetch(endpoint, {
        method: editingBoxId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newUnit, idBox: cleanId })
      });
      const hasil = await response.json();
      if (hasil.success || hasil.status === 'success') {
        const savedBox = { ...newUnit, id: cleanId };
        setBoxes(prev => editingBoxId ? prev.map(box => String(box.id) === String(cleanId) ? { ...box, ...savedBox } : box) : [...prev, savedBox]);
        setSelectedBox(prev => prev && String(prev.id) === String(cleanId) ? { ...prev, ...savedBox } : savedBox);
        selectedBoxIdRef.current = cleanId;
        setEditingBoxId('');
        setFormAlatBerat({ id: '', unit: '', ip: '', lat: '', lng: '' });
        pemicuToast(editingBoxId ? 'Data boks berhasil diperbarui.' : (hasil.message || 'Berhasil menyimpan boks'), 'ok');
      } else {
        pemicuToast(hasil.message, 'fail');
      }
    } catch (err) {
      pemicuToast("Gagal mendaftarkan unit box ke server!", "fail");
    }
  };

  const handleEditAlatBerat = (box) => {
    setEditingBoxId(box.id);
    setFormAlatBerat({
      id: box.id || '',
      unit: box.unit || '',
      ip: box.ip || '',
      lat: box.lat || '',
      lng: box.lng || box.lon || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBatalEditAlatBerat = () => {
    setEditingBoxId('');
    setFormAlatBerat({ id: '', unit: '', ip: '', lat: '', lng: '' });
  };

  const handleHapusAlatBerat = async (idBox) => {
    if (window.confirm(`Hapus ${idBox} secara permanen?`)) {
      try {
        const response = await secureFetch(`${API_BASE_URL}/boxes/${idBox}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idBox, id_box: idBox })
        });
        const hasil = await response.json();
        if (hasil.success || hasil.status === 'success') {
          const sisaBox = boxes.filter(b => String(b.id).toLowerCase().trim() !== String(idBox).toLowerCase().trim());
          setBoxes(sisaBox);
          if (selectedBox && String(selectedBox.id).toLowerCase().trim() === String(idBox).toLowerCase().trim()) {
            setSelectedBox(sisaBox[0] || null);
            selectedBoxIdRef.current = sisaBox[0] ? sisaBox[0].id : null;
          }
          pemicuToast(hasil.message || 'Boks dihapus', "ok");
        } else {
          pemicuToast(hasil.message, "fail");
        }
      } catch (err) { pemicuToast("Gagal terhubung ke API hapus unit.", "fail"); }
    }
  };

  const handleCaptureKamera = (e) => {
    const file = e.target.files[0];
    if (file) {
      pemicuToast("Mengompresi foto bukti...", "ok");
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const max_width = 800;
          let width = img.width;
          let height = img.height;

          if (width > max_width) {
            height = Math.round((height * max_width) / width);
            width = max_width;
          }
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
          setPhotoBase64(compressedBase64);
          pemicuToast(" ✓ Foto Berhasil Direkam!", "ok");
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleIndukTambahUser = async (e) => {
    e.preventDefault();
    const cleanSid = formAdminNewUser.sid.replace(/[<>]/g, "").trim();
    const cleanNama = formAdminNewUser.nama.replace(/[<>]/g, "").trim();
    const cleanRfid = formAdminNewUser.rfidUid.replace(/[<>]/g, "").trim();

    if (!cleanSid || !cleanNama) {
      alert("Mohon lengkapi ID Karyawan (SID) dan Nama Lengkap!");
      return;
    }

    const dataKaryawanBaru = {
      sid: cleanSid,
      nama: cleanNama,
      role: formAdminNewUser.role,
      rfidUid: cleanRfid,
      password: cleanSid,
      foto: formAdminNewUser.foto || 'assets/default-avatar.png'
    };

    try {
      const response = await secureFetch(`${API_BASE_URL}/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dataKaryawanBaru)
      });
      const hasil = await response.json();
      if (hasil.success || hasil.status === 'success') {
        setUserDatabase([...userDatabase, { ...dataKaryawanBaru }]);
        setFormAdminNewUser({ sid: '', nama: '', role: 'teknisi', rfidUid: '', password: '', foto: '' });
        setShowAddUserForm(false);
        pemicuToast(` ✓ ${hasil.message || 'Karyawan didaftarkan'}`, "ok");
      } else {
        pemicuToast(hasil.message, "fail");
      }
    } catch (err) { pemicuToast("Gagal mendaftarkan personel ke database!", "fail"); }
  };

  const handleImportExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    pemicuToast("Membaca berkas Excel...", "ok");
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (jsonRows.length === 0) {
          pemicuToast("Berkas Excel kosong atau tidak memiliki baris data!", "fail");
          return;
        }

        pemicuToast(`Mengimpor ${jsonRows.length} data karyawan...`, "ok");
        let suksesCount = 0;

        for (const row of jsonRows) {
          let sidVal = '', namaVal = '', roleVal = 'teknisi', rfidVal = '';

          Object.keys(row).forEach(key => {
            const kLower = key.toLowerCase().trim();
            const val = String(row[key] || '').trim();

            if (kLower.includes('sid') || kLower.includes('id')) {
              if (!sidVal && val) sidVal = val;
            }
            if (kLower.includes('nama')) {
              if (!namaVal && val) namaVal = val;
            }
            if (kLower.includes('role') || kLower.includes('jabatan')) {
              if (val) {
                const rLower = val.toLowerCase();
                if (rLower.includes('pengawas') || rLower.includes('spv') || rLower.includes('k3') || rLower.includes('supervisor')) {
                  roleVal = 'pengawas';
                } else if (rLower.includes('fuel') || rLower.includes('bbm') || rLower.includes('refuel')) {
                  roleVal = 'fuelman';
                } else {
                  roleVal = 'teknisi';
                }
              }
            }
            if (kLower.includes('rfid')) {
              if (val) rfidVal = val.toUpperCase();
            }
          });

          if (sidVal && namaVal) {
            const payload = {
              sid: sidVal,
              nama: namaVal,
              role: roleVal,
              rfidUid: rfidVal,
              password: sidVal,
              foto: 'assets/default-avatar.png'
            };

            try {
              const res = await secureFetch(`${API_BASE_URL}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              const resJson = await res.json();
              if (resJson.success || resJson.status === 'success') {
                suksesCount++;
              }
            } catch (err) {}
          }
        }

        const responseUsers = await secureFetch(`${API_BASE_URL}/users?_=${Date.now()}`);
        if (responseUsers.ok) {
          const resultUsers = await responseUsers.json();
          const dataUsers = resultUsers.data || resultUsers;
          const masterAdmin = { sid: 'Admin', nama: 'Master Administrator', role: 'admin', rfidUid: '0000', password: 'Admin', foto: 'assets/default-avatar.png' };
          const dataSteril = Array.isArray(dataUsers)
            ? dataUsers.map(u => ({
              ...u,
              role: String(u.role || '').toLowerCase().includes('pengawas') ? 'pengawas' : (String(u.role || '').toLowerCase().includes('fuel') ? 'fuelman' : 'teknisi'),
              rfidUid: u.rfid_uid || u.rfidUid || '',
              foto: u.foto || 'assets/default-avatar.png'
            })).filter(u => u.sid !== 'Admin')
            : [];
          setUserDatabase([masterAdmin, ...dataSteril]);
        }

        pemicuToast(` ✓ Berhasil mengimpor ${suksesCount} data karyawan ke MySQL!`, "ok");
        e.target.value = '';
      } catch (err) {
        pemicuToast("Gagal memproses berkas Excel!", "fail");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBukaModalEditUser = (user, defaultRfidInput = '') => {
    setFormEditUser({
      sid: user.sid,
      nama: user.nama,
      role: user.role || 'teknisi',
      rfidUid: defaultRfidInput || user.rfidUid || user.rfid_uid || '',
      foto: user.foto || ''
    });
    setShowEditUserModal(true);
  };

  const handleSimpanEditUser = async (e) => {
    e.preventDefault();
    const cleanSid = formEditUser.sid.trim();
    const cleanNama = formEditUser.nama.trim();
    const cleanRfid = formEditUser.rfidUid.trim().toUpperCase();

    if (!cleanSid || !cleanNama) {
      pemicuToast("SID dan Nama Karyawan Wajib Diisi!", "fail");
      return;
    }

    const payloadUser = {
      sid: cleanSid,
      nama: cleanNama,
      role: formEditUser.role,
      rfidUid: cleanRfid,
      password: cleanSid,
      foto: formEditUser.foto || 'assets/default-avatar.png'
    };

    try {
      const response = await secureFetch(`${API_BASE_URL}/users/${cleanSid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadUser)
      });
      const hasil = await response.json();
      if (hasil.success || hasil.status === 'success') {
        const fotoTerbaru = hasil.data?.profile_photo || hasil.foto || payloadUser.foto;
        setUserDatabase(prev => prev.map(u => u.sid === cleanSid ? { ...u, ...payloadUser, foto: fotoTerbaru } : u));
        setSessionUser(prev => prev?.sid === cleanSid ? { ...prev, ...payloadUser, foto: fotoTerbaru } : prev);
        setShowEditUserModal(false);
        pemicuToast(` ✓ Data ${cleanNama} berhasil diperbarui!`, "ok");
      } else {
        pemicuToast(hasil.message || "Gagal memperbarui data personel!", "fail");
      }
    } catch (err) {
      pemicuToast("Gagal terhubung ke database!", "fail");
    }
  };

  const handleHapusUser = async (sidUser) => {
    if (sidUser === 'Admin') {
      alert("Akun Master Admin utama tidak boleh dihapus!");
      return;
    }
    if (window.confirm(`Hapus permanen data karyawan dengan ID: ${sidUser}?`)) {
      try {
        const response = await secureFetch(`${API_BASE_URL}/users/${sidUser}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sidUser })
        });
        const hasil = await response.json();
        if (hasil.success || hasil.status === 'success') {
          setUserDatabase(userDatabase.filter(u => u.sid !== sidUser));
          pemicuToast(hasil.message || "Pengguna berhasil dihapus", "ok");
        }
      } catch (err) { pemicuToast("Gagal menghapus data dari database.", "fail"); }
    }
  };

  const handleHapusBuffer = async (idBuffer) => {
    if (window.confirm("Hapus kartu ini dari antrean buffer?")) {
      try {
        const response = await secureFetch(`${API_BASE_URL}/logs/buffer/${idBuffer}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idBuffer })
        });
        const hasil = await response.json();
        if (hasil.success || hasil.status === 'success') {
          setRfidBufferList(prev => prev.filter(item => item.id !== idBuffer));
          pemicuToast(" ✓ " + (hasil.message || "Berhasil"), "ok");
        } else {
          pemicuToast(hasil.message || "Gagal menghapus kartu!", "fail");
        }
      } catch (err) {
        pemicuToast("Gagal terhubung ke API buffer", "fail");
      }
    }
  };

  const handleSimpanKerusakan = async (e) => {
    e.preventDefault();

    const mekanikFinal = manualMekanik.trim() || dapatkanMekanikDariAntreanLoto();
    if (!mekanikFinal || mekanikFinal.startsWith("TIDAK ADA MEKANIK")) {
      pemicuToast("GAGAL: Nama mekanik penanggung jawab wajib diisi atau di-tap!", "fail");
      return;
    }

    const pengawasFinal = pengawasLoto.trim() || dapatkanPengawasDariLoto() || 'Diverifikasi RFID LOTO';
    const cleanDeskripsi = formDeskripsi.replace(/[<>]/g, "").trim();
    const cleanEstimasi = estimasiWaktu.replace(/[<>]/g, "").trim();
    const statusKerjaAktif = (manualMekanik.trim() || (isHwOnline && hwData.queue && hwData.queue.length > 0)) ? 'PROSES' : 'SELESAI';

    const dataLaporanBaru = {
      waktu: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
      mesin: selectedBox ? selectedBox.id : 'Universal Box',
      id_box: selectedBox ? selectedBox.id : 'Universal Box',
      jenis: tipeKerusakan,
      estimasi: cleanEstimasi || '4 Jam',
      teknisi: mekanikFinal,
      pengawas: pengawasFinal,
      deskripsi: cleanDeskripsi,
      status: statusKerjaAktif,
      foto: photoBase64
    };
    try {
      const response = await secureFetch(`${API_BASE_URL}/maintenance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dataLaporanBaru)
      });
      const hasil = await response.json();
      if (hasil.success || hasil.status === 'success') {
        setLogPemeliharaan(prev => [dataLaporanBaru, ...prev]);
        setFormDeskripsi(''); setEstimasiWaktu(''); setPhotoBase64('');
        setManualMekanik(''); setPengawasLoto('');
        pemicuToast(hasil.message || "Tersimpan", "ok");
      } else {
        pemicuToast(hasil.message || "Gagal menyimpan laporan!", "fail");
      }
    } catch (err) { pemicuToast("Gagal menyimpan laporan kerusakan ke MySQL!", "fail"); }
  };

  const handleHapusLogPemeliharaan = async (idLog) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus arsip riwayat maintenance ini?")) {
      try {
        const response = await secureFetch(`${API_BASE_URL}/maintenance/${idLog}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idLog })
        });
        const hasil = await response.json();
        if (hasil.success || hasil.status === 'success') {
          setLogPemeliharaan(logPemeliharaan.filter(log => log.id !== idLog));
          pemicuToast(hasil.message || "Terhapus", "ok");
        } else {
          pemicuToast(hasil.message, "fail");
        }
      } catch (err) { pemicuToast("Gagal menghubungi server hapus log.", "fail"); }
    }
  };

  const handleHapusRiwayatTapping = async (idRiwayat, eventIds = [idRiwayat]) => {
    if (!window.confirm("Hapus sesi tapping ini secara permanen?")) return;
    try {
      const response = await secureFetch(`${API_BASE_URL}/logs/tapping-history/${idRiwayat}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: idRiwayat, event_ids: eventIds })
      });
      const hasil = await response.json();
      if (hasil.success || hasil.status === 'success') {
        setTappingHistory(prev => prev.filter(entry => !eventIds.includes(Number(entry.id))));
        pemicuToast(hasil.message || "Sesi Dihapus", "ok");
      } else {
        pemicuToast(hasil.message || "Gagal menghapus riwayat tapping.", "fail");
      }
    } catch (err) { pemicuToast("Gagal terhubung ke server hapus riwayat.", "fail"); }
  };

  const handleHapusAudit = async (idLog) => {
    if (!window.confirm("Hapus log aktivitas ini secara permanen?")) return;
    try {
      const response = await secureFetch(`${API_BASE_URL}/logs/audit/${idLog}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: idLog })
      });
      const hasil = await response.json();
      if (hasil.success || hasil.status === 'success') {
        setDeletedAuditIds(prev => [...prev, Number(idLog)]);
        setLocalAuditLog(prev => prev.filter(log => Number(log.id) !== Number(idLog)));
        pemicuToast(hasil.message || "Terhapus", "ok");
      } else {
        pemicuToast(hasil.message || "Gagal menghapus log aktivitas.", "fail");
      }
    } catch (err) { pemicuToast("Gagal terhubung ke server hapus log.", "fail"); }
  };

  const triggerSimulasiExcel = (logItem) => {
    pemicuToast(" ⚡ Memproses Format Excel K3 + Injeksi Foto...", "ok");
    setTimeout(() => {
      const fotoContent = logItem.foto ? `<img src="${logItem.foto}" onerror="this.onerror=null;this.src='assets/default-avatar.png';" style="max-width:140px; max-height:100px; display:block; border:1px solid #cbd5e1;" />` : "Tidak Ada Lampiran Foto Bukti";

      const excelTemplate = `
                        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                        <head>
                            <style>
                                table { border-collapse: collapse; font-family: 'Segoe UI', Arial, sans-serif; }
                                th { background-color: #dc2626; color: white; font-weight: bold; font-size: 13px; text-align: center; padding: 12px; border: 1px solid #94a3b8; }
                                td { padding: 8px; border: 1px solid #cbd5e1; font-size: 12px; vertical-align: middle; }
                                .lbl-header { background-color: #f1f5f9; font-weight: bold; color: #334155; }
                            </style>
                        </head>
                        <body>
                            <table>
                                <thead>
                                    <tr><th colspan="2">DOKUMEN MANIFES K3 INDUSTRI - EKSPOR LAPORAN LOTO</th></tr>
                                </thead>
                                <tbody>
                                    <tr><td class="lbl-header" width="180">Waktu Laporan</td><td>${logItem.waktu}</td></tr>
                                    <tr><td class="lbl-header">ID Smart Box / Mesin</td><td style="font-weight: bold; color: #b91c1c;">${logItem.mesin}</td></tr>
                                    <tr><td class="lbl-header">Teknisi PIC</td><td>${logItem.teknisi}</td></tr>
                                    <tr><td class="lbl-header">Pengawas K3</td><td>${logItem.pengawas || "—"}</td></tr>
                                    <tr><td class="lbl-header">Klasifikasi Gangguan</td><td>${logItem.jenis}</td></tr>
                                    <tr><td class="lbl-header">Estimasi Downtime</td><td>${logItem.estimasi}</td></tr>
                                    <tr><td class="lbl-header">Rincian Deskripsi K3</td><td>${logItem.deskripsi || "-"}</td></tr>
                                    <tr><td class="lbl-header">Status Akhir Sesi</td><td style="font-weight:bold; color:${logItem.status === 'PROSES' ? '#d97706' : '#15803d'}">${logItem.status}</td></tr>
                                    <tr style="height: 110px;"><td class="lbl-header">Bukti Visual Kerusakan</td><td>${fotoContent}</td></tr>
                                </tbody>
                            </table>
                        </body>
                        </html>
                    `;

      const blob = new Blob([excelTemplate], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Manifes_K3_LOTO_${logItem.mesin}_${logItem.id || 'Arsip'}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 600);
  };

  const exportAuditTrailToCSV = () => {
    pemicuToast("Mengekspor data log audit harian...", "ok");
    const headers = "Waktu,Aktivitas/Event,Personel/UID,Koordinat GPS\n";
    const rows = logsYgDitampilkan.map(log => {
      const waktu = log.ts ? new Date(Number(log.ts)).toLocaleTimeString('id-ID') : 'T - ' + Math.max(0, Math.round((hwData.uptime_ms - log.ts) / 1000)) + 's';
      const namaPersonel = terjemahkanIdKeNamaLengkap(log.uid).replace(/,/g, "");
      return `${waktu},${log.event},${namaPersonel},"${safeToFixed(log.lat, 4)}, ${safeToFixed(log.lon || log.lng, 4)}"`;
    }).join("\n");

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(headers + rows);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `Audit_Trail_ELOTO_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const triggerEmergencyOverride = () => {
    const konfirmasi = window.confirm(" ⚠ PERINGATAN BUKA PAKSA K3 ⚠ \n\nApakah Anda yakin ingin membuka paksa antrean gembok untuk keperluan darurat?");
    if (!konfirmasi) return;

    const passwordConfirm = window.prompt("Masukkan Kata Sandi Administrator untuk verifikasi:");
    if (passwordConfirm !== 'Admin') {
      pemicuToast("Kata sandi salah!", "fail");
      return;
    }
    pemicuToast("Mengirim sinyal buka paksa...", "ok");
    overrideLockoutRef.current = true;

    setHwData(prev => ({
      ...prev,
      state: 'STATE_MAINTENANCE_DONE',
      queue: [],
      lcd0: 'OVERRIDE DARURAT',
      lcd1: 'ANTREAN BYPASS OK'
    }));
    setIsDowntimeTracking(false);
    if (selectedBox) localStorage.removeItem(`downtime_${selectedBox.id}`);
    pemicuToast(" 🚨 Antrean Berhasil Dikosongkan!", "ok");

    setTimeout(() => {
      overrideLockoutRef.current = false;
    }, 15000);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const sid = formData.sid.trim();
    const password = formData.password;
    if (!sid || !password) return;

    try {
      const response = await secureFetch(`${API_BASE_URL}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid, password })
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.data) {
        pemicuToast(result.message || "ID Karyawan (SID) atau Kata Sandi Salah!", "fail");
        return;
      }

      const role = String(result.data.role || '').toLowerCase();
      const user = {
        ...result.data,
        rfidUid: result.data.rfid_uid || result.data.rfidUid || '',
        foto: result.data.foto || 'assets/default-avatar.png',
        role: role.includes('pengawas') ? 'pengawas' : (role.includes('fuel') ? 'fuelman' : (role.includes('admin') ? 'admin' : 'teknisi'))
      };
      setSessionUser(user);
      setIsLoggedIn(true);
      sessionStorage.setItem('eloto_industrial_session', JSON.stringify(user));
      pemicuToast(`Selamat Datang: ${user.nama}`, 'ok');
      if (user.role === 'teknisi' || user.role === 'mekanik') setActiveTab('teknisi-tab');
      else setActiveTab('dashboard');
    } catch (error) {
      pemicuToast("Gagal terhubung ke server login!", "fail");
    }
  };

  // FILTER KARYAWAN
  const filteredUsers = Array.isArray(userDatabase)
    ? userDatabase.filter(user => user.nama.toLowerCase().includes(adminSearchTerm.toLowerCase()) || user.sid.toLowerCase().includes(adminSearchTerm.toLowerCase()))
    : [];

  const groupPengawas = filteredUsers.filter(u => u.role === 'pengawas' || u.role === 'spv');
  const groupTeknisi = filteredUsers.filter(u => u.role === 'teknisi' || u.role === 'mekanik');
  const groupFuelman = filteredUsers.filter(u => u.role === 'fuelman' || u.role === 'bbm');
  const groupAdmin = filteredUsers.filter(u => u.role === 'admin');
  const filteredTeamMechanics = groupTeknisi.filter(user => {
    const searchText = `${user.nama} ${user.sid} ${user.rfidUid || user.rfid_uid || ''}`.toLowerCase();
    return searchText.includes(mechanicSearchTerm.toLowerCase());
  });

  // FILTER BOKS PADA DAFTAR DI PANEL RADAR
  const filteredBoxes = Array.isArray(boxes)
    ? boxes.filter(b =>
      String(b.id || '').toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
      String(b.unit || '').toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
      String(b.ip || '').toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
      String(b.ssid || '').toLowerCase().includes(boxSearchTerm.toLowerCase())
    )
    : [];

  // FILTER BOX PADA MODAL RADAR
  const filteredBoxesInModal = Array.isArray(boxes)
    ? boxes.filter(b =>
      String(b.id || '').toLowerCase().includes(radarModalSearch.toLowerCase()) ||
      String(b.unit || '').toLowerCase().includes(radarModalSearch.toLowerCase()) ||
      String(b.ip || '').toLowerCase().includes(radarModalSearch.toLowerCase()) ||
      String(b.ssid || '').toLowerCase().includes(radarModalSearch.toLowerCase())
    )
    : [];

  // BINDING RIWAYAT DATABASE AUDIT_LOGS
  const rawLogs = (isHwOnline && hwData.audit_log && hwData.audit_log.length > 0) ? hwData.audit_log : localAuditLog;
  const logsYgDitampilkan = Array.isArray(rawLogs)
    ? rawLogs.filter(log => !deletedAuditIds.includes(Number(log.id)) && !['SYS_INIT', 'DB_READY', 'REG_BOX', 'DEL_BOX', 'USER_AUTH', 'SESSION_CLOSE', 'ADD_USER', 'DEL_USER', 'REPORT_SAVE', 'OVERRIDE_K3'].includes(log.event))
    : [];

  const filteredAuditLogs = logsYgDitampilkan.filter(log =>
    String(log.event || '').toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
    String(terjemahkanIdKeNamaLengkap(log.uid) || '').toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
    String(log.uid || '').toLowerCase().includes(auditSearchTerm.toLowerCase())
  );

  // BUKU RIWAYAT LENGKAP PINDAIAN KARTU (TETAP TERCATAT SETELAH KELUAR)
  const dataTappingProcessed = useMemo(() => {
    const results = [];
    const queueList = Array.isArray(hwData.queue) ? hwData.queue : [];

    const latestTappingByPerson = new Map();
    const formatWaktu = value => value ? new Date(String(value).replace(' ', 'T')).toLocaleTimeString('id-ID') : '—';
    if (Array.isArray(tappingHistory)) {
      tappingHistory.forEach((entry, index) => {
        const uid = String(entry.rfid_uid || entry.rfidUid || '').trim();
        const boxId = String(entry.id_box || entry.idBox || '').trim();
        if (!uid || isAdminUid(uid)) return;
        const key = `${boxId.toLowerCase()}::${uid.toLowerCase()}`;
        if (!latestTappingByPerson.has(key)) {
          const eventType = String(entry.event_type || entry.eventType || '').toUpperCase();
          latestTappingByPerson.set(key, { entry, uid, boxId, eventType, index });
        }
      });

      latestTappingByPerson.forEach(({ entry, uid, eventType, index }) => {
        const isOut = eventType === 'OUT';
        const isIn = eventType === 'IN' && isHwOnline;
        results.push({
          id: `history-row-${entry.id || index}-${uid}`,
          uid,
          nama: entry.nama || getUserProfile(uid).nama,
          foto: getUserProfile(uid).foto,
          status: isOut ? 'SUDAH KELUAR' : (isIn ? 'SESI AKTIF' : (entry.event_text || 'TERCATAT')),
          badgeColor: isOut ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-green-50 text-green-700 border-green-200',
          waktuMasuk: isIn ? formatWaktu(entry.created_at) : '—',
          waktuKeluar: isOut ? formatWaktu(entry.created_at) : '— (Sedang di Dalam)',
          isInside: isIn
        });
      });
    }

    // 1. Catat Personel yang Sedang Berada di Dalam (IN)
    queueList.forEach((qItem, idx) => {
      const uid = typeof qItem === 'string' ? qItem : (qItem.uid || qItem.last_uid || '');
      if (isAdminUid(uid)) return;
      const boxId = String(selectedBox?.id || hwData.id_box || '').toLowerCase();
      const tappingKey = `${boxId}::${String(uid).toLowerCase()}`;
      if (latestTappingByPerson.get(tappingKey)?.eventType === 'OUT') return;
      const isSpv = (uid === hwData.supervisor_uid) || (idx === 0 && hwData.state !== 'STATE_IDLE' && hwData.state !== 'STATE_REGISTER_RFID');
      const waktuMasuk = new Date(Date.now() - (queueList.length - idx) * 45000).toLocaleTimeString('id-ID');

      results.push({
        id: `active-${uid}-${idx}`,
        uid,
        nama: getUserProfile(uid).nama,
        foto: getUserProfile(uid).foto,
        status: isSpv ? 'PENGAWAS (IN)' : 'MEKANIK (IN)',
        badgeColor: isSpv ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-green-50 text-green-700 border-green-200',
        waktuMasuk: waktuMasuk,
        waktuKeluar: '— (Sedang di Dalam)',
        isInside: true
      });
    });

    // 2. Catat Petugas BBM yang Aktif
    if (hwData.active_fuelman && hwData.active_fuelman !== '' && !isAdminUid(hwData.active_fuelman)) {
      results.push({
        id: 'fuelman-active',
        uid: hwData.active_fuelman,
        nama: getUserProfile(hwData.active_fuelman).nama,
        foto: getUserProfile(hwData.active_fuelman).foto,
        status: 'PENGISIAN BBM',
        badgeColor: 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse',
        waktuMasuk: new Date(Date.now() - 120000).toLocaleTimeString('id-ID'),
        waktuKeluar: '— (Sedang di Lokasi)',
        isInside: true
      });
    }

    // 3. Tambahkan Riwayat Pengetapan Keluar (OUT) & Log Audit Nyata dari Database MySQL
    logsYgDitampilkan.forEach((l, i) => {
      const eventLower = String(l.event || '').toLowerCase();
      const isValidTappingEvent = /^(supervisor_lock_in|supervisor_log_out|mechanic_log_in|mechanic_log_out|refuel_start|refuel_end)$/i.test(String(l.event || '').trim());
      if (!isValidTappingEvent) return;
      if (isAdminUid(l.uid)) return;
      const isOut = eventLower.includes('out') || eventLower.includes('keluar');
      const isIn = eventLower.includes('in') || eventLower.includes('masuk');
      const tLog = l.ts ? new Date(Number(l.ts)).toLocaleTimeString('id-ID') : new Date().toLocaleTimeString('id-ID');

      if (!results.some(r => r.uid === l.uid && r.isInside)) {
        results.push({
          id: `history-${l.id || i}-${l.uid}`,
          uid: l.uid,
          nama: getUserProfile(l.uid).nama,
          foto: getUserProfile(l.uid).foto,
          status: isOut ? 'KELUAR (OUT) - SELESAI' : (isIn ? 'SUDAH KELUAR' : l.event),
          badgeColor: isOut ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-red-50 text-red-600 border-red-200',
          waktuMasuk: isIn ? tLog : '—',
          waktuKeluar: isOut ? tLog : 'Selesai',
          isInside: false
        });
      }
    });

    return results;
  }, [hwData.queue, hwData.active_fuelman, hwData.supervisor_uid, logsYgDitampilkan, tappingHistory, userDatabase]);

  // FILTER TABEL DATA PINDAIAN
  const filteredTappingData = dataTappingProcessed.filter(row =>
    row.nama.toLowerCase().includes(tappingSearchTerm.toLowerCase()) ||
    row.uid.toLowerCase().includes(tappingSearchTerm.toLowerCase()) ||
    row.status.toLowerCase().includes(tappingSearchTerm.toLowerCase())
  );

  const sessionHistoryRows = useMemo(() => {
    const rawHistory = Array.isArray(tappingHistory) ? tappingHistory : [];
    const rows = [];
    const latestByPerson = new Map();
    rawHistory.forEach((entry, index) => {
      const uid = String(entry.rfid_uid || entry.rfidUid || '').trim();
      const boxId = String(entry.id_box || entry.idBox || 'Universal Box').trim();
      if (!uid) return;
      const key = `${boxId.toLowerCase()}::${uid.toLowerCase()}`;
      if (!latestByPerson.has(key)) latestByPerson.set(key, { entry, uid, boxId, index });
    });
    latestByPerson.forEach(({ entry, uid, boxId, index }) => {
      const eventType = String(entry.event_type || entry.eventType || '').toUpperCase();
      const eventTime = entry.created_at;
      const eventIds = rawHistory
        .filter(item => String(item.id_box || item.idBox || 'Universal Box').trim().toLowerCase() === boxId.toLowerCase()
          && String(item.rfid_uid || item.rfidUid || '').trim().toLowerCase() === uid.toLowerCase())
        .map(item => Number(item.id)).filter(Number.isInteger);
      rows.push({
        id: `session-${entry.id || index}`,
        deleteId: entry.id,
        deleteIds: eventIds,
        id_box: boxId,
        sessionDate: String(eventTime || '').slice(0, 10) || 'tanpa-tanggal',
        sessionStart: eventType === 'IN' ? eventTime : null,
        sessionEnd: eventType === 'OUT' || (eventType === 'IN' && !isHwOnline) ? eventTime : null,
        participants: [{ uid, nama: entry.nama || getUserProfile(uid).nama, status: eventType === 'OUT' || !isHwOnline ? 'KELUAR' : 'MASUK' }],
        totalPersonel: 1,
        eventText: entry.event_text || `TAPPING_${eventType || 'CHECK'}`
      });
    });

    const liveParticipants = (Array.isArray(hwData.queue) ? hwData.queue : []).map(item => ({
      uid: typeof item === 'string' ? item : (item.uid || ''),
      nama: typeof item === 'string' ? terjemahkanIdKeNamaLengkap(item) : (item.name || terjemahkanIdKeNamaLengkap(item.uid)),
      status: 'MASUK'
    })).filter(item => item.uid);

    if (selectedBox?.id && liveParticipants.length > 0) {
      const activeDeviceId = hwData.id_box || selectedBox.id;
      const activeRow = rows.find(row => (row.id_box === selectedBox.id || row.id_box === activeDeviceId) && !row.sessionEnd);
      if (activeRow) {
        activeRow.participants = liveParticipants.map(livePerson => {
          const savedPerson = activeRow.participants.find(person => String(person.uid).toLowerCase() === String(livePerson.uid).toLowerCase());
          return savedPerson && savedPerson.status === 'KELUAR' ? savedPerson : livePerson;
        });
        activeRow.totalPersonel = activeRow.participants.length;
      } else {
        rows.unshift({
          id: `live-session-${selectedBox.id}`,
          deleteId: null,
          deleteIds: [],
          id_box: selectedBox.id,
          sessionDate: new Date().toISOString().slice(0, 10),
          sessionStart: new Date().toISOString(),
          sessionEnd: null,
          participants: liveParticipants,
          totalPersonel: liveParticipants.length,
          eventText: 'SESI AKTIF DARI PERANGKAT'
        });
      }
    }

    return rows;
  }, [tappingHistory, hwData.id_box, hwData.queue, selectedBox?.id]);

  const filteredSessionHistory = sessionHistoryRows.filter(session => {
    const participants = session.participants.map(item => `${item.nama} ${item.uid}`).join(' ');
    const searchText = `${session.id_box} ${session.sessionDate} ${participants} ${session.eventText}`.toLowerCase();
    return searchText.includes(tappingSearchTerm.toLowerCase());
  });

  // TOTAL ORANG MASUK AKTIF
  const totalOrangMasukOtomatis = useMemo(() => {
    let count = 0;
    if (Array.isArray(hwData.queue)) {
      count += hwData.queue.filter(item => !isAdminUid(typeof item === 'string' ? item : item.uid)).length;
    }
    if (hwData.active_fuelman && hwData.active_fuelman !== '' && !isAdminUid(hwData.active_fuelman)) {
      count += 1;
    }
    return count;
  }, [hwData.queue, hwData.active_fuelman]);

  // FILTER LAPORAN MAINTENANCE
  const filteredMaintenanceLogs = Array.isArray(logPemeliharaan)
    ? logPemeliharaan.filter(log => (
      String(log.mesin || '').toLowerCase().includes(maintenanceSearchTerm.toLowerCase()) ||
      String(log.teknisi || '').toLowerCase().includes(maintenanceSearchTerm.toLowerCase()) ||
      String(log.pengawas || '').toLowerCase().includes(maintenanceSearchTerm.toLowerCase()) ||
      String(log.jenis || '').toLowerCase().includes(maintenanceSearchTerm.toLowerCase()) ||
      String(log.deskripsi || '').toLowerCase().includes(maintenanceSearchTerm.toLowerCase()) ||
      String(log.status || '').toLowerCase().includes(maintenanceSearchTerm.toLowerCase())
    ) && (!maintenanceTypeFilter || String(log.jenis || '').trim().toLowerCase() === maintenanceTypeFilter.toLowerCase()))
    : [];

  if (!isProtocolValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="max-w-xl rounded-3xl bg-white p-8 shadow-2xl border border-slate-200 text-slate-900">
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold">Jalankan Lewat Web Server (HTTP/HTTPS)</h1>
            <p className="text-slate-600">Aplikasi tidak dapat memanggil API jika dibuka langsung dengan protokol <code>file:///</code>.</p>
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-slate-800 font-mono-tech text-sm border border-slate-200">
            <p>Buka peramban dan akses melalui URL lokal:</p>
            <p className="mt-3 font-bold text-red-600">http://localhost/ELOTO-v1/</p>
            <p>atau</p>
            <p className="font-bold text-red-600">http://localhost:5173/</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="bg-white min-h-screen flex items-center justify-center p-4 relative">
        {toast.show && (
          <div className={`fixed top-6 left-1/2 -translate-x-1/2 bg-white border px-6 py-3 rounded-xl text-xs font-mono shadow-2xl z-50 flex items-center gap-2 ${toast.type === 'ok' ?
            'border-green-500 text-green-600' : 'border-red-500 text-red-600'}`}>
            <i className={toast.type === 'ok' ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation'}></i>
            {toast.msg}
          </div>
        )}
        <div className="bg-red-50 border border-red-200 w-full max-w-md rounded-2xl p-8 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <i className="fa-solid fa-radio text-red-600 text-4xl animate-pulse"></i>
            <h1 className="text-2xl font-black tracking-wider text-red-600 font-mono-tech">E-LOTO PLATFORM</h1>
            <p className="text-[10px] text-slate-500 tracking-widest uppercase font-bold font-mono-tech">Sistem Penguncian & Keselamatan Kerja</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-800 font-bold mb-1">ID Karyawan / SID</label>
              <input type="text" required placeholder="Masukkan ID Karyawan Anda" className="w-full bg-gray-100 border border-red-200 rounded-lg p-3 text-slate-950 font-mono focus:outline-none" value={formData.sid} onChange={(e) => setFormData({ ...formData, sid: e.target.value })} />
            </div>
            <div>
              <label className="block text-slate-800 font-bold mb-1">Kata Sandi</label>
              <input type="password" required placeholder="Masukkan Kata Sandi" className="w-full bg-gray-100 border border-red-200 rounded-lg p-3 text-slate-950 focus:outline-none" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
            </div>
            <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-black p-3.5 rounded-xl uppercase text-xs tracking-wider font-mono-tech transition-colors">Masuk ke Dashboard</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <React.Fragment>
      <div className="print-hidden min-h-screen text-slate-900 flex flex-col md:flex-row w-full relative">
        {toast.show && (
          <div className={`fixed top-6 left-1/2 -translate-x-1/2 bg-white border px-6 py-3 rounded-xl text-xs font-mono shadow-2xl z-50 flex items-center gap-2 ${toast.type === 'ok' ?
            'border-green-500 text-green-600' : 'border-red-500 text-red-600'}`}>
            <i className={toast.type === 'ok' ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation'}></i>
            {toast.msg}
          </div>
        )}

        {/* MODAL UMUM BESAR */}
        {modalInfo.open && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-red-200 w-full max-w-4xl rounded-2xl p-6 sm:p-8 shadow-2xl space-y-4 max-h-[90vh] flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-gray-200 pb-3 shrink-0">
                <div className="flex items-center gap-2.5 text-red-600 font-bold font-mono-tech text-base">
                  <i className={`fa-solid ${modalInfo.icon || 'fa-circle-info'} text-lg`}></i>
                  <span className="uppercase tracking-wide">{modalInfo.title}</span>
                </div>
                <button type="button" onClick={() => setModalInfo({ ...modalInfo, open: false })} className="text-slate-400 hover:text-slate-700 text-2xl font-bold">&times;</button>
              </div>

              <div className="text-xs text-slate-700 space-y-4 overflow-y-auto pr-1 flex-1">
                {modalInfo.content}
              </div>

              <div className="pt-3 flex justify-end border-t border-gray-200 shrink-0">
                <button type="button" onClick={() => setModalInfo({ ...modalInfo, open: false })} className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl font-mono-tech text-xs uppercase shadow-md active:scale-95 transition-all">Tutup</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL STATUS RADAR */}
        {showRadarModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-red-200 w-full max-w-4xl rounded-2xl p-6 sm:p-8 shadow-2xl space-y-4 max-h-[90vh] flex flex-col justify-between">

              <div className="flex items-center justify-between border-b border-gray-200 pb-3 shrink-0">
                <div className="flex items-center gap-2.5 text-red-600 font-bold font-mono-tech text-base">
                  <i className="fa-solid fa-satellite-dish text-lg"></i>
                  <span className="uppercase tracking-wide">
                    {radarDetailBox ? `Diagnostik Perangkat: ${radarDetailBox.id}` : 'Pilih Unit Boks Untuk Pantau Radar'}
                  </span>
                </div>
                <button type="button" onClick={() => setShowRadarModal(false)} className="text-slate-400 hover:text-slate-700 text-2xl font-bold">&times;</button>
              </div>

              <div className="text-xs text-slate-700 space-y-4 overflow-y-auto pr-1 flex-1">
                {radarDetailBox ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setRadarDetailBox(null)}
                        className="text-red-600 hover:text-red-700 font-bold text-xs font-mono-tech flex items-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <i className="fa-solid fa-arrow-left"></i> Pilih Boks Lain
                      </button>
                      <span className="text-[11px] text-slate-500 font-mono-tech">Unit ID: <b>{radarDetailBox.id}</b></span>
                    </div>

                    <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-sm">
                      <table className="w-full text-left border-collapse text-xs font-mono-tech">
                        <thead>
                          <tr className="bg-gray-100 text-slate-800 border-b border-gray-200">
                            <th className="p-3 w-1/3 border-r border-gray-200">Parameter Sensor</th>
                            <th className="p-3">Nilai Real-Time / Status Perangkat</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Unit Boks</td>
                            <td className="p-3 font-bold text-red-600">{radarDetailBox.id} ({radarDetailBox.unit})</td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Status Jaringan Radar</td>
                            <td className="p-3">
                              {Number(radarDetailBox.is_online) === 1 ? (
                                <span className="bg-green-50 text-green-700 border border-green-300 px-2 py-0.5 rounded font-bold">ONLINE (Tersinkron)</span>
                              ) : (
                                <span className="bg-red-50 text-red-600 border border-red-300 px-2 py-0.5 rounded font-bold">OFFLINE (Standby)</span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">IP Address Boks</td>
                            <td className="p-3 text-blue-600 font-bold">{radarDetailBox.ip || '192.168.1.100'}</td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Nama Wi-Fi (SSID)</td>
                            <td className="p-3 font-bold text-slate-900">{radarDetailBox.ssid || 'Wi-Fi Hotspot'}</td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Lama Alat Nyala (Uptime)</td>
                            <td className="p-3">{Math.round(Number(radarDetailBox.uptime_ms || 0) / 1000)} Detik ({Math.floor(Number(radarDetailBox.uptime_ms || 0) / 60000)} Menit)</td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Aktivitas Terakhir</td>
                            <td className="p-3 font-bold text-slate-800">{radarDetailBox.last_event || 'SYS_INIT'}</td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Koordinat Lokasi GPS</td>
                            <td className="p-3 text-slate-700 font-mono">{safeToFixed(radarDetailBox.lat, 6)}, {safeToFixed(radarDetailBox.lng, 6)}</td>
                          </tr>
                          <tr>
                            <td className="p-3 bg-gray-50 font-bold border-r">Status Penguncian</td>
                            <td className="p-3">{radarDetailBox.state || 'STATE_IDLE'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <p className="text-xs font-semibold text-slate-600">Pilih salah satu boks di bawah untuk melihat rincian diagnostik sensor hardware:</p>
                      <span className="text-xs font-mono font-bold text-red-600 bg-white px-2.5 py-1 rounded border border-red-200">{filteredBoxesInModal.length} Unit Ditemukan</span>
                    </div>

                    <div className="bg-white border border-gray-300 p-2.5 rounded-xl shadow-sm flex items-center gap-2">
                      <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                      <input
                        type="text"
                        placeholder="Cari nama unit, ID boks, atau IP address..."
                        className="w-full bg-transparent text-xs text-slate-950 focus:outline-none font-mono-tech"
                        value={radarModalSearch}
                        onChange={(e) => setRadarModalSearch(e.target.value)}
                      />
                      {radarModalSearch && (
                        <button type="button" onClick={() => setRadarModalSearch('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">
                          Clear
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 pt-1">
                      {filteredBoxesInModal.length > 0 ? (
                        filteredBoxesInModal.map((b) => {
                          const isOnline = Number(b.is_online) === 1;
                          return (
                            <div
                              key={b.id}
                              onClick={() => {
                                handleSelectBox(b);
                                setRadarDetailBox(b);
                              }}
                              className="bg-white border-2 border-red-200 hover:border-red-500 p-4 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                              title="Klik untuk membuka tabel sensor telemetri boks ini"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <i className="fa-solid fa-location-dot text-red-600 text-sm"></i>
                                  <span className="font-black text-slate-950 text-sm font-mono-tech group-hover:text-red-600 transition-colors">{b.id}</span>
                                  <span className={`px-2 py-0.2 rounded text-[8px] font-bold uppercase border font-mono-tech ml-2 ${isOnline ? 'bg-green-50 text-green-700 border-green-300' : 'bg-gray-50 text-slate-500 border-gray-200'}`}>
                                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-slate-700 font-sans pl-5">
                                  Mesin: <span className="text-slate-950 font-bold">{b.unit}</span>
                                </p>
                              </div>

                              <div className="flex items-center gap-4 shrink-0">
                                <div className="flex items-center gap-3 text-[11px] font-mono-tech text-slate-600 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
                                  <span><i className="fa-solid fa-network-wired text-blue-600 mr-1"></i> {b.ip || '192.168.1.100'}</span>
                                  <span className="text-slate-300">|</span>
                                  <span><i className="fa-solid fa-wifi text-slate-400 mr-1"></i> {b.ssid || 'Hotspot'}</span>
                                </div>
                                <div className="text-[11px] text-red-600 font-bold font-mono-tech group-hover:translate-x-1 transition-transform whitespace-nowrap">
                                  <span>Diagnostik &rarr;</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-10 text-slate-400 italic font-sans bg-gray-50 rounded-xl border">
                          Tidak ada boks yang sesuai dengan pencarian.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 flex justify-end border-t border-gray-200 shrink-0">
                <button type="button" onClick={() => setShowRadarModal(false)} className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl font-mono-tech text-xs uppercase shadow-md active:scale-95 transition-all">Tutup</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Crop Foto */}
        {cropPhotoSrc && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white border border-red-200 w-full max-w-xl rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                <div className="flex items-center gap-2 text-red-600 font-bold font-mono-tech text-sm">
                  <i className="fa-solid fa-crop-simple"></i>
                  <span>SESUAIKAN FOTO PROFIL</span>
                </div>
                <button type="button" onClick={handleCancelProfileCrop} className="text-slate-400 hover:text-slate-700 text-2xl font-bold">&times;</button>
              </div>
              <div className="h-[min(65vh,420px)] overflow-hidden rounded-xl bg-slate-100 border border-slate-200">
                <img ref={cropImageRef} src={cropPhotoSrc} alt="Pratinjau crop foto profil" className="block max-w-full" />
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
                <button type="button" onClick={handleCancelProfileCrop} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold rounded-lg font-mono-tech text-xs">Batal</button>
                <button type="button" onClick={handleConfirmProfileCrop} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-black rounded-lg font-mono-tech text-xs uppercase"><i className="fa-solid fa-check mr-1"></i>Gunakan Foto</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Edit Personel */}
        {showEditUserModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-red-200 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 text-red-600 font-bold font-mono-tech text-sm">
                  <i className="fa-solid fa-user-pen"></i>
                  <span>EDIT DATA PERSONEL & KARTU RFID</span>
                </div>
                <button type="button" onClick={() => setShowEditUserModal(false)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
              </div>
              <form onSubmit={handleSimpanEditUser} className="space-y-3 text-xs">
                {formEditUser.foto && <div className="flex justify-center pb-2"><Avatar profile={{ nama: formEditUser.nama, foto: formEditUser.foto }} className="w-28 h-28" /></div>}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ID Karyawan (SID):</label>
                  <input type="text" readOnly className="w-full bg-gray-100 border border-gray-300 rounded-lg p-2.5 text-slate-600 font-mono font-bold cursor-not-allowed" value={formEditUser.sid} />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Nama Lengkap:</label>
                  <input type="text" required placeholder="Masukkan Nama Lengkap" className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-red-500 font-sans font-semibold" value={formEditUser.nama} onChange={(e) => setFormEditUser({ ...formEditUser, nama: e.target.value })} />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Jabatan:</label>
                  <select className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-red-500 font-bold" value={formEditUser.role} onChange={(e) => setFormEditUser({ ...formEditUser, role: e.target.value })}>
                    <option value="teknisi">TEKNISI / MEKANIK</option>
                    <option value="pengawas">PENGAWAS K3 (SUPERVISOR)</option>
                    <option value="fuelman">PETUGAS BBM (FUELMAN)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Kode Kartu RFID:</label>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Ketik atau tempelkan kartu..." className="flex-1 bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 font-mono font-bold uppercase focus:outline-none focus:border-red-500" value={formEditUser.rfidUid} onChange={(e) => setFormEditUser({ ...formEditUser, rfidUid: e.target.value })} />
                    <button type="button" onClick={() => setFormEditUser({ ...formEditUser, rfidUid: (hwData.last_uid && hwData.last_uid !== '—' && hwData.last_uid !== 'SYSTEM') ? hwData.last_uid : '' })} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-3 py-2 rounded-lg font-mono-tech font-bold text-xs flex items-center gap-1 shrink-0">
                      <i className="fa-solid fa-satellite-dish"></i> Ambil
                    </button>
                  </div>
                  {hwData.last_uid && hwData.last_uid !== '—' && hwData.last_uid !== 'SYSTEM' && (
                    <p className="text-[10px] text-blue-600 font-mono mt-1">Pindaian Boks Terakhir: <b>{hwData.last_uid}</b></p>
                  )}
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Foto Profil (URL atau Upload):</label>
                  <input type="url" placeholder="https://... atau assets/foto.jpg" className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-red-500" value={formEditUser.foto && !formEditUser.foto.startsWith('data:') ? formEditUser.foto : ''} onChange={(e) => setFormEditUser({ ...formEditUser, foto: e.target.value })} />
                  <input type="file" accept="image/*" className="w-full mt-2 text-[10px]" onChange={(e) => handleProfilePhotoUpload(e, setFormEditUser)} />
                </div>
                <div className="pt-2 flex justify-end gap-2 border-t">
                  <button type="button" onClick={() => setShowEditUserModal(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold rounded-lg font-mono-tech">Batal</button>
                  <button type="submit" className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-black rounded-lg font-mono-tech uppercase shadow-md">Simpan</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SIDEBAR KIRI */}
        <aside className="w-full md:w-64 bg-red-50 border-b md:border-b-0 md:border-r border-red-100 p-4 md:p-6 flex flex-col justify-between shrink-0 backdrop-blur-sm">
          <div className="space-y-4 md:space-y-6">
            <div className="flex items-center gap-3 border-b border-red-200 pb-3">
              <i className="fa-solid fa-radio text-red-600 text-xl animate-pulse"></i>
              <div>
                <h2 className="font-black text-sm tracking-wider text-red-600 font-mono-tech">E-LOTO PLATFORM</h2>
                <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold font-mono-tech">Sistem Monitoring Terpadu</p>
              </div>
            </div>
            <button type="button" onClick={() => sessionUser?.role !== 'admin' && setActiveTab('profil-tab')} className={`w-full bg-white p-3 rounded-xl border border-red-200 text-center space-y-2 shadow-sm hover:border-red-500 transition-all ${sessionUser?.role === 'admin' ? 'cursor-default' : ''}`}>
              <Avatar profile={sessionUser} className="w-16 h-16 mx-auto" />
              <p className="text-[10px] text-slate-500 font-bold uppercase font-mono-tech">Pengguna Aktif:</p>
              <p className="text-xs font-bold text-slate-950 truncate">{sessionUser?.nama}</p>
              <span className="inline-block text-[9px] bg-red-600 text-white px-2 py-0.5 rounded font-mono font-black uppercase tracking-wider font-mono-tech">{sessionUser?.role}</span>
              {sessionUser?.role !== 'admin' && <span className="block text-[9px] text-red-600 font-mono-tech uppercase font-bold">Lihat Profil</span>}
            </button>
            <nav className="flex flex-row md:flex-col overflow-x-auto md:overflow-visible gap-1 pb-2 md:pb-0 text-xs font-semibold text-slate-800 scrollbar-none">
              {sessionUser?.role !== 'admin' && <button type="button" onClick={() => setActiveTab('profil-tab')} className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${activeTab === 'profil-tab' ?
                'bg-red-600 text-white font-bold shadow-md shadow-red-200' : 'hover:bg-red-50 text-slate-900'}`}>
                <i className="fa-solid fa-user w-4 text-center"></i> Profil Saya
              </button>}
              {(sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') && (
                <button type="button" onClick={() => setActiveTab('dashboard')} className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${activeTab === 'dashboard' ?
                  'bg-red-600 text-white font-bold shadow-md shadow-red-200' : 'hover:bg-red-50 text-slate-900'}`}>
                  <i className="fa-solid fa-house w-4 text-center"></i> Home / Pantau Langsung
                </button>
              )}
              {(sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') && (
                <button type="button" onClick={() => setActiveTab('teknisi-tab')} className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${activeTab === 'teknisi-tab' ?
                  'bg-red-600 text-white font-bold shadow-md shadow-red-200' : 'hover:bg-red-50 text-slate-900'}`}>
                  <i className="fa-solid fa-screwdriver-wrench w-4 text-center"></i> Form Laporan Servis
                </button>
              )}
              <button type="button" onClick={() => { setSubTabMaintenance('form-mekanik'); setActiveTab('riwayat-tab'); }} className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${activeTab === 'riwayat-tab' ?
                'bg-red-600 text-white font-bold shadow-md shadow-red-200' : 'hover:bg-red-50 text-slate-900'}`}>
                <i className="fa-solid fa-clock-history w-4 text-center"></i> Riwayat Laporan
              </button>
              {sessionUser?.role === 'admin' && (
                <button type="button" onClick={() => setActiveTab('admin-tab')} className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${activeTab === 'admin-tab' ?
                  'bg-red-600 text-white font-bold shadow-md shadow-red-200' : 'hover:bg-red-50 text-slate-900'}`}>
                  <i className="fa-solid fa-users-gear w-4 text-center"></i> Kelola Personel
                </button>
              )}
              {sessionUser?.role === 'pengawas' && (
                <button type="button" onClick={() => setActiveTab('team-tab')} className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${activeTab === 'team-tab' ?
                  'bg-red-600 text-white font-bold shadow-md shadow-red-200' : 'hover:bg-red-50 text-slate-900'}`}>
                  <i className="fa-solid fa-people-group w-4 text-center"></i> Tim Mekanik
                </button>
              )}
            </nav>
          </div>
          <button type="button" onClick={handleLogout} className="mt-4 md:mt-0 w-full flex items-center justify-center gap-2 bg-white border border-gray-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 hover:text-red-600 hover:border-red-200 transition-all font-mono-tech shadow-sm">
            <i className="fa-solid fa-right-from-bracket"></i> KELUAR
          </button>
        </aside>

        <main className="flex-1 p-4 sm:p-8 overflow-y-auto w-full space-y-6">
          {/* TAB 1: PROFIL SAYA */}
          {activeTab === 'profil-tab' && sessionUser?.role !== 'admin' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="bg-red-600 rounded-2xl h-28 sm:h-36 relative shadow-lg">
                <div className="absolute left-1/2 -bottom-14 -translate-x-1/2">
                  <Avatar profile={sessionUser} className="w-28 h-28 sm:w-36 sm:h-36 border-4 border-white" />
                </div>
              </div>
              <div className="pt-14 text-center space-y-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-950 uppercase font-mono-tech">{sessionUser?.nama || 'Profil Karyawan'}</h1>
                <p className="text-sm text-red-600 font-bold uppercase">{sessionUser?.role || '—'}</p>
                <p className="text-xs text-slate-500 font-mono-tech">Profil Akun E-LOTO</p>
              </div>
              <div className="bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-red-100">
                  <div className="p-5"><p className="text-[10px] text-slate-500 uppercase font-mono-tech">ID Karyawan / SID</p><p className="mt-1 text-base font-bold text-slate-950 font-mono-tech">{sessionUser?.sid || '—'}</p></div>
                  <div className="p-5"><p className="text-[10px] text-slate-500 uppercase font-mono-tech">Kode Kartu RFID</p><p className="mt-1 text-base font-bold text-slate-950 font-mono-tech">{sessionUser?.rfidUid || sessionUser?.rfid_uid || '—'}</p></div>
                </div>
                <div className="border-t border-red-100 p-5"><p className="text-[10px] text-slate-500 uppercase font-mono-tech">Status Akun</p><p className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-green-700"><span className="w-2 h-2 rounded-full bg-green-500"></span>AKUN AKTIF</p></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') && <button type="button" onClick={() => setActiveTab('dashboard')} className="bg-red-600 hover:bg-red-700 text-white p-3 rounded-xl font-bold text-xs font-mono-tech"><i className="fa-solid fa-house mr-2"></i>Buka Home / Pantau Langsung</button>}
                {(sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') && <button type="button" onClick={() => setActiveTab('teknisi-tab')} className="bg-white hover:bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl font-bold text-xs font-mono-tech"><i className="fa-solid fa-screwdriver-wrench mr-2"></i>Form Laporan Servis</button>}
              </div>
            </div>
          )}

          {/* TAB 2: TIM MEKANIK (PENGAWAS) */}
          {activeTab === 'team-tab' && sessionUser?.role === 'pengawas' && (
            <div className="w-full space-y-6">
              <div className="border-b border-gray-200 pb-3">
                <h1 className="text-base sm:text-lg font-bold text-red-600 font-mono-tech uppercase"><i className="fa-solid fa-people-group mr-2"></i>Tim Mekanik Per Box</h1>
                <p className="text-xs text-slate-500 mt-1">Tentukan mekanik yang akan dibawa oleh pengawas pada setiap box pekerjaan.</p>
              </div>
              <form onSubmit={handleSaveMechanicTeam} className="bg-white border border-red-200 rounded-2xl shadow-sm p-5 space-y-4 text-xs">
                <div className="flex items-center justify-between border-b border-red-100 pb-3">
                  <div><h2 className="font-bold text-slate-800 uppercase font-mono-tech">Penugasan Mekanik</h2><p className="text-[10px] text-slate-500 mt-1">Pilihan disimpan ke database berdasarkan pengawas dan box.</p></div>
                  <span className="text-[10px] font-bold text-red-600 font-mono-tech">{selectedMechanicSids.length} Dipilih</span>
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Box Pekerjaan</label>
                  <select required value={teamBoxId} onChange={(e) => setTeamBoxId(e.target.value)} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 font-bold focus:outline-none focus:border-red-500">
                    <option value="">Pilih box...</option>
                    {boxes.map(box => <option key={box.id} value={box.id}>{box.id}{box.unit ? ` - ${box.unit}` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-semibold">Jenis Maintenance</label>
                  <select required value={teamMaintenanceType} onChange={(e) => setTeamMaintenanceType(e.target.value)} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 font-bold focus:outline-none focus:border-red-500">
                    <option value="Mekanikal">Mekanikal</option>
                    <option value="Elektrikal">Elektrikal</option>
                    <option value="Hidrolik">Hidrolik</option>
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 bg-gray-50 border border-gray-300 px-3 py-2 rounded-xl flex items-center gap-2">
                    <i className="fa-solid fa-magnifying-glass text-slate-400"></i>
                    <input type="search" value={mechanicSearchTerm} onChange={(e) => setMechanicSearchTerm(e.target.value)} placeholder="Cari nama, SID, atau RFID mekanik..." className="w-full bg-transparent text-xs text-slate-900 focus:outline-none" />
                    {mechanicSearchTerm && <button type="button" onClick={() => setMechanicSearchTerm('')} className="text-slate-400 hover:text-red-600 font-bold">&times;</button>}
                  </div>
                  <button type="button" onClick={() => setSelectedMechanicSids(prev => [...new Set([...prev, ...filteredTeamMechanics.map(user => user.sid)])])} disabled={filteredTeamMechanics.length === 0} className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-xl font-bold text-[10px] uppercase disabled:opacity-40">Pilih Hasil</button>
                  <button type="button" onClick={() => setSelectedMechanicSids([])} disabled={selectedMechanicSids.length === 0} className="bg-gray-100 border border-gray-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-[10px] uppercase disabled:opacity-40">Kosongkan</button>
                </div>
                {groupTeknisi.length > 0 ? (
                  filteredTeamMechanics.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredTeamMechanics.map(user => (
                        <label key={user.sid} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:border-red-300">
                          <input type="checkbox" className="w-4 h-4 accent-red-600" checked={selectedMechanicSids.includes(user.sid)} onChange={(e) => setSelectedMechanicSids(prev => e.target.checked ? [...new Set([...prev, user.sid])] : prev.filter(sid => sid !== user.sid))} />
                          <Avatar profile={user} className="w-10 h-10" />
                          <span className="min-w-0"><span className="block font-bold truncate">{user.nama}</span><span className="block text-[10px] text-slate-500">SID: {user.sid}</span></span>
                        </label>
                      ))}
                    </div>
                  ) : <p className="text-center text-slate-500 italic py-8">Mekanik tidak ditemukan.</p>
                ) : <p className="text-center text-slate-500 italic py-8">Belum ada mekanik terdaftar.</p>}
                <div className="flex justify-end border-t border-gray-100 pt-4"><button type="submit" className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-xl font-bold font-mono-tech uppercase"><i className="fa-solid fa-floppy-disk mr-2"></i>Simpan Tim Untuk Box</button></div>
              </form>
            </div>
          )}

          {/* TAB 3: DASHBOARD (HOME) */}
          {activeTab === 'dashboard' && (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') && (
            <div className="space-y-6">
              {/* 5 KARTU METRIK */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
                <div onClick={() => bukaModalUmum('Waktu Penguncian & Downtime Operasional', 'fa-stopwatch', <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs font-mono-tech">
                    <thead><tr className="bg-gray-100 text-slate-800 border-b border-gray-200"><th className="p-3 w-1/3 border-r border-gray-200">Parameter</th><th className="p-3">Keterangan</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr><td className="p-3 bg-gray-50 font-bold border-r">Unit Terfokus</td><td className="p-3 font-bold text-red-600">{selectedBox ? `${selectedBox.id} (${selectedBox.unit})` : '—'}</td></tr>
                      <tr><td className="p-3 bg-gray-50 font-bold border-r">Durasi Penguncian</td><td className="p-3 font-bold text-amber-600 text-sm">{formatWaktuDowntime(downtimeSeconds)} ({downtimeSeconds} detik)</td></tr>
                      <tr><td className="p-3 bg-gray-50 font-bold border-r">Status Timer</td><td className="p-3">{isTrackingDowntime ? <span className="text-amber-600 font-bold">Sedang Berjalan (Terkunci)</span> : <span className="text-green-600 font-bold">Standby (Nol)</span>}</td></tr>
                    </tbody>
                  </table>
                </div>)} className="bg-white border border-red-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
                  <div>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Waktu Kunci <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p>
                    <h3 className={`text-lg font-black font-mono-tech mt-1 ${isTrackingDowntime ? 'text-amber-600 animate-pulse' : 'text-slate-500'}`}>{formatWaktuDowntime(downtimeSeconds)}</h3>
                  </div>
                  <i className="fa-solid fa-stopwatch text-lg text-slate-400"></i>
                </div>

                <div onClick={() => bukaModalUmum('Daftar Seluruh Unit Boks', 'fa-boxes-stacked', (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border">
                      <span className="font-bold text-slate-700">Total: {boxes.length} Boks Terdaftar</span>
                    </div>
                    <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs font-mono-tech">
                        <thead><tr className="bg-gray-100 text-slate-800 border-b border-gray-200"><th className="p-3">ID Box</th><th className="p-3">Nama Alat / Mesin</th><th className="p-3">IP Address</th><th className="p-3 text-center">Status</th><th className="p-3 text-right">Pilih</th></tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {boxes.map(b => (
                            <tr key={b.id} className="hover:bg-red-50/50">
                              <td className="p-3 font-bold text-red-600">{b.id}</td>
                              <td className="p-3 font-sans font-semibold text-slate-900">{b.unit}</td>
                              <td className="p-3 text-blue-600">{b.ip || '192.168.1.100'}</td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${Number(b.is_online) === 1 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                  {Number(b.is_online) === 1 ? 'ONLINE' : 'OFFLINE'}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <button type="button" onClick={() => { handleSelectBox(b); setModalInfo({ ...modalInfo, open: false }); }} className="bg-red-600 text-white px-3 py-1 rounded text-[10px] font-bold">Fokus</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
                  <div>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Total Boks <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p>
                    <h3 className="text-lg font-black font-mono-tech mt-1 text-slate-900">{boxes.length} Unit</h3>
                  </div>
                  <i className="fa-solid fa-boxes-stacked text-lg text-slate-400"></i>
                </div>

                <div onClick={() => bukaModalUmum('Daftar Boks Yang Sedang Terkunci', 'fa-lock', (
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-left border-collapse text-xs font-mono-tech">
                      <thead><tr className="bg-gray-100 text-slate-800 border-b border-gray-200"><th className="p-3">ID Box & Unit</th><th className="p-3">Status Kerja</th><th className="p-3 text-center">Relay Kunci</th><th className="p-3 text-right">Aksi</th></tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {boxes.filter(b => b.state && b.state !== 'STATE_IDLE' && b.state !== 'STATE_REGISTER_RFID').length > 0 ? (
                          boxes.filter(b => b.state && b.state !== 'STATE_IDLE' && b.state !== 'STATE_REGISTER_RFID').map(b => (
                            <tr key={b.id} className="hover:bg-red-50/50">
                              <td className="p-3">
                                <span className="font-bold text-red-600">{b.id}</span>
                                <span className="block text-[11px] text-slate-500 font-sans">{b.unit}</span>
                              </td>
                              <td className="p-3 font-bold text-slate-800">{b.state}</td>
                              <td className="p-3 text-center">
                                <span className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded text-[10px] font-bold">TERKUNCI</span>
                              </td>
                              <td className="p-3 text-right">
                                <button type="button" onClick={() => { handleSelectBox(b); setModalInfo({ ...modalInfo, open: false }); }} className="bg-red-600 text-white px-3 py-1 rounded text-[10px] font-bold">Lihat di Peta</button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="4" className="text-center py-8 text-slate-400 italic font-sans">
                              Tidak ada boks yang sedang terkunci saat ini.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
                  <div>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Boks Terkunci <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p>
                    <h3 className="text-lg font-black font-mono-tech mt-1 text-red-600">
                      {boxes.filter(b => b.state && b.state !== 'STATE_IDLE' && b.state !== 'STATE_REGISTER_RFID').length} Unit
                    </h3>
                  </div>
                  <i className="fa-solid fa-lock text-lg text-red-400"></i>
                </div>

                <div onClick={bukaModalRadar} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
                  <div>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Status Radar <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p>
                    <h3 className={`text-lg font-black font-mono-tech mt-1 ${isHwOnline ? 'text-green-600' : 'text-red-600'}`}>
                      {isHwOnline ? "1 Aktif" : "0 Standby"}
                    </h3>
                  </div>
                  <i className={`fa-solid fa-satellite-dish text-lg ${isHwOnline ? 'text-green-400' : 'text-red-400'}`}></i>
                </div>

                <div onClick={() => bukaModalUmum("Data Pindaian Kartu & Petugas Masuk", "fa-id-card-clip", null)} className="bg-red-50 border-2 border-red-300 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-red-100 hover:border-red-600 hover:shadow-md transition-all active:scale-[0.98]">
                  <div>
                    <p className="text-[9px] text-red-700 font-bold uppercase tracking-wider flex items-center gap-1">Data Pindaian <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-red-500"></i></p>
                    <h3 className="text-lg font-black font-mono-tech mt-1 text-red-700">
                      {totalOrangMasukOtomatis} Petugas
                    </h3>
                  </div>
                  <i className="fa-solid fa-id-card-clip text-lg text-red-600"></i>
                </div>
              </div>

              {/* RADAR TARGET BAR */}
              <div className="bg-white border border-red-200 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm text-xs font-mono-tech">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isHwOnline ? 'bg-green-500 shadow-[0_0_10px_#22e07a]' : 'bg-red-500 shadow-[0_0_10px_#ff5b5b]'}`} />
                  <div>
                    <span className="text-slate-500 font-bold">RADAR TARGET: </span>
                    <span className="text-slate-950 font-black">{selectedBox ? `${selectedBox.id} (${selectedBox.unit})` : 'Belum Ada Boks'}</span>
                    <span className="ml-2 text-blue-600 font-bold">
                      [<i className="fa-solid fa-wifi text-[10px] mr-1"></i>SSID: {isHwOnline ? (selectedBox?.ssid || hwData.ssid || 'Wi-Fi Hotspot') : 'OFFLINE'}]
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest ${isHwOnline ? 'bg-green-50 text-green-700 border border-green-300' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                    {isHwOnline ? 'RADAR ONLINE' : 'RADAR OFFLINE'}
                  </span>
                </div>
              </div>

              {/* PETA SATELIT & MONITORING */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 space-y-6">
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-2 font-mono-tech"><i className="fa-solid fa-map-location-dot"></i> Peta Lokasi Alat Berat (Satelit)</div>
                    <div ref={mapContainerRef} className="w-full h-[240px] sm:h-[350px] rounded-2xl border border-red-200 shadow-lg z-10" style={{ background: '#e5e7eb', minHeight: '240px' }} />
                  </div>
                  
                  {/* LCD & STATUS KERJA */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div onClick={() => bukaModalUmum('Tampilan Layar LCD Fisik di Alat', 'fa-tv', (
                      <div className="bg-black text-green-400 p-5 rounded-2xl border-2 border-green-800 text-base font-black shadow-inner font-mono-tech">
                        <div className="flex items-center gap-4">
                          {isLiveTapPhotoVisible && (
                            <img
                              src={resolveUserPhotoUrl(getUserProfile(hwData.last_uid), getUserProfile(hwData.last_uid).foto)}
                              alt={`Foto ${getUserProfile(hwData.last_uid).nama}`}
                              className="w-20 h-20 rounded-lg object-cover border border-green-700 bg-green-950 shrink-0"
                              onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getInitialAvatar(getUserProfile(hwData.last_uid).nama); }}
                            />
                          )}
                          <div className="min-w-0 space-y-1.5">
                            <p className="truncate">[BARIS 1]: {hwData.lcd0}</p>
                            <p className="truncate">[BARIS 2]: {hwData.lcd1}</p>
                            <p className="truncate text-sm text-green-300">{isHwOnline ? getUserProfile(hwData.last_uid).nama : 'Tidak ada data alat'}</p>
                          </div>
                        </div>
                      </div>
                    ))} className="bg-[#06140a] border-2 border-[#16271a] rounded-xl p-4 shadow-inner relative font-mono-tech text-sm sm:text-base text-[#27ff84] [text-shadow:0_0_8px_rgba(39,255,132,0.6)] cursor-pointer hover:border-green-600 transition-all min-h-[90px] flex flex-col justify-center">
                      <div className="absolute inset-0 pointer-events-none rounded-xl opacity-10 bg-repeat" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,1) 50%, transparent 50%)', backgroundSize: '100% 4px' }} />
                      <div className="relative z-[1] flex items-center gap-3">
                          {isLiveTapPhotoVisible && (
                            <img
                              src={resolveUserPhotoUrl(getUserProfile(hwData.last_uid), getUserProfile(hwData.last_uid).foto)}
                              alt={`Foto ${getUserProfile(hwData.last_uid).nama}`}
                              className="w-14 h-14 rounded-md object-cover border border-green-700 bg-green-950 shrink-0"
                              onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getInitialAvatar(getUserProfile(hwData.last_uid).nama); }}
                            />
                          )}
                        <div className="min-w-0">
                          <div className="min-h-[24px] flex items-center break-words whitespace-normal leading-relaxed font-bold">{isHwOnline ? hwData.lcd0 : '— ALAT TERPUTUS —'}</div>
                          <div className="min-h-[24px] flex items-center mt-1 text-xs sm:text-sm text-[#10b981]">{isHwOnline ? hwData.lcd1 : '— CLOUD TERSINKRON —'}</div>
                          <div className="truncate text-[10px] text-green-300">{isLiveTapPhotoVisible ? getUserProfile(hwData.last_uid).nama : 'Belum ada tapping aktif'}</div>
                        </div>
                      </div>
                    </div>

                    <div onClick={() => bukaModalUmum('Tahapan Status Penguncian Sistem', 'fa-diagram-project', (
                      <div className="overflow-x-auto border border-gray-200 rounded-xl font-mono-tech text-xs">
                        <table className="w-full text-left border-collapse">
                          <tbody>
                            <tr><td className="p-3 bg-gray-50 font-bold border-r w-1/3">Status Saat Ini</td><td className="p-3 font-bold text-red-600">{hwData.state}</td></tr>
                            <tr><td className="p-3 bg-gray-50 font-bold border-r">Petunjuk Prosedur</td><td className="p-3 font-sans text-slate-700">{STATE_DESC[hwData.state] || 'Standby'}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    ))} className="bg-white border border-gray-200 p-4 rounded-xl flex flex-col justify-center shadow-sm cursor-pointer hover:border-red-400 transition-all">
                      <span className="text-[9px] font-mono-tech tracking-widest uppercase text-slate-500">Status Kerja Sistem (Klik Untuk Panduan)</span>
                      <h4 className="text-sm sm:text-base font-black font-mono-tech tracking-wide mt-1 text-red-600">{isHwOnline ? hwData.state : 'OFFLINE'}</h4>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed">{isHwOnline ? (STATE_DESC[hwData.state] || 'Membaca jalur mesin...') : 'Sambungkan boks ESP32 ke internet.'}</p>
                    </div>
                  </div>

                  {/* KONDISI SENSOR & KUNCI GEMBOK */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-mono-tech tracking-widest uppercase text-slate-500">Kondisi Sensor & Kunci Gembok (Klik Untuk Rincian)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono-tech">
                      <div onClick={() => bukaModalUmum('Kondisi Kunci Solenoid Gembok', 'fa-bolt', <div className="p-3 font-mono text-xs">Status: <b>{hwData.relay_open ? 'TERBUKA' : 'TERKUNCI'}</b></div>)} className="bg-white p-4 rounded-xl border border-gray-200 flex items-center gap-3 shadow-sm cursor-pointer hover:border-red-400 transition-all">
                        <div className={`w-3.5 h-3.5 rounded-full ${isHwOnline && hwData.relay_open ? 'bg-green-500 shadow-[0_0_10px_#22e07a]' : 'bg-red-500 shadow-[0_0_10px_#ff5b5b]'}`} />
                        <div><span className="block text-[9px] text-slate-500">KUNCI SOLENOID</span><span className="font-bold text-slate-950">{isHwOnline ? (hwData.relay_open ? 'TERBUKA (HIGH)' : 'TERKUNCI (LOW)') : '—'}</span></div>
                      </div>

                      <div onClick={() => bukaModalUmum('Aktivitas Terakhir di Lapangan', 'fa-clock-rotate-left', <div className="p-3 font-mono text-xs">Event: <b>{hwData.last_event || 'SYS_SYNC'}</b></div>)} className="bg-white p-4 rounded-xl border border-gray-200 flex items-center gap-3 shadow-sm cursor-pointer hover:border-red-400 transition-all">
                        <div className={`w-3.5 h-3.5 rounded-full ${isHwOnline && hwData.last_event_ok ? 'bg-green-500 shadow-[0_0_10px_#22e07a]' : 'bg-red-500 shadow-[0_0_10px_#ff5b5b]'}`} />
                        <div><span className="block text-[9px] text-slate-500">PINDAIAN TERAKHIR</span><span className="font-bold text-slate-950 truncate max-w-[130px] block">{isHwOnline && hwData.last_event ? `${hwData.last_event} ${hwData.last_event_ok ? '  ✓  ' : '  ✗  '}` : '  —  '}</span></div>
                      </div>

                      <div onClick={() => bukaModalUmum('Kondisi Sinyal Satelit GPS', 'fa-location-dot', <div className="p-3 font-mono text-xs">GPS Satelit: <b>{hwData.gps_fix ? 'TERKUNCI' : 'STANDBY'}</b></div>)} className="bg-white p-4 rounded-xl border border-gray-200 flex items-center gap-3 shadow-sm cursor-pointer hover:border-red-400 transition-all">
                        <div className={`w-3.5 h-3.5 rounded-full ${isHwOnline && hwData.gps_fix ? 'bg-green-500 shadow-[0_0_10px_#22e07a]' : 'bg-amber-500 shadow-[0_0_10px_#ffb238]'}`} />
                        <div><span className="block text-[9px] text-slate-500">SINYAL GPS</span><span className="font-bold text-slate-950">{isHwOnline ? (hwData.gps_fix ? 'TERKUNCI' : 'STANDBY') : '—'}</span></div>
                      </div>
                    </div>
                  </div>

                  {/* ANTREAN PETUGAS */}
                  <div className="bg-white border border-red-100 p-4 sm:p-5 rounded-2xl shadow-md space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <p className="text-[10px] font-mono-tech tracking-widest uppercase text-slate-600 font-bold">Daftar Antrean Petugas di Lapangan</p>
                      <button type="button" onClick={triggerEmergencyOverride} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-2.5 py-1 rounded text-[10px] font-mono-tech font-bold flex items-center gap-1 transition-all shadow-sm active:scale-95"><i className="fa-solid fa-triangle-exclamation"></i> Buka Paksa Darurat</button>
                    </div>

                    <div className="bg-gray-50 border border-gray-200 p-3 rounded-xl min-h-[50px] flex items-center flex-wrap gap-2">
                      {(() => {
                        let queueList = [];
                        if (Array.isArray(hwData.queue)) {
                          queueList = hwData.queue;
                        } else if (typeof hwData.queue === 'string' && hwData.queue.trim() !== '') {
                          try { queueList = JSON.parse(hwData.queue); } catch (e) { queueList = []; }
                        }
                        queueList = queueList.filter(item => !isAdminUid(typeof item === 'string' ? item : (item.uid || item.last_uid || '')));

                        const hasActiveFuelman = hwData.active_fuelman && hwData.active_fuelman !== '';

                        if (isHwOnline && (queueList.length > 0 || hasActiveFuelman)) {
                          return (
                            <React.Fragment>
                              {queueList.map((item, i) => {
                                const uidKartu = typeof item === 'string' ? item : (item.uid || item.last_uid || '');
                                const roleMetode = typeof item === 'object' ? item.role : '';

                                const isSpv = roleMetode === 'spv' || roleMetode === 'pengawas' || 
                                              (uidKartu === hwData.supervisor_uid) || (i === 0 && hwData.state !== 'STATE_IDLE' && hwData.state !== 'STATE_REGISTER_RFID');

                                const profile = getUserProfile(uidKartu);
                                const namaPersonel = profile.nama;

                                return (
                                  <div 
                                    key={i} 
                                    onClick={() => bukaModalUmum(`Data Petugas #${i + 1}`, isSpv ? "fa-heart" : "fa-wrench", <div className="p-3 font-mono text-xs">{namaPersonel} ({uidKartu}) - {isSpv ? 'Pengawas' : 'Mekanik'}</div>)}
                                    className="flex items-center gap-1.5 font-mono-tech text-xs cursor-pointer hover:scale-105 transition-transform"
                                  >
                                    {i > 0 && <span className="text-slate-400 font-bold">→</span>}
                                    <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 shadow-sm transition-all max-w-[230px] ${
                                      isSpv ? 'border-blue-300 bg-blue-50 text-blue-700 font-bold' : 'border-slate-300 bg-white text-slate-800 shadow-sm'
                                    }`}>
                                      <Avatar profile={profile} className="w-8 h-8" />
                                      <span className="flex min-w-0 flex-col leading-tight text-left">
                                        <span className="truncate">{namaPersonel}</span>
                                        <span className="text-[9px] text-slate-500 font-normal truncate">{isSpv ? 'PENGAWAS K3' : 'MEKANIK'} · {i === queueList.length - 1 ? 'TOP' : `#${i + 1}`}</span>
                                      </span>
                                    </span>
                                  </div>
                                );
                              })}

                              {hasActiveFuelman && (
                                <div 
                                  onClick={() => bukaModalUmum("Status Petugas Pengisian BBM (Fuelman)", "fa-gas-pump", <div className="p-3 font-mono text-xs">{getUserProfile(hwData.active_fuelman).nama}</div>)}
                                  className="flex items-center gap-2 font-mono-tech text-xs ml-1 cursor-pointer hover:scale-105 transition-transform"
                                >
                                  {queueList.length > 0 && <span className="text-slate-400 font-bold">|</span>}
                                  <span className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-bold flex items-center gap-1.5 shadow-sm animate-pulse">
                                    <Avatar profile={getUserProfile(hwData.active_fuelman)} className="w-7 h-7" />
                                    <span>[BBM] {getUserProfile(hwData.active_fuelman).nama}</span>
                                  </span>
                                </div>
                              )}
                            </React.Fragment>
                          );
                        }

                        return (
                          <span className="text-xs text-slate-500 font-mono-tech italic">
                            Antrean kosong — Belum ada gembok terpasang di lapangan.
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                
                {/* FORM REGISTRASI BOKS & DAFTAR BOKS */}
                <div className="xl:col-span-1 flex flex-col justify-start space-y-6">
                  {sessionUser?.role === 'admin' && (
                    <div className="bg-red-50/60 border border-red-200 p-4 sm:p-5 rounded-2xl shadow-sm space-y-4 backdrop-blur-sm">
                      <div className="text-xs font-bold text-red-600 uppercase tracking-widest font-mono-tech"><i className={`fa-solid ${editingBoxId ? 'fa-pen-to-square' : 'fa-plus'}`}></i> {editingBoxId ? 'Edit Data Boks' : 'Tambah Boks Alat Baru'}</div>
                      <form onSubmit={handleTambahAlatBerat} className="space-y-3 text-xs">
                        <input type="text" required disabled={Boolean(editingBoxId)} placeholder="ID Boks (Contoh: BOX ELOTO 1)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none disabled:bg-gray-100 disabled:text-slate-500" value={formAlatBerat.id} onChange={(e) => setFormAlatBerat({...formAlatBerat, id: e.target.value})} />
                        <input type="text" required placeholder="Nama Alat / Mesin (Contoh: HD-785 DUMP TRUCK)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none" value={formAlatBerat.unit} onChange={(e) => setFormAlatBerat({...formAlatBerat, unit: e.target.value})} />
                        <div className="flex gap-2">
                          <input type="text" required placeholder="IP Address ESP32 (192.168.1.100)" className="flex-1 bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900 text-[11px]" value={formAlatBerat.ip} onChange={(e) => setFormAlatBerat({...formAlatBerat, ip: e.target.value})} />
                          <button type="button" onClick={handleAutoGps} disabled={isSyncing} className="bg-red-600 hover:bg-red-700 text-white px-4 rounded-lg font-bold text-xs shadow-sm flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap">
                            <i className={`fa-solid ${isSyncing ? 'fa-spinner animate-spin' : 'fa-satellite-dish'}`}></i> Sync
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" placeholder="Latitude (Otomatis)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900" value={formAlatBerat.lat} onChange={(e) => setFormAlatBerat({...formAlatBerat, lat: e.target.value})} />
                          <input type="text" placeholder="Longitude (Otomatis)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900" value={formAlatBerat.lng} onChange={(e) => setFormAlatBerat({...formAlatBerat, lng: e.target.value})} />
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" className="flex-1 bg-red-600 text-white font-bold py-2.5 rounded-xl uppercase font-mono-tech shadow-md">{editingBoxId ? 'Simpan Perubahan' : 'Simpan Boks ke Peta'}</button>
                          {editingBoxId && <button type="button" onClick={handleBatalEditAlatBerat} className="bg-white text-slate-600 border border-gray-300 font-bold px-3 rounded-xl uppercase font-mono-tech">Batal</button>}
                        </div>
                      </form>
                    </div>
                  )}
                  
                  {/* DAFTAR BOKS & PENCARIAN */}
                  <div className="bg-white border border-gray-200 p-4 sm:p-5 rounded-2xl shadow-sm flex-1 flex flex-col min-h-[250px]">
                    <p className="text-xs font-mono-tech tracking-widest uppercase text-slate-600 border-b pb-2 mb-3">Daftar Boks Terdaftar</p>
                    
                    {/* PENCARIAN BOKS */}
                    <div className="bg-gray-50 border border-gray-300 p-2 rounded-xl flex items-center gap-2 mb-3">
                      <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                      <input 
                        type="text" 
                        placeholder="Cari boks (ID, Unit, IP)..." 
                        className="w-full bg-transparent text-xs text-slate-900 focus:outline-none font-mono-tech" 
                        value={boxSearchTerm} 
                        onChange={(e) => setBoxSearchTerm(e.target.value)} 
                      />
                      {boxSearchTerm && (
                        <button type="button" onClick={() => setBoxSearchTerm('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">
                          &times;
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono-tech mb-4">
                      <div className="bg-gray-50 p-2 rounded border border-gray-200">
                        <span className="text-slate-600 block">PENGAWAS (SPV)</span>
                        <span className="text-slate-950 font-bold truncate block">{isHwOnline ? terjemahkanIdKeNamaLengkap(hwData.supervisor_uid) : '—'}</span>
                      </div>
                      <div className="bg-gray-50 p-2 rounded border border-gray-200">
                        <span className={`font-bold block ${isHwOnline ? 'text-green-600' : 'text-red-600'}`}>{isHwOnline ? 'Tersambung  ✓  ' : 'Terputus  ✗  '}</span>
                      </div>
                    </div>

                    <div className="space-y-2 overflow-y-auto pr-1 flex-1 max-h-[220px]">
                      {filteredBoxes.length > 0 ? (
                        filteredBoxes.map((box) => {
                          const isCurrentSelected = selectedBox && String(selectedBox.id).toLowerCase().trim() === String(box.id).toLowerCase().trim();
                          const isThisBoxLocked = box.state && box.state !== 'STATE_IDLE' && box.state !== 'STATE_REGISTER_RFID';
                          const isBoxOnlineInDb = Number(box.is_online) === 1;
                          
                          let badgeText = "STANDBY";
                          let badgeStyle = "bg-green-50 text-green-600 border-green-200";
                          if (isCurrentSelected) {
                            if (!isHwOnline) {
                              badgeText = "OFFLINE";
                              badgeStyle = "bg-gray-100 text-gray-500 border-gray-200 font-normal";
                            } else if (hwData.state === 'STATE_REGISTER_RFID') {
                              badgeText = "DAFTAR KARTU";
                              badgeStyle = "bg-blue-600 text-white border-blue-700 font-bold animate-pulse";
                            } else if (hwData.state && hwData.state !== 'STATE_IDLE') {
                              badgeText = "TERKUNCI";
                              badgeStyle = "bg-red-600 text-white border-red-700 font-bold animate-pulse";
                            }
                          } else {
                            if (!isBoxOnlineInDb) {
                              badgeText = "OFFLINE";
                              badgeStyle = "bg-gray-100 text-gray-500 border-gray-200 font-normal";
                            } else if (box.state === 'STATE_REGISTER_RFID') {
                              badgeText = "DAFTAR KARTU";
                              badgeStyle = "bg-blue-600 text-white border-blue-700 font-bold animate-pulse";
                            } else if (isThisBoxLocked) {
                              badgeText = "TERKUNCI";
                              badgeStyle = "bg-red-600 text-white border-red-700 font-bold animate-pulse";
                            }
                          }
                          return (
                            <div key={box.id} onClick={() => handleSelectBox(box)} className={`p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all hover:border-red-400 ${isCurrentSelected ? 'bg-red-50/50 border-red-500 shadow-sm' : 'bg-white border-gray-200'}`}>
                              <div className="truncate text-xs font-mono-tech">
                                <p className="font-bold text-slate-950 flex items-center gap-1.5"><i className="fa-solid fa-location-dot text-red-600"></i> {box.id}</p>
                                <p className="text-slate-600 text-[10px] font-sans mt-0.5 truncate">Unit: <span className="text-slate-950 font-semibold">{box.unit}</span></p>
                                <p className="text-[10px] text-blue-600 font-mono font-bold mt-0.5">
                                  <i className="fa-solid fa-network-wired"></i> IP: {box.ip || '192.168.1.100'} | <i className="fa-solid fa-wifi text-[9px] text-slate-500"></i> SSID: <span className="text-slate-950 font-black">{box.ssid || 'Wi-Fi Hotspot'}</span>
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono border ${badgeStyle}`}>{badgeText}</span>
                                {sessionUser?.role === 'admin' && <div className="flex items-center gap-1">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); handleEditAlatBerat(box); }} className="text-slate-500 hover:text-blue-600 p-1 rounded transition-colors" title="Edit data boks"><i className="fa-solid fa-pen-to-square"></i></button>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusAlatBerat(box.id); }} className="text-slate-500 hover:text-red-600 p-1 rounded transition-colors" title="Hapus boks"><i className="fa-solid fa-trash-can"></i></button>
                                </div>}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-4 text-center text-slate-400 italic text-xs">Tidak ada boks yang cocok.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* TABEL RIWAYAT SESI TAPPING */}
              <div className="bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-red-50 px-4 py-3 border-b border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-red-700 font-mono-tech">Riwayat Sesi Tapping</h3>
                    <p className="text-[10px] text-slate-600 mt-0.5">Data permanen dari tabel tapping_history</p>
                  </div>
                  <span className="text-[10px] font-bold text-red-700 font-mono-tech">{filteredSessionHistory.length} Sesi</span>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full min-w-[850px] text-left border-collapse text-[11px] font-mono-tech">
                    <thead className="sticky top-0 z-10 bg-gray-100 text-slate-800 border-b border-gray-200">
                      <tr>
                        <th className="p-3">Waktu Masuk</th>
                        <th className="p-3">Waktu Keluar</th>
                        <th className="p-3">Boks</th>
                        <th className="p-3">Nama Personel</th>
                        <th className="p-3">UID RFID</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3">Event</th>
                        <th className="p-3 text-center">Total</th>
                        <th className="p-3 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-100 bg-white">
                      {filteredSessionHistory.length > 0 ? filteredSessionHistory.map((entry, index) => {
                        const sessionClosed = Boolean(entry.sessionEnd);
                        const formatSessionTime = value => value ? new Date(String(value).replace(' ', 'T')).toLocaleString('id-ID') : 'Masih aktif';
                        return (
                          <tr key={`session-row-${entry.id || index}`} className="border-b-2 border-red-100 hover:bg-red-50/60">
                            <td className="p-3 text-slate-700">{formatSessionTime(entry.sessionStart)}</td>
                            <td className="p-3 text-slate-700">{formatSessionTime(entry.sessionEnd)}</td>
                            <td className="p-3 font-bold text-red-600">{entry.id_box || '—'}<span className="block text-[9px] text-slate-400">{entry.sessionDate}</span></td>
                            <td className="p-3 font-bold text-slate-900">
                              <div className="flex flex-wrap gap-1.5">
                                {entry.participants.length > 0 ? entry.participants.map(item => (
                                  <span key={`${entry.id}-${item.uid}`} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-slate-50">
                                    {item.nama}
                                    <small className={`text-[8px] font-black ${item.status === 'KELUAR' ? 'text-slate-500' : 'text-green-600'}`}>({item.status || 'MASUK'})</small>
                                  </span>
                                )) : 'Personel Belum Terdaftar'}
                              </div>
                            </td>
                            <td className="p-3 text-blue-700">{entry.participants.map(item => item.uid).filter(Boolean).join(', ') || '—'}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-1 rounded border text-[9px] font-bold ${sessionClosed ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-green-50 text-green-700 border-green-300'}`}>
                                {sessionClosed ? 'SELESAI / OUT' : 'MASIH AKTIF / IN'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-600">{entry.eventText || '—'}</td>
                            <td className="p-3 text-center"><span className="inline-flex min-w-8 justify-center px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-black">{entry.totalPersonel} Orang</span></td>
                            <td className="p-3 text-center">
                              {String(sessionUser?.role || '').trim().toLowerCase() === 'admin' && entry.deleteId && <button type="button" onClick={() => handleHapusRiwayatTapping(entry.deleteId, entry.deleteIds)} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-2.5 py-1.5 rounded border border-red-200 transition-colors" title="Hapus satu sesi"><i className="fa-solid fa-trash-can"></i><span className="ml-1 text-[9px] font-bold">HAPUS</span></button>}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr><td colSpan="9" className="p-8 text-center text-slate-500 italic">Belum ada riwayat sesi tapping.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          
          {/* TAB 4: FORM LAPORAN SERVIS */}
          {activeTab === 'teknisi-tab' && (sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') && (
            <div className="space-y-6">
              <h3 className="text-base sm:text-lg font-bold text-red-600 border-b border-gray-200 pb-3 font-mono-tech">Form Laporan Servis & Kerusakan Alat</h3>
              <div className="bg-red-50/40 border border-red-200 p-4 sm:p-6 rounded-2xl shadow-sm">
                <form onSubmit={handleSimpanKerusakan} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-slate-700 mb-1 font-semibold">Pilih Unit Mesin</label>
                      <select className="w-full bg-white border border-red-300 p-3 rounded-lg text-red-600 font-black font-mono focus:outline-none focus:ring-2 focus:ring-red-500" 
                              value={selectedBox ? selectedBox.id : ''} 
                              onChange={(e) => {
                                const targetBox = boxes.find(b => String(b.id).toLowerCase().trim() === String(e.target.value).toLowerCase().trim());
                                if (targetBox) handleSelectBox(targetBox);
                              }}>
                        {Array.isArray(boxes) && boxes.length > 0 ? (
                          boxes.map(b => (
                            <option key={b.id} value={b.id}>{b.id} ({b.unit})</option>
                          ))
                        ) : <option value="">Belum ada boks terdaftar</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 mb-1 font-semibold">Mekanik Penanggung Jawab</label>
                      <input type="text" 
                             placeholder="Tempelkan kartu RFID atau ketik nama mekanik..."
                             value={manualMekanik || dapatkanMekanikDariAntreanLoto()} 
                             onChange={(e) => setManualMekanik(e.target.value)}
                             className={`w-full border p-3 rounded-lg font-bold focus:outline-none transition-all duration-300 ${(manualMekanik || dapatkanMekanikDariAntreanLoto()) ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-600 animate-pulse'}`} />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-slate-700 mb-1">Jenis Gangguan / Kerusakan</label>
                      <select className="w-full bg-white border border-gray-200 p-3 rounded-lg text-slate-950 font-bold focus:outline-none focus:border-red-500" value={tipeKerusakan} onChange={(e) => setTipeKerusakan(e.target.value)}>
                        <option value="Mekanikal">Mekanikal</option><option value="Elektrikal">Elektrikal</option><option value="Hidrolik">Hidrolik</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 mb-1">Perkiraan Waktu Pengerjaan</label>
                      <input type="text" required placeholder="Contoh: 4 Jam..." className="w-full bg-white border p-3 rounded-lg text-slate-950 focus:outline-none" value={estimasiWaktu} onChange={(e) => setEstimasiWaktu(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-slate-700 mb-1 font-semibold">Pengawas K3 Penanggung Jawab</label>
                      <input type="text" 
                             placeholder="Nama Pengawas K3..." 
                             className="w-full bg-white border border-gray-200 p-3 rounded-lg text-slate-950 font-bold focus:outline-none focus:border-red-500" 
                             value={pengawasLoto || dapatkanPengawasDariLoto()} 
                             onChange={(e) => setPengawasLoto(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-800 mb-1 font-semibold">Foto Bukti Kerusakan di Lapangan</label>
                    <input type="file" accept="image/*" className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-slate-600 focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold" onChange={handleCaptureKamera} />
                    {photoBase64 && (
                      <div className="mt-2 p-2 bg-gray-50 border rounded-lg max-w-xs">
                        <p className="text-[10px] text-slate-500 font-mono-tech mb-1 uppercase">Pratinjau Foto Bukti (~100KB):</p>
                        <img src={photoBase64} alt="Bukti Lapangan" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = 'assets/default-avatar.png'; }} className="w-full h-auto rounded border border-gray-300 max-h-36 object-cover" />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-slate-700 mb-1">Uraian Kerusakan & Kebutuhan Suku Cadang</label>
                    <textarea rows="4" required placeholder="Tuliskan rincian perbaikan dan suku cadang yang diganti..." className="w-full bg-white border border-gray-200 rounded-lg p-3 text-slate-950 focus:outline-none focus:border-red-500" value={formDeskripsi} onChange={(e) => setFormDeskripsi(e.target.value)} />
                  </div>
                  <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-black px-6 py-3 rounded-xl uppercase tracking-wider text-xs font-mono-tech">Simpan Laporan Servis</button>
                </form>
              </div>
            </div>
          )}
          
          {/* TAB 5: RIWAYAT LAPORAN */}
          {activeTab === 'riwayat-tab' && (
            <div className="space-y-6">
              <div className="flex border-b border-gray-200 gap-2 no-print overflow-x-auto scrollbar-none">
                <button type="button" onClick={() => setSubTabMaintenance('form-mekanik')} className={`px-4 py-2 text-xs font-bold font-mono-tech whitespace-nowrap border-b-2 transition-all ${subTabMaintenance === 'form-mekanik' ? 'border-red-500 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-800'}`}> 📁 Riwayat Laporan Pemeliharaan</button>
                <button type="button" onClick={() => setSubTabMaintenance('realtime-status')} className={`px-4 py-2 text-xs font-bold font-mono-tech whitespace-nowrap border-b-2 transition-all ${subTabMaintenance === 'realtime-status' ? 'border-red-500 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-800'}`}> 📡 Status Kerja Petugas Saat Ini</button>
                <button type="button" onClick={() => setSubTabMaintenance('pindaian-kartu')} className={`px-4 py-2 text-xs font-bold font-mono-tech whitespace-nowrap border-b-2 transition-all ${subTabMaintenance === 'pindaian-kartu' ? 'border-red-500 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-800'}`}> 🪪 Data Pindaian Kartu</button>
              </div>
              
              {subTabMaintenance === 'form-mekanik' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h3 className="text-xs font-bold text-slate-600 font-mono-tech uppercase">Arsip Manifes Laporan Pemeliharaan</h3>
                    
                    {/* PENCARIAN MAINTENANCE */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select value={maintenanceTypeFilter} onChange={(e) => setMaintenanceTypeFilter(e.target.value)} className="bg-white border border-gray-300 px-3 py-1.5 rounded-xl text-xs text-slate-900 font-mono-tech shadow-sm focus:outline-none focus:border-red-500">
                        <option value="">Semua Jenis</option>
                        <option value="Mekanikal">Mekanikal</option>
                        <option value="Elektrikal">Elektrikal</option>
                        <option value="Hidrolik">Hidrolik</option>
                      </select>
                      <div className="bg-white border border-gray-300 px-3 py-1.5 rounded-xl flex items-center gap-2 max-w-xs shadow-sm">
                        <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                        <input 
                          type="text" 
                          placeholder="Cari mesin, teknisi, jenis..." 
                          className="w-full bg-transparent text-xs text-slate-900 focus:outline-none font-mono-tech" 
                          value={maintenanceSearchTerm} 
                          onChange={(e) => setMaintenanceSearchTerm(e.target.value)} 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="w-full bg-white border border-red-200 rounded-2xl shadow-sm overflow-x-auto">
                    <table className="w-full text-left border-collapse border min-w-[700px] border-red-200 text-xs font-mono-tech">
                      <thead>
                        <tr className="bg-gray-50 text-slate-800 border-b border-red-200">
                          <th className="px-4 py-3.5 text-center border-r border-red-200">No</th>
                          <th className="px-4 py-3.5 border-r border-red-200">Nama Boks / Unit</th>
                          <th className="px-4 py-3.5 border-r border-red-200">Mekanik PIC</th>
                          <th className="px-4 py-3.5 border-r border-red-200">Jenis Kerusakan</th>
                          <th className="px-4 py-3.5 border-r border-red-200">Uraian Masalah</th>
                          <th className="px-4 py-3.5 text-center border-r border-red-200">Foto</th>
                          <th className="px-4 py-3.5 text-center border-r border-red-200">Status</th>
                          <th className="px-4 py-3.5 text-right whitespace-nowrap">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMaintenanceLogs.length > 0 ? (
                          filteredMaintenanceLogs.map((log, idx) => (
                            <tr key={log.id || idx} className="hover:bg-red-50 border-b border-red-200">
                              <td className="px-4 py-3.5 text-center text-slate-600 border-r border-red-200">{idx + 1}</td>
                              <td className="px-4 py-3.5 font-bold text-slate-950 uppercase border-r border-red-200">{log.mesin}</td>
                              <td className="px-4 py-3.5 text-gray-900 font-sans border-r border-red-200">{log.teknisi}</td>
                              <td className="px-4 py-3.5 text-slate-700 border-r border-red-200">{log.jenis}</td>
                              <td className="px-4 py-3.5 text-slate-600 font-sans border-r border-red-200 max-w-xs truncate">{log.deskripsi}</td>
                              <td className="px-4 py-3.5 text-center border-r border-red-200">
                                {log.foto ? <img src={log.foto} alt="Bukti" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = 'assets/default-avatar.png'; }} className="w-12 h-9 rounded border mx-auto object-cover" /> : <span className="text-slate-400 italic">No Photo</span>}
                              </td>
                              <td className="px-4 py-3.5 text-center border-r border-red-200"><span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase ${log.status === 'PROSES' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-green-50 text-green-600 border-green-200'}`}>{log.status}</span></td>
                              <td className="px-4 py-3.5 text-right space-x-1 whitespace-nowrap">
                                <button type="button" onClick={() => { setPrintActiveLog(log); setTimeout(() => { window.print(); }, 250); }} className="bg-red-50 text-red-600 px-2 py-1 rounded text-[10px] font-bold border hover:bg-red-100"><i className="fa-solid fa-file-pdf"></i> PDF</button>
                                <button type="button" onClick={() => triggerSimulasiExcel(log)} className="bg-green-50 text-green-700 px-2 py-1 rounded text-[10px] font-bold border hover:bg-green-100"><i className="fa-solid fa-file-excel"></i> EXCEL</button>
                                <button type="button" onClick={() => handleHapusLogPemeliharaan(log.id)} className="bg-white text-red-500 px-2 py-1 rounded text-[10px] border border-red-200 hover:bg-red-50" title="Hapus"><i className="fa-solid fa-trash-can"></i></button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="9" className="p-12 text-center text-slate-500 italic font-sans border border-red-200">Belum ada berkas laporan yang sesuai.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {subTabMaintenance === 'realtime-status' && (
                <div className="space-y-4">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-600 font-mono-tech uppercase">Status Kerja Petugas Saat Ini</h3>
                  <div className="bg-white border border-red-200 rounded-2xl shadow-sm overflow-x-auto">
                    <table className="w-full text-left border-collapse border min-w-[700px] border-red-200 text-xs font-mono-tech">
                      <thead>
                        <tr className="bg-gray-50 text-slate-800 border-b border-red-200">
                          <th className="px-5 py-3.5 border-r border-red-200">Unit Boks</th>
                          <th className="px-5 py-3.5 border-r border-red-200">Kondisi Penguncian</th>
                          <th className="px-5 py-3.5 border-r border-red-200">Petugas di Dalam</th>
                          <th className="px-5 py-3.5 border-r border-red-200">Lama Waktu Sesi</th>
                          <th className="px-5 py-3.5 text-right">Koordinat GPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.isArray(boxes) && boxes.length > 0 ? (
                          boxes.map((box) => {
                            const isCurrentSelected = selectedBox && String(selectedBox.id).toLowerCase().trim() === String(box.id).toLowerCase().trim();
                            return (
                              <tr key={box.id} className="hover:bg-red-50 border-b border-red-200">
                                <td className="px-5 py-3.5 font-bold border-r border-red-200">{box.id} ({box.unit})</td>
                                <td className="px-5 py-3.5 border-r border-red-200"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isCurrentSelected && isHwOnline ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-slate-600'}`}>{isCurrentSelected && isHwOnline ? hwData.state : 'STANDBY'}</span></td>
                                <td className="px-5 py-3.5 text-gray-900 border-r border-red-200 font-sans">
                                  {isCurrentSelected && isHwOnline && Array.isArray(hwData.queue) && hwData.queue.filter(m => !isAdminUid(typeof m === 'string' ? m : m.uid)).length > 0 ?
                                  hwData.queue.filter(m => !isAdminUid(typeof m === 'string' ? m : m.uid)).map(m => terjemahkanIdKeNamaLengkap(typeof m === 'string' ? m : m.uid)).join(", ") : <span className="text-slate-500 italic">Kosong / Steril</span>}
                                  
                                  {isCurrentSelected && isHwOnline && hwData.active_fuelman && hwData.active_fuelman !== '' && (
                                    <span className="ml-2 px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold rounded-md inline-flex items-center gap-1 whitespace-nowrap animate-pulse">
                                      <i className="fa-solid fa-gas-pump"></i> BBM: {hwData.active_fuelman}
                                    </span>
                                  )}
                                </td>
                                <td className="px-5 py-3.5 font-bold text-amber-600 border-r border-red-200">{isCurrentSelected && isTrackingDowntime ? formatWaktuDowntime(downtimeSeconds) : '00:00:00'}</td>
                                <td className="px-5 py-3.5 text-right text-slate-600">{safeToFixed(box.lat, 4)}, {safeToFixed(box.lng, 4)}</td>
                              </tr>
                            );
                          })
                        ) : <tr><td colSpan="5" className="p-12 text-center text-slate-500 italic border border-red-200">Belum ada boks terdaftar.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {subTabMaintenance === 'pindaian-kartu' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-bold text-slate-600 font-mono-tech uppercase">Data Pindaian Kartu & Petugas Masuk</h3>
                      <p className="text-[10px] text-slate-500 mt-1">Daftar pindaian kartu RFID mekanik dan pengawas di lokasi kerja</p>
                    </div>
                    <span className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black font-mono-tech uppercase shadow-sm whitespace-nowrap">{totalOrangMasukOtomatis} Petugas di Lokasi</span>
                  </div>
                  <div className="bg-white border border-gray-300 px-3 py-2 rounded-xl shadow-sm flex items-center gap-2 max-w-xl">
                    <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                    <input type="text" placeholder="Cari nama personel, UID kartu, atau status..." className="w-full bg-transparent text-xs text-slate-950 focus:outline-none font-mono-tech" value={tappingSearchTerm} onChange={(e) => setTappingSearchTerm(e.target.value)} />
                    {tappingSearchTerm && <button type="button" onClick={() => setTappingSearchTerm('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">Clear</button>}
                  </div>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-[28rem] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono-tech">
                      <thead><tr className="bg-gray-100 text-slate-800 border-b-2 border-red-200"><th className="p-3">Foto</th><th className="p-3">Nama Petugas</th><th className="p-3 text-center">Status Sesi</th><th className="p-3 text-center">Waktu Masuk</th><th className="p-3 text-center">Waktu Keluar</th></tr></thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {filteredTappingData.length > 0 ? filteredTappingData.map((row) => (
                          <tr key={row.id} className="border-b-2 border-red-100 hover:bg-red-50/50"><td className="p-3"><Avatar profile={{ nama: row.nama, foto: row.foto }} className="w-9 h-9" /></td><td className="p-3 font-bold text-slate-900">{row.nama}<span className="block text-[10px] text-slate-400 font-normal">UID: {row.uid}</span></td><td className="p-3 text-center"><span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${row.badgeColor}`}>{row.status}</span></td><td className="p-3 text-center text-slate-600 font-mono font-semibold">{row.waktuMasuk}</td><td className="p-3 text-center font-bold text-slate-900 font-mono">{row.waktuKeluar}</td></tr>
                        )) : <tr><td colSpan="5" className="text-center py-10 text-slate-400 italic font-sans">{tappingSearchTerm ? 'Tidak ada data yang cocok dengan pencarian.' : 'Belum ada pindaian kartu pada unit ini.'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: KELOLA PERSONEL (ADMIN) */}
          {activeTab === 'admin-tab' && sessionUser?.role === 'admin' && (
            <div className="space-y-6">
              <div className="flex border-b border-gray-200 gap-2 font-mono-tech text-xs">
                <button type="button" onClick={() => setSubTabAdmin('daftar-personel')} className={`px-4 py-2 border-b-2 font-bold ${subTabAdmin === 'daftar-personel' ? 'border-red-600 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                  📁 Daftar Akun Personel
                </button>
                <button type="button" onClick={() => setSubTabAdmin('buffer-rfid')} className={`px-4 py-2 border-b-2 font-bold flex items-center gap-2 ${subTabAdmin === 'buffer-rfid' ? 'border-red-600 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                  <span>📡 Pindaian Kartu Baru</span>
                  {rfidBufferList.length > 0 && <span className="bg-red-600 text-white px-1.5 py-0.2 rounded-full text-[9px] font-bold animate-pulse">{rfidBufferList.length}</span>}
                </button>
              </div>

              {subTabAdmin === 'daftar-personel' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 pb-2">
                    <h3 className="text-base font-bold text-red-600 font-mono-tech">Daftar Akun Personel & Karyawan</h3>
                    <div className="flex items-center gap-2">
                      <input type="file" ref={excelFileInputRef} accept=".xlsx, .xls, .csv" className="hidden" onChange={handleImportExcel} />
                      <button type="button" onClick={() => excelFileInputRef.current && excelFileInputRef.current.click()} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold font-mono-tech uppercase flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">
                        <i className="fa-solid fa-file-excel"></i> Impor Excel / CSV
                      </button>
                      <button type="button" onClick={() => setShowAddUserForm(!showAddUserForm)} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold font-mono-tech uppercase shadow-sm active:scale-95 transition-all">
                        {showAddUserForm ? 'Tutup Form' : 'Tambah Karyawan'}
                      </button>
                    </div>
                  </div>

                  {rfidBufferList.length > 0 && (
                    <div className="bg-blue-50 border border-blue-300 p-3 rounded-xl flex items-center justify-between gap-2 text-blue-900 font-mono-tech text-xs">
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-satellite-dish text-blue-600 animate-pulse text-sm"></i>
                        <span>Ada <b>{rfidBufferList.length} Kartu Baru</b> terdeteksi dari pindaian boks!</span>
                      </div>
                      <button type="button" onClick={() => setSubTabAdmin('buffer-rfid')} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-[10px] font-bold uppercase">Lihat Kartu</button>
                    </div>
                  )}
                  
                  {showAddUserForm && (
                    <form onSubmit={handleIndukTambahUser} className="bg-gray-50 p-5 rounded-2xl border border-gray-200 space-y-4 text-xs font-mono-tech">
                      <div className="text-xs font-bold text-red-600 uppercase border-b pb-2">
                        <i className="fa-solid fa-user-plus mr-1"></i> Form Pendaftaran Karyawan Baru
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-slate-700 mb-1 font-bold">ID Karyawan (SID)</label>
                          <input type="text" required placeholder="Contoh: FP3US-001" className="w-full bg-white border p-2.5 rounded-lg" value={formAdminNewUser.sid} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, sid: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-slate-700 mb-1 font-bold">Nama Lengkap</label>
                          <input type="text" required placeholder="Masukkan Nama..." className="w-full bg-white border p-2.5 rounded-lg" value={formAdminNewUser.nama} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, nama: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-slate-700 mb-1 font-bold">Jabatan</label>
                          <select className="w-full bg-white border p-2.5 rounded-lg font-bold" value={formAdminNewUser.role} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, role: e.target.value })}>
                            <option value="teknisi">TEKNISI / MEKANIK</option>
                            <option value="pengawas">PENGAWAS K3 (SUPERVISOR)</option>
                            <option value="fuelman">PETUGAS BBM (FUELMAN)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-700 mb-1 font-bold">Kode Kartu RFID</label>
                          <div className="flex gap-1">
                            <input type="text" placeholder="UID Kartu..." className="w-full bg-white border p-2.5 rounded-lg uppercase" value={formAdminNewUser.rfidUid} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, rfidUid: e.target.value })} />
                            <button type="button" onClick={() => setFormAdminNewUser({...formAdminNewUser, rfidUid: (hwData.last_uid && hwData.last_uid !== '—' && hwData.last_uid !== 'SYSTEM') ? hwData.last_uid : ''})} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-2.5 rounded-lg font-bold text-xs shadow-sm">Ambil</button>
                          </div>
                        </div>
                        <div className="sm:col-span-2 md:col-span-4">
                          <label className="block text-slate-700 mb-1 font-bold">Foto Profil (URL atau Upload)</label>
                          <input type="url" placeholder="https://... atau assets/foto.jpg" className="w-full bg-white border p-2.5 rounded-lg text-slate-900 focus:outline-none focus:border-red-500" value={formAdminNewUser.foto && !formAdminNewUser.foto.startsWith('data:') ? formAdminNewUser.foto : ''} onChange={(e) => setFormAdminNewUser({...formAdminNewUser, foto: e.target.value})} />
                          <input type="file" accept="image/*" className="w-full mt-2 text-[10px]" onChange={(e) => handleProfilePhotoUpload(e, setFormAdminNewUser)} />
                          {formAdminNewUser.foto && formAdminNewUser.foto.startsWith('data:') && <div className="mt-2 flex justify-center"><div className="rounded-full bg-white p-1.5 shadow-md ring-2 ring-red-100"><Avatar profile={{ nama: formAdminNewUser.nama, foto: formAdminNewUser.foto }} className="w-20 h-20" /></div></div>}
                        </div>
                      </div>
                      <div className="flex justify-end pt-2 border-t">
                        <button type="submit" className="bg-red-600 text-white font-bold px-6 py-2.5 rounded-xl uppercase">Simpan Akun</button>
                      </div>
                    </form>
                  )}

                  <div className="bg-white border border-gray-200 p-2.5 rounded-xl shadow-sm flex items-center gap-2 max-w-md">
                    <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                    <input type="text" placeholder="Cari nama atau ID karyawan..." className="w-full bg-transparent text-xs focus:outline-none font-sans" value={adminSearchTerm} onChange={(e) => setAdminSearchTerm(e.target.value)} />
                    {adminSearchTerm && <button type="button" onClick={() => setAdminSearchTerm('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">Clear</button>}
                  </div>

                  {/* 3 KOLOM KELOMPOK DIVISI PERSONEL */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono-tech text-xs">
                    {/* PENGAWAS K3 */}
                    <div className="bg-white border border-gray-200 p-4 rounded-xl space-y-2 shadow-sm">
                      <h5 className="font-bold text-red-600 border-b pb-2">👮 PENGAWAS K3 ({groupPengawas.length})</h5>
                      {groupPengawas.map(u => (
                        <div key={u.sid} onClick={() => handleBukaModalEditUser(u)} className="p-2.5 rounded-lg border bg-gray-50 flex justify-between items-center hover:border-red-400 cursor-pointer transition-colors">
                          <Avatar profile={u} className="w-9 h-9" />
                          <div className="truncate flex-1 pl-2">
                            <p className="font-bold text-slate-950 truncate">{u.nama}</p>
                            <p className="text-[10px] text-slate-500">SID: {u.sid} | RFID: <span className="font-bold">{u.rfidUid || '—'}</span></p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleBukaModalEditUser(u); }} className="text-slate-400 hover:text-blue-600 p-1"><i className="fa-solid fa-pen-to-square"></i></button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusUser(u.sid); }} className="text-slate-400 hover:text-red-600 p-1"><i className="fa-solid fa-trash-can"></i></button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* TEKNISI / MEKANIK */}
                    <div className="bg-white border border-gray-200 p-4 rounded-xl space-y-2 shadow-sm">
                      <h5 className="font-bold text-red-600 border-b pb-2">🔧 TEKNISI / MEKANIK ({groupTeknisi.length})</h5>
                      {groupTeknisi.map(u => (
                        <div key={u.sid} onClick={() => handleBukaModalEditUser(u)} className="p-2.5 rounded-lg border bg-gray-50 flex justify-between items-center hover:border-red-400 cursor-pointer transition-colors">
                          <Avatar profile={u} className="w-9 h-9" />
                          <div className="truncate flex-1 pl-2">
                            <p className="font-bold text-slate-950 truncate">{u.nama}</p>
                            <p className="text-[10px] text-slate-500">SID: {u.sid} | RFID: <span className="font-bold">{u.rfidUid || '—'}</span></p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleBukaModalEditUser(u); }} className="text-slate-400 hover:text-blue-600 p-1"><i className="fa-solid fa-pen-to-square"></i></button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusUser(u.sid); }} className="text-slate-400 hover:text-red-600 p-1"><i className="fa-solid fa-trash-can"></i></button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* PETUGAS BBM */}
                    <div className="bg-white border border-gray-200 p-4 rounded-xl space-y-2 shadow-sm">
                      <h5 className="font-bold text-red-600 border-b pb-2">⛽ PETUGAS BBM ({groupFuelman.length})</h5>
                      {groupFuelman.map(u => (
                        <div key={u.sid} onClick={() => handleBukaModalEditUser(u)} className="p-2.5 rounded-lg border bg-gray-50 flex justify-between items-center hover:border-red-400 cursor-pointer transition-colors">
                          <Avatar profile={u} className="w-9 h-9" />
                          <div className="truncate flex-1 pl-2">
                            <p className="font-bold text-slate-950 truncate">{u.nama}</p>
                            <p className="text-[10px] text-slate-500">SID: {u.sid} | RFID: <span className="font-bold">{u.rfidUid || '—'}</span></p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleBukaModalEditUser(u); }} className="text-slate-400 hover:text-blue-600 p-1"><i className="fa-solid fa-pen-to-square"></i></button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusUser(u.sid); }} className="text-slate-400 hover:text-red-600 p-1"><i className="fa-solid fa-trash-can"></i></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* BUFFER RFID */}
              {subTabAdmin === 'buffer-rfid' && (
                <div className="space-y-4 font-mono-tech">
                  <div className="flex justify-between items-center border-b pb-2">
                    <div>
                      <h3 className="text-base font-bold text-blue-700 uppercase flex items-center gap-2">
                        <i className="fa-solid fa-satellite-dish text-blue-600 animate-pulse"></i>
                        <span>Pindaian Kartu Baru yang Belum Terdaftar</span>
                      </h3>
                      <p className="text-xs text-slate-600 font-sans mt-0.5">Daftar kartu RFID fisik yang ditempelkan di boks dan siap ditautkan ke akun karyawan.</p>
                    </div>
                    <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold uppercase">{rfidBufferList.length} Kartu Terbaca</span>
                  </div>

                  {rfidBufferList.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                      {rfidBufferList.map((item) => (
                        <div key={item.id} className="bg-white border-2 border-blue-200 p-3.5 rounded-2xl flex items-center justify-between shadow-sm hover:border-blue-500 transition-colors">
                          <div>
                            <p className="font-black text-blue-900 text-sm">{item.rfid_uid}</p>
                            <p className="text-[10px] text-slate-500 font-sans mt-0.5">Unit: {item.id_box}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => {
                              const target = userDatabase.find(u => !u.rfidUid);
                              if (target) {
                                setFormEditUser({ sid: target.sid, nama: target.nama, role: target.role, rfidUid: item.rfid_uid, foto: target.foto });
                                setShowEditUserModal(true);
                              } else {
                                pemicuToast('Pilih karyawan di daftar personel untuk menautkan kartu ini!', 'ok');
                                setSubTabAdmin('daftar-personel');
                              }
                            }} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold uppercase">
                              Tautkan
                            </button>
                            <button type="button" onClick={() => handleHapusBuffer(item.id)} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors" title="Hapus">
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 p-12 rounded-2xl text-center space-y-2">
                      <i className="fa-solid fa-id-card text-slate-300 text-4xl"></i>
                      <p className="text-sm font-bold text-slate-700">Belum Ada Kartu Baru yang Terbaca</p>
                      <p className="text-xs text-slate-500 font-sans">Tekan Tombol 3 di boks untuk membaca kartu RFID fisik baru.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* DOKUMEN CETAK PDF K3 RESMI */}
      {printActiveLog && (
        <div className="print-show hidden p-8 bg-white font-sans text-slate-900">
          <div className="border-2 border-red-600 p-6 rounded-lg space-y-4">
            <div className="border-b-2 border-red-600 pb-3 flex justify-between items-center">
              <div>
                <h1 className="text-lg font-black text-red-600 uppercase font-mono-tech">MANIFES K3 INDUSTRI - LAPORAN E-LOTO</h1>
                <p className="text-xs text-slate-600 font-bold uppercase">Dokumen Resmi Lembar Pemeliharaan Alat Berat</p>
              </div>
              <div className="text-right text-xs font-mono">
                <p><b>Waktu:</b> {printActiveLog.waktu || '—'}</p>
                <p><b>ID Laporan:</b> #{printActiveLog.id}</p>
              </div>
            </div>

            <table className="w-full text-xs border-collapse border border-slate-300">
              <tbody>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100 w-1/3">Nama Box / Unit Mesin</td>
                  <td className="p-2.5 font-bold text-red-600 uppercase">{printActiveLog.mesin}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100">Mekanik Penanggung Jawab</td>
                  <td className="p-2.5 font-semibold">{printActiveLog.teknisi}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100">Pengawas K3 Penanggung Jawab</td>
                  <td className="p-2.5 font-semibold">{printActiveLog.pengawas || '—'}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100">Klasifikasi Gangguan</td>
                  <td className="p-2.5">{printActiveLog.jenis}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100">Estimasi Waktu</td>
                  <td className="p-2.5">{printActiveLog.estimasi}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100">Status Akhir</td>
                  <td className="p-2.5 font-bold uppercase">{printActiveLog.status}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2.5 font-bold bg-slate-100">Deskripsi Perbaikan</td>
                  <td className="p-2.5 whitespace-pre-wrap">{printActiveLog.deskripsi}</td>
                </tr>
              </tbody>
            </table>

            {printActiveLog.foto && (
              <div className="pt-2">
                <p className="text-xs font-bold mb-2 text-slate-700">Foto Bukti Kerusakan di Lapangan:</p>
                <img src={printActiveLog.foto} alt="Bukti Lapangan" className="max-h-56 border rounded-lg object-contain" />
              </div>
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );
}