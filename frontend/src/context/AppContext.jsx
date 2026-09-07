import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import api from '../services/api';
import userService from '../services/userService';
import boxService from '../services/boxService';
import logService from '../services/logService';
import { useAuth } from './AuthContext';
import {
  getUserProfile, isSystemUid, isAdminUid, normalizeUserRole,
  terjemahkanIdKeNamaLengkap
} from '../utils/helpers';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { isLoggedIn, sessionUser, activeTab, setActiveTab } = useAuth();

  const [boxes, setBoxes] = useState([]);
  const [selectedBox, setSelectedBox] = useState(null);
  const [isHwOnline, setIsHwOnline] = useState(false);
  const [hwData, setHwData] = useState({
    lcd0: '  SISTEM READY', lcd1: 'TEKAN 1 UTK MULAI', state: 'STATE_IDLE',
    relay_open: false, last_event: '', last_event_ok: true, gps_fix: false,
    supervisor_uid: '—', active_fuelman: '', last_uid: '—', wifi_connected: false,
    queue: [], audit_log: [], uptime_ms: 0,
    lat: '', lon: '', lng: '', ssid: '—'
  });

  const [downtimeSeconds, setDowntimeSeconds] = useState(0);
  const [isTrackingDowntime, setIsDowntimeTracking] = useState(false);
  const [userDatabase, setUserDatabase] = useState([
    { sid: 'Admin', nama: 'Master Administrator', role: 'admin', rfidUid: '0000', password: 'Admin', foto: 'assets/default-avatar.png' }
  ]);
  const [logPemeliharaan, setLogPemeliharaan] = useState([]);
  const [rfidBufferList, setRfidBufferList] = useState([]);
  const [tappingHistory, setTappingHistory] = useState([]);
  const [localAuditLog, setLocalAuditLog] = useState([]);
  const [deletedAuditIds, setDeletedAuditIds] = useState([]);

  const [toast, setToast] = useState({ show: false, msg: '', type: '' });
  const [modalInfo, setModalInfo] = useState({ open: false, title: '', icon: '', content: null });
  const [showRadarModal, setShowRadarModal] = useState(false);
  const [radarModalSearch, setRadarModalSearch] = useState('');
  const [radarDetailBox, setRadarDetailBox] = useState(null);

  const [photoBase64, setPhotoBase64] = useState('');
  const [cropPhotoSrc, setCropPhotoSrc] = useState('');
  const [cropTargetSetter, setCropTargetSetter] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [printActiveLog, setPrintActiveLog] = useState(null);
  const [subTabMaintenance, setSubTabMaintenance] = useState('menu-riwayat');
  const [subTabAdmin, setSubTabAdmin] = useState('daftar-personel');

  // Refs
  const mapContainerRef = useRef(null);
  const leafletMapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const geoAddressCacheRef = useRef({});
  const lastProcessedEventRef = useRef({ event: '', uid: '' });
  const lastCenteredBoxIdRef = useRef(null);
  const lastKnownCoordsRef = useRef({});
  const overrideLockoutRef = useRef(false);
  const excelFileInputRef = useRef(null);
  const selectedBoxIdRef = useRef(null);
  const isFetchingRef = useRef(false);
  const lastSeenOnlineRef = useRef({});

  // Form states
  const [formData, setFormData] = useState({ sid: '', password: '' });
  const [formDeskripsi, setFormDeskripsi] = useState('');
  const [tipeKerusakan, setTipeKerusakan] = useState('Mekanikal');
  const [estimasiWaktu, setEstimasiWaktu] = useState('');
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [formAlatBerat, setFormAlatBerat] = useState({ id: '', unit: '', ip: '', lat: '', lng: '' });
  const [editingBoxId, setEditingBoxId] = useState('');
  const [formAdminNewUser, setFormAdminNewUser] = useState({ sid: '', nama: '', role: 'teknisi', rfidUid: '', password: '', foto: '' });
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [formEditUser, setFormEditUser] = useState({ sid: '', nama: '', role: 'teknisi', rfidUid: '', foto: '' });
  const [manualMekanik, setManualMekanik] = useState('');
  const [pengawasLoto, setPengawasLoto] = useState('');

  // Search terms
  const [boxSearchTerm, setBoxSearchTerm] = useState('');
  const [adminSearchTerm, setAdminSearchTerm] = useState('');
  const [mechanicSearchTerm, setMechanicSearchTerm] = useState('');
  const [tappingSearchTerm, setTappingSearchTerm] = useState('');
  const [auditSearchTerm, setAuditSearchTerm] = useState('');
  const [maintenanceSearchTerm, setMaintenanceSearchTerm] = useState('');
  const [maintenanceTypeFilter, setMaintenanceTypeFilter] = useState('');

  // Team management (pengawas)
  const [selectedMechanicSids, setSelectedMechanicSids] = useState([]);
  const [teamBoxId, setTeamBoxId] = useState('');
  const [teamMaintenanceType, setTeamMaintenanceType] = useState('Mekanikal');

  // Toast helper
  const pemicuToast = (msg, type = '') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: '' }), 2600);
  };

  // Listen for toast events from child components
  useEffect(() => {
    const handler = (e) => pemicuToast(e.detail.msg, e.detail.type);
    window.addEventListener('eloto-toast', handler);
    return () => window.removeEventListener('eloto-toast', handler);
  }, []);

  // Listen for subtab events from sidebar
  useEffect(() => {
    const handler = (e) => setSubTabMaintenance(e.detail.subTab);
    window.addEventListener('eloto-set-subtab', handler);
    return () => window.removeEventListener('eloto-set-subtab', handler);
  }, []);

  // Helper functions
  const getUserProfileLocal = (uid) => getUserProfile(uid, userDatabase);
  const isSystemUidLocal = (uid) => isSystemUid(uid);
  const isAdminUidLocal = (uid) => isAdminUid(uid, userDatabase);
  const terjemahkanIdKeNamaLengkapLocal = (id) => terjemahkanIdKeNamaLengkap(id, userDatabase);

  // Profile photo upload handler
  const handleProfilePhotoUpload = (event, setter) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      setCropTargetSetter(() => setter);
      setCropPhotoSrc(loadEvent.target.result);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleConfirmProfileCrop = (croppedDataUrl) => {
    if (cropTargetSetter) {
      cropTargetSetter(prev => ({ ...prev, foto: croppedDataUrl }));
      setCropTargetSetter(null);
    }
    setCropPhotoSrc('');
  };

  const handleCancelProfileCrop = () => {
    setCropTargetSetter(null);
    setCropPhotoSrc('');
  };

  // General modal helper
  const bukaModalUmum = (title, icon, content) => {
    if (title === 'Data Pindaian Kartu & Petugas Masuk') {
      setActiveTab('riwayat-tab');
      setSubTabMaintenance('pindaian-kartu');
      return;
    }
    setModalInfo({ open: true, title, icon, content });
  };

  const bukaModalRadar = () => {
    setRadarModalSearch('');
    setRadarDetailBox(null);
    setShowRadarModal(true);
  };

  // Profile photo upload handler
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

  // ==================== EFFECTS ====================

  // Load user database
  useEffect(() => {
    const muatUserDatabaseGlobal = async () => {
      try {
        const result = await userService.getAllUsers();
        const dataUsers = result.data || result;
        const masterAdmin = { sid: 'Admin', nama: 'Master Administrator', role: 'admin', rfidUid: '0000', password: 'Admin', foto: 'assets/default-avatar.png' };
        const dataSteril = Array.isArray(dataUsers)
          ? dataUsers.map(u => ({
            ...u,
            role: normalizeUserRole(u.role),
            rfidUid: u.rfid_uid || u.rfidUid || '',
            foto: u.foto || 'assets/default-avatar.png'
          })).filter(u => u.sid !== 'Admin')
          : [];
        setUserDatabase([masterAdmin, ...dataSteril]);
      } catch (err) { /* silent */ }
    };
    muatUserDatabaseGlobal();
    const intervalUser = setInterval(muatUserDatabaseGlobal, 5000);
    return () => clearInterval(intervalUser);
  }, []);

  // Load maintenance, buffer, tapping history
  useEffect(() => {
    const muatDataLaporanDanBuffer = async () => {
      try {
        const maintenanceResult = await boxService.getAllMaintenance();
        const data = maintenanceResult.data || maintenanceResult;
        if (Array.isArray(data)) setLogPemeliharaan(data);

        const bufferResult = await logService.getRfidBuffer();
        const dataBuffer = bufferResult.data || bufferResult;
        if (Array.isArray(dataBuffer)) setRfidBufferList(dataBuffer);

        const historyResult = await logService.getTappingHistory(200);
        const normalizedHistory = Array.isArray(historyResult)
          ? historyResult
          : (Array.isArray(historyResult?.data) ? historyResult.data : []);
        setTappingHistory(normalizedHistory);
      } catch (err) { /* silent */ }
    };

    if (isLoggedIn) {
      muatDataLaporanDanBuffer();
      const intervalSync = setInterval(muatDataLaporanDanBuffer, 4000);
      return () => clearInterval(intervalSync);
    }
  }, [isLoggedIn, selectedBox?.id]);

  // Downtime timer
  useEffect(() => {
    if (!selectedBox) return undefined;
    const resetTimer = () => {
      setIsDowntimeTracking(false);
      setDowntimeSeconds(0);
      localStorage.removeItem(`downtime_${selectedBox.id}`);
    };
    const lockStates = ['STATE_WAIT_SPV_IN', 'STATE_MEKANIK_IN', 'STATE_LOTO_LOCKED_ACTIVE', 'STATE_CHOOSE_ACTION', 'STATE_ALL_WORKERS_REGISTERED'];
    const timerShouldRun = isHwOnline && lockStates.includes(hwData.state);
    if (!timerShouldRun) { resetTimer(); return undefined; }

    const savedDowntime = localStorage.getItem(`downtime_${selectedBox.id}`);
    setDowntimeSeconds(savedDowntime ? Number(savedDowntime) || 0 : 0);
    setIsDowntimeTracking(true);

    const intervalId = setInterval(() => {
      setDowntimeSeconds(prev => {
        const nextValue = prev + 1;
        localStorage.setItem(`downtime_${selectedBox.id}`, String(nextValue));
        return nextValue;
      });
    }, 1000);
    return () => clearInterval(intervalId);
  }, [hwData.state, isHwOnline, selectedBox?.id]);

  // Supervisor team loading
  useEffect(() => {
    if (sessionUser?.role !== 'pengawas' || boxes.length === 0) return;
    setTeamBoxId(current => current || String(boxes[0].id));
  }, [sessionUser?.role, boxes]);

  useEffect(() => {
    if (sessionUser?.role !== 'pengawas' || !teamBoxId) return;
    const loadSupervisorTeam = async () => {
      try {
        const result = await userService.getSupervisorTeam(sessionUser.sid, teamBoxId);
        const team = result.data || result;
        setSelectedMechanicSids(Array.isArray(team) ? team.map(m => m.sid) : []);
        if (Array.isArray(team) && team[0]?.maintenance_type) setTeamMaintenanceType(team[0].maintenance_type);
      } catch (error) { setSelectedMechanicSids([]); }
    };
    loadSupervisorTeam();
  }, [sessionUser?.sid, sessionUser?.role, teamBoxId]);

  // MAIN TELEMETRY POLLING
  useEffect(() => {
    if (!isLoggedIn) return;

    const muatDataOperasionalMesin = async () => {
      if (overrideLockoutRef.current || isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        const resultAset = await boxService.getAllBoxes();
        const dataAset = resultAset.data || resultAset;
        const dataMapped = Array.isArray(dataAset)
          ? dataAset.map(b => {
            const id_box = b.id_box || b.id;
            let extraHw = {};
            if (b.hw_data) { try { extraHw = typeof b.hw_data === 'string' ? JSON.parse(b.hw_data) : b.hw_data; } catch (e) {} }
            const realLat = (b.lat && !isNaN(Number(b.lat)) && Number(b.lat) !== 0) ? Number(b.lat) : (extraHw.lat ? Number(extraHw.lat) : 2.144691);
            const realLng = (b.lng && !isNaN(Number(b.lng)) && Number(b.lng) !== 0) ? Number(b.lng) : ((b.lon && !isNaN(Number(b.lon)) && Number(b.lon) !== 0) ? Number(b.lon) : (extraHw.lng || extraHw.lon ? Number(extraHw.lng || extraHw.lon) : 117.477526));
            if (realLat !== 0 && realLng !== 0) {
              const oldCoords = lastKnownCoordsRef.current[id_box];
              if (oldCoords) {
                const selisih = Math.abs(oldCoords.lat - realLat) + Math.abs(oldCoords.lng - realLng);
                if (selisih > 0.0001) pemicuToast(`📡 Posisi GPS Berpindah [${id_box}]!`, "ok");
              }
              lastKnownCoordsRef.current[id_box] = { lat: realLat, lng: realLng };
            }
            return { ...extraHw, ...b, id: id_box, id_box: id_box, lat: realLat, lng: realLng, lon: realLng };
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
            } catch (e) { /* fallback database */ }
          } else {
            isDeviceActive = Number(boksTerbaru.is_online) === 1;
          }

          const lastSeen = lastSeenOnlineRef.current[bId] || 0;
          const isSmoothOnline = canProbeDevice ? isDeviceActive : (isDeviceActive && Date.now() - lastSeen < 15000);
          if (isDeviceActive) {
            const directIp = boksTerbaru.ip || '';
            if (directIp && directIp !== '192.168.1.100') {
              boksTerbaru.ip = directIp.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
            }
          }

          setSelectedBox(boksTerbaru);
          setIsHwOnline(isSmoothOnline);

          let queueFinal = [];
          if (Array.isArray(boksTerbaru.queue)) { queueFinal = boksTerbaru.queue; }
          else if (typeof boksTerbaru.queue === 'string') { try { queueFinal = JSON.parse(boksTerbaru.queue); } catch (e) {} }

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
      } catch (err) {} finally { isFetchingRef.current = false; }
    };

    muatDataOperasionalMesin();
    const intervalKoneksi = setInterval(muatDataOperasionalMesin, 2500);
    return () => clearInterval(intervalKoneksi);
  }, [isLoggedIn]);

  // Audit log from HW events
  useEffect(() => {
    if (!isHwOnline || !hwData.last_event || hwData.last_event === '—' || hwData.last_event === '') return;
    if (lastProcessedEventRef.current.event === hwData.last_event && lastProcessedEventRef.current.uid === hwData.last_uid) return;
    lastProcessedEventRef.current = { event: hwData.last_event, uid: hwData.last_uid };
    setLocalAuditLog(prev => [{
      ts: Date.now(), event: hwData.last_event, uid: hwData.last_uid, ok: hwData.last_event_ok,
      lat: selectedBox ? parseFloat(selectedBox.lat) : 2.144691,
      lon: selectedBox ? parseFloat(selectedBox.lng) : 117.477526,
      isLocal: true
    }, ...prev]);
  }, [hwData.last_event, hwData.last_uid, hwData.last_event_ok, isHwOnline, selectedBox?.id]);

  // ==================== HANDLERS ====================

  const handleSelectBox = (box) => {
    selectedBoxIdRef.current = box.id;
    setSelectedBox(box);
    const clickLat = Number(box.lat);
    const clickLng = Number(box.lng || box.lon);
    if (leafletMapInstanceRef.current && !isNaN(clickLat) && !isNaN(clickLng) && clickLat !== 0 && clickLng !== 0) {
      leafletMapInstanceRef.current.flyTo([clickLat, clickLng], 18, { animate: true, duration: 1.2 });
      setTimeout(() => {
        if (markersRef.current && markersRef.current[box.id]) markersRef.current[box.id].openPopup();
      }, 500);
    }
    lastCenteredBoxIdRef.current = box.id;
  };

  const handleTambahAlatBerat = async (e) => {
    e.preventDefault();
    const cleanId = formAlatBerat.id.replace(/[<>]/g, "").trim();
    const cleanUnit = formAlatBerat.unit.replace(/[<>]/g, "").trim();
    const cleanIp = formAlatBerat.ip.replace(/[<>]/g, "").trim();
    const cleanLat = parseFloat(formAlatBerat.lat);
    const cleanUnitLng = parseFloat(formAlatBerat.lng);
    const newUnit = { id_box: cleanId, unit: cleanUnit, ip: cleanIp || '192.168.1.100', lat: isNaN(cleanLat) ? '' : cleanLat, lng: isNaN(cleanUnitLng) ? '' : cleanUnitLng };
    try {
      const hasil = editingBoxId
        ? await boxService.updateBox(editingBoxId, { ...newUnit, idBox: cleanId })
        : await boxService.createBox({ ...newUnit, idBox: cleanId });
      if (hasil.success || hasil.status === 'success') {
        const savedBox = { ...newUnit, id: cleanId };
        setBoxes(prev => editingBoxId ? prev.map(box => String(box.id) === String(cleanId) ? { ...box, ...savedBox } : box) : [...prev, savedBox]);
        setSelectedBox(prev => prev && String(prev.id) === String(cleanId) ? { ...prev, ...savedBox } : savedBox);
        selectedBoxIdRef.current = cleanId;
        setEditingBoxId('');
        setFormAlatBerat({ id: '', unit: '', ip: '', lat: '', lng: '' });
        pemicuToast(editingBoxId ? 'Data boks berhasil diperbarui.' : (hasil.message || 'Berhasil menyimpan boks'), 'ok');
      } else { pemicuToast(hasil.message, 'fail'); }
    } catch (err) { pemicuToast("Gagal mendaftarkan unit box ke server!", "fail"); }
  };

  const handleEditAlatBerat = (box) => {
    setEditingBoxId(box.id);
    setFormAlatBerat({ id: box.id || '', unit: box.unit || '', ip: box.ip || '', lat: box.lat || '', lng: box.lng || box.lon || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBatalEditAlatBerat = () => {
    setEditingBoxId('');
    setFormAlatBerat({ id: '', unit: '', ip: '', lat: '', lng: '' });
  };

  const handleHapusAlatBerat = async (idBox) => {
    if (window.confirm(`Hapus ${idBox} secara permanen?`)) {
      try {
        const hasil = await boxService.deleteBox(idBox);
        if (hasil.success || hasil.status === 'success') {
          const sisaBox = boxes.filter(b => String(b.id).toLowerCase().trim() !== String(idBox).toLowerCase().trim());
          setBoxes(sisaBox);
          if (selectedBox && String(selectedBox.id).toLowerCase().trim() === String(idBox).toLowerCase().trim()) {
            setSelectedBox(sisaBox[0] || null);
            selectedBoxIdRef.current = sisaBox[0] ? sisaBox[0].id : null;
          }
          pemicuToast(hasil.message || 'Boks dihapus', "ok");
        } else { pemicuToast(hasil.message, "fail"); }
      } catch (err) { pemicuToast("Gagal terhubung ke API hapus unit.", "fail"); }
    }
  };

  const handleAutoGps = async () => {
    setIsSyncing(true);
    pemicuToast("Mencari Sinyal Satelit GPS...", "ok");
    let latHasil = null;
    let lngHasil = null;
    try {
      const resultAset = await boxService.getAllBoxes();
      const dataAset = resultAset.data || resultAset;
      const targetId = (formAlatBerat.id || '').toLowerCase().trim();
      const boksTarget = Array.isArray(dataAset) ? dataAset.find(b =>
        String(b.id_box || b.id).toLowerCase().trim() === targetId ||
        (selectedBox && String(b.id_box || b.id).toLowerCase().trim() === String(selectedBox.id).toLowerCase().trim())
      ) || dataAset[0] : null;
      if (boksTarget) {
        const validLat = parseFloat(boksTarget.lat);
        const validLng = parseFloat(boksTarget.lng || boksTarget.lon);
        if (!isNaN(validLat) && !isNaN(validLng) && validLat !== 0 && validLng !== 0) { latHasil = validLat; lngHasil = validLng; }
      }
    } catch (err) {}
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
          if (!isNaN(vLat) && !isNaN(vLng) && vLat !== 0 && vLng !== 0) { latHasil = vLat; lngHasil = vLng; }
        }
      } catch (e) {}
    }
    if (latHasil && lngHasil) {
      setFormAlatBerat(prev => ({ ...prev, lat: latHasil.toFixed(6), lng: lngHasil.toFixed(6) }));
      pemicuToast(`✓ GPS Terkunci! (${latHasil.toFixed(4)}, ${lngHasil.toFixed(4)})`, "ok");
    } else {
      setFormAlatBerat(prev => ({ ...prev, lat: "2.144691", lng: "117.477526" }));
      pemicuToast("⚠️ Mode Dasar Berau (2.1446, 117.4775)", "ok");
    }
    setIsSyncing(false);
  };

  const dapatkanMekanikDariAntreanLoto = () => {
    if (!selectedBox || !hwData || !Array.isArray(hwData.queue) || hwData.queue.length === 0) return "";
    const mekanikOnly = hwData.queue.filter(item => {
      const itemUid = typeof item === 'string' ? item : item.uid;
      const uObj = userDatabase.find(u => String(u.rfidUid || u.rfid_uid).toUpperCase() === String(itemUid).toUpperCase() || String(u.sid).toUpperCase() === String(itemUid).toUpperCase());
      const isSpv = (typeof item === 'object' && (item.role === 'spv' || item.role === 'pengawas')) || (uObj && uObj.role === 'pengawas') || (itemUid === hwData.supervisor_uid);
      return !isSpv;
    });
    if (mekanikOnly.length === 0) return "";
    return mekanikOnly.map(m => terjemahkanIdKeNamaLengkapLocal(typeof m === 'string' ? m : m.uid)).join(", ");
  };

  const dapatkanPengawasDariLoto = () => {
    if (!selectedBox || !hwData) return "";
    if (hwData.supervisor_uid && hwData.supervisor_uid !== '—' && hwData.supervisor_uid !== '') return terjemahkanIdKeNamaLengkapLocal(hwData.supervisor_uid);
    if (Array.isArray(hwData.queue)) {
      const spvItem = hwData.queue.find(item => {
        const itemUid = typeof item === 'string' ? item : item.uid;
        const uObj = userDatabase.find(u => String(u.rfidUid || u.rfid_uid).toUpperCase() === String(itemUid).toUpperCase() || String(u.sid).toUpperCase() === String(itemUid).toUpperCase());
        return (typeof item === 'object' && (item.role === 'spv' || item.role === 'pengawas')) || (uObj && uObj.role === 'pengawas');
      });
      if (spvItem) return terjemahkanIdKeNamaLengkapLocal(typeof spvItem === 'string' ? spvItem : spvItem.uid);
    }
    return "";
  };

  const handleSaveMechanicTeam = async (event) => {
    event.preventDefault();
    const selectedNames = groupTeknisi.filter(user => selectedMechanicSids.includes(user.sid)).map(user => user.nama);
    try {
      const result = await userService.saveSupervisorTeam({
        supervisor_sid: sessionUser.sid, id_box: teamBoxId,
        maintenance_type: teamMaintenanceType, mechanic_sids: selectedMechanicSids
      });
      if (!result || (!result.success && result.status !== 'success')) throw new Error(result?.message || 'Gagal menyimpan tim.');
      setManualMekanik(selectedNames.join(', '));
      pemicuToast(`${selectedNames.length} mekanik dipilih untuk ${teamBoxId}.`, 'ok');
    } catch (error) { pemicuToast(error.message || 'Gagal menyimpan tim mekanik.', 'fail'); }
  };

  const handleIndukTambahUser = async (e) => {
    e.preventDefault();
    const cleanSid = formAdminNewUser.sid.replace(/[<>]/g, "").trim();
    const cleanNama = formAdminNewUser.nama.replace(/[<>]/g, "").trim();
    const cleanRfid = formAdminNewUser.rfidUid.replace(/[<>]/g, "").trim();
    if (!cleanSid || !cleanNama) { alert("Mohon lengkapi ID Karyawan (SID) dan Nama Lengkap!"); return; }
    const dataKaryawanBaru = { sid: cleanSid, nama: cleanNama, role: formAdminNewUser.role, rfidUid: cleanRfid, password: cleanSid, foto: formAdminNewUser.foto || 'assets/default-avatar.png' };
    try {
      const hasil = await userService.createUser(dataKaryawanBaru);
      if (hasil.success || hasil.status === 'success') {
        setUserDatabase([...userDatabase, { ...dataKaryawanBaru }]);
        setFormAdminNewUser({ sid: '', nama: '', role: 'teknisi', rfidUid: '', password: '', foto: '' });
        setShowAddUserForm(false);
        pemicuToast(` ✓ ${hasil.message || 'Karyawan didaftarkan'}`, "ok");
      } else { pemicuToast(hasil.message, "fail"); }
    } catch (err) { pemicuToast("Gagal mendaftarkan personel ke database!", "fail"); }
  };

  const handleImportExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const XLSX = await import('xlsx');
    pemicuToast("Membaca berkas Excel...", "ok");
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        if (jsonRows.length === 0) { pemicuToast("Berkas Excel kosong atau tidak memiliki baris data!", "fail"); return; }
        pemicuToast(`Mengimpor ${jsonRows.length} data karyawan...`, "ok");
        let suksesCount = 0;
        for (const row of jsonRows) {
          let sidVal = '', namaVal = '', roleVal = 'teknisi', rfidVal = '';
          Object.keys(row).forEach(key => {
            const kLower = key.toLowerCase().trim();
            const val = String(row[key] || '').trim();
            if (kLower.includes('sid') || kLower.includes('id')) { if (!sidVal && val) sidVal = val; }
            if (kLower.includes('nama')) { if (!namaVal && val) namaVal = val; }
            if (kLower.includes('role') || kLower.includes('jabatan')) {
              if (val) {
                const rLower = val.toLowerCase();
                if (rLower.includes('pengawas') || rLower.includes('spv') || rLower.includes('k3') || rLower.includes('supervisor')) roleVal = 'pengawas';
                else if (rLower.includes('fuel') || rLower.includes('bbm') || rLower.includes('refuel')) roleVal = 'fuelman';
                else roleVal = 'teknisi';
              }
            }
            if (kLower.includes('rfid')) { if (val) rfidVal = val.toUpperCase(); }
          });
          if (sidVal && namaVal) {
            try {
              const resJson = await userService.createUser({ sid: sidVal, nama: namaVal, role: roleVal, rfidUid: rfidVal, password: sidVal, foto: 'assets/default-avatar.png' });
              if (resJson.success || resJson.status === 'success') suksesCount++;
            } catch (err) {}
          }
        }
        // Refresh user database
        const resultUsers = await userService.getAllUsers();
        const dataUsers = resultUsers.data || resultUsers;
        const masterAdmin = { sid: 'Admin', nama: 'Master Administrator', role: 'admin', rfidUid: '0000', password: 'Admin', foto: 'assets/default-avatar.png' };
        const dataSteril = Array.isArray(dataUsers) ? dataUsers.map(u => ({ ...u, role: normalizeUserRole(u.role), rfidUid: u.rfid_uid || u.rfidUid || '', foto: u.foto || 'assets/default-avatar.png' })).filter(u => u.sid !== 'Admin') : [];
        setUserDatabase([masterAdmin, ...dataSteril]);
        pemicuToast(` ✓ Berhasil mengimpor ${suksesCount} data karyawan ke MySQL!`, "ok");
        e.target.value = '';
      } catch (err) { pemicuToast("Gagal memproses berkas Excel!", "fail"); }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBukaModalEditUser = (user, defaultRfidInput = '') => {
    setFormEditUser({ sid: user.sid, nama: user.nama, role: user.role || 'teknisi', rfidUid: defaultRfidInput || user.rfidUid || user.rfid_uid || '', foto: user.foto || '' });
    setShowEditUserModal(true);
  };

  const handleSimpanEditUser = async (e) => {
    e.preventDefault();
    const cleanSid = formEditUser.sid.trim();
    const cleanNama = formEditUser.nama.trim();
    const cleanRfid = formEditUser.rfidUid.trim().toUpperCase();
    if (!cleanSid || !cleanNama) { pemicuToast("SID dan Nama Karyawan Wajib Diisi!", "fail"); return; }
    const payloadUser = { sid: cleanSid, nama: cleanNama, role: formEditUser.role, rfidUid: cleanRfid, password: cleanSid, foto: formEditUser.foto || 'assets/default-avatar.png' };
    try {
      const hasil = await userService.updateUser(cleanSid, payloadUser);
      if (hasil.success || hasil.status === 'success') {
        const fotoTerbaru = hasil.data?.profile_photo || hasil.foto || payloadUser.foto;
        setUserDatabase(prev => prev.map(u => u.sid === cleanSid ? { ...u, ...payloadUser, foto: fotoTerbaru } : u));
        setShowEditUserModal(false);
        pemicuToast(` ✓ Data ${cleanNama} berhasil diperbarui!`, "ok");
      } else { pemicuToast(hasil.message || "Gagal memperbarui data personel!", "fail"); }
    } catch (err) { pemicuToast("Gagal terhubung ke database!", "fail"); }
  };

  const handleHapusUser = async (sidUser) => {
    if (sidUser === 'Admin') { alert("Akun Master Admin utama tidak boleh dihapus!"); return; }
    if (window.confirm(`Hapus permanen data karyawan dengan ID: ${sidUser}?`)) {
      try {
        const hasil = await userService.deleteUser(sidUser);
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
        const hasil = await logService.deleteBuffer(idBuffer);
        if (hasil.success || hasil.status === 'success') {
          setRfidBufferList(prev => prev.filter(item => item.id !== idBuffer));
          pemicuToast(" ✓ " + (hasil.message || "Berhasil"), "ok");
        } else { pemicuToast(hasil.message || "Gagal menghapus kartu!", "fail"); }
      } catch (err) { pemicuToast("Gagal terhubung ke API buffer", "fail"); }
    }
  };

  const handleSimpanKerusakan = async (e) => {
    e.preventDefault();
    const mekanikFinal = manualMekanik.trim() || dapatkanMekanikDariAntreanLoto();
    if (!mekanikFinal || mekanikFinal.startsWith("TIDAK ADA MEKANIK")) { pemicuToast("GAGAL: Nama mekanik penanggung jawab wajib diisi atau di-tap!", "fail"); return; }
    const pengawasFinal = pengawasLoto.trim() || dapatkanPengawasDariLoto() || 'Diverifikasi RFID LOTO';
    const cleanDeskripsi = formDeskripsi.replace(/[<>]/g, "").trim();
    const cleanEstimasi = estimasiWaktu.replace(/[<>]/g, "").trim();
    const statusKerjaAktif = (manualMekanik.trim() || (isHwOnline && hwData.queue && hwData.queue.length > 0)) ? 'PROSES' : 'SELESAI';
    const dataLaporanBaru = {
      waktu: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
      mesin: selectedBox ? selectedBox.id : 'Universal Box', id_box: selectedBox ? selectedBox.id : 'Universal Box',
      jenis: tipeKerusakan, estimasi: cleanEstimasi || '4 Jam', teknisi: mekanikFinal, pengawas: pengawasFinal,
      deskripsi: cleanDeskripsi, status: statusKerjaAktif, foto: photoBase64
    };
    try {
      const hasil = await boxService.createMaintenance(dataLaporanBaru);
      if (hasil.success || hasil.status === 'success') {
        setLogPemeliharaan(prev => [dataLaporanBaru, ...prev]);
        setFormDeskripsi(''); setEstimasiWaktu(''); setPhotoBase64('');
        setManualMekanik(''); setPengawasLoto('');
        pemicuToast(hasil.message || "Tersimpan", "ok");
      } else { pemicuToast(hasil.message || "Gagal menyimpan laporan!", "fail"); }
    } catch (err) { pemicuToast("Gagal menyimpan laporan kerusakan ke MySQL!", "fail"); }
  };

  const handleHapusLogPemeliharaan = async (idLog) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus arsip riwayat maintenance ini?")) {
      try {
        const hasil = await boxService.deleteMaintenance(idLog);
        if (hasil.success || hasil.status === 'success') {
          setLogPemeliharaan(logPemeliharaan.filter(log => log.id !== idLog));
          pemicuToast(hasil.message || "Terhapus", "ok");
        } else { pemicuToast(hasil.message, "fail"); }
      } catch (err) { pemicuToast("Gagal menghubungi server hapus log.", "fail"); }
    }
  };

  const handleHapusRiwayatTapping = async (idRiwayat, eventIds = [idRiwayat]) => {
    if (!window.confirm("Hapus sesi tapping ini secara permanen?")) return;
    try {
      const hasil = await logService.deleteTappingHistory(idRiwayat, eventIds);
      if (hasil.success || hasil.status === 'success') {
        setTappingHistory(prev => prev.filter(entry => !eventIds.includes(Number(entry.id))));
        pemicuToast(hasil.message || "Sesi Dihapus", "ok");
      } else { pemicuToast(hasil.message || "Gagal menghapus riwayat tapping.", "fail"); }
    } catch (err) { pemicuToast("Gagal terhubung ke server hapus riwayat.", "fail"); }
  };

  const handleHapusAudit = async (idLog) => {
    if (!window.confirm("Hapus log aktivitas ini secara permanen?")) return;
    try {
      const hasil = await logService.deleteLog(idLog);
      if (hasil.success || hasil.status === 'success') {
        setDeletedAuditIds(prev => [...prev, Number(idLog)]);
        setLocalAuditLog(prev => prev.filter(log => Number(log.id) !== Number(idLog)));
        pemicuToast(hasil.message || "Terhapus", "ok");
      } else { pemicuToast(hasil.message || "Gagal menghapus log aktivitas.", "fail"); }
    } catch (err) { pemicuToast("Gagal terhubung ke server hapus log.", "fail"); }
  };

  const triggerSimulasiExcel = (logItem) => {
    pemicuToast(" ⚡ Memproses Format Excel K3 + Injeksi Foto...", "ok");
    setTimeout(() => {
      const fotoContent = logItem.foto ? `<img src="${logItem.foto}" onerror="this.onerror=null;this.src='assets/default-avatar.png';" style="max-width:140px; max-height:100px; display:block; border:1px solid #cbd5e1;" />` : "Tidak Ada Lampiran Foto Bukti";
      const excelTemplate = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><style>table { border-collapse: collapse; font-family: 'Segoe UI', Arial, sans-serif; } th { background-color: #dc2626; color: white; font-weight: bold; font-size: 13px; text-align: center; padding: 12px; border: 1px solid #94a3b8; } td { padding: 8px; border: 1px solid #cbd5e1; font-size: 12px; vertical-align: middle; } .lbl-header { background-color: #f1f5f9; font-weight: bold; color: #334155; }</style></head>
        <body><table><thead><tr><th colspan="2">DOKUMEN MANIFES K3 INDUSTRI - EKSPOR LAPORAN LOTO</th></tr></thead>
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
        </tbody></table></body></html>`;
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
      const namaPersonel = terjemahkanIdKeNamaLengkapLocal(log.uid).replace(/,/g, "");
      return `${waktu},${log.event},${namaPersonel},"${(Number(log.lat) || 0).toFixed(4)}, ${(Number(log.lon || log.lng) || 0).toFixed(4)}"`;
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
    if (passwordConfirm !== 'Admin') { pemicuToast("Kata sandi salah!", "fail"); return; }
    pemicuToast("Mengirim sinyal buka paksa...", "ok");
    overrideLockoutRef.current = true;
    setHwData(prev => ({ ...prev, state: 'STATE_MAINTENANCE_DONE', queue: [], lcd0: 'OVERRIDE DARURAT', lcd1: 'ANTREAN BYPASS OK' }));
    setIsDowntimeTracking(false);
    if (selectedBox) localStorage.removeItem(`downtime_${selectedBox.id}`);
    pemicuToast(" 🚨 Antrean Berhasil Dikosongkan!", "ok");
    setTimeout(() => { overrideLockoutRef.current = false; }, 15000);
  };

  // ==================== DERIVED DATA ====================

  const isLiveTapPhotoVisible = isHwOnline &&
    !isSystemUidLocal(hwData.last_uid) &&
    ['STATE_SUPERVISOR_VALID', 'STATE_SPV_OUT_CONFIRM', 'STATE_MECHANIC_VALID', 'STATE_WORKER_DETAIL'].includes(hwData.state);

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

  const filteredBoxes = Array.isArray(boxes)
    ? boxes.filter(b =>
      String(b.id || '').toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
      String(b.unit || '').toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
      String(b.ip || '').toLowerCase().includes(boxSearchTerm.toLowerCase()) ||
      String(b.ssid || '').toLowerCase().includes(boxSearchTerm.toLowerCase())
    )
    : [];

  const rawLogs = (isHwOnline && hwData.audit_log && hwData.audit_log.length > 0) ? hwData.audit_log : localAuditLog;
  const logsYgDitampilkan = Array.isArray(rawLogs)
    ? rawLogs.filter(log => !deletedAuditIds.includes(Number(log.id)) && !['SYS_INIT', 'DB_READY', 'REG_BOX', 'DEL_BOX', 'USER_AUTH', 'SESSION_CLOSE', 'ADD_USER', 'DEL_USER', 'REPORT_SAVE', 'OVERRIDE_K3'].includes(log.event))
    : [];

  const filteredAuditLogs = logsYgDitampilkan.filter(log =>
    String(log.event || '').toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
    String(terjemahkanIdKeNamaLengkapLocal(log.uid) || '').toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
    String(log.uid || '').toLowerCase().includes(auditSearchTerm.toLowerCase())
  );

  const dataTappingProcessed = useMemo(() => {
    const results = [];
    const queueList = Array.isArray(hwData.queue) ? hwData.queue : [];
    const latestTappingByPerson = new Map();
    const formatWaktu = value => value ? new Date(String(value).replace(' ', 'T')).toLocaleTimeString('id-ID') : '—';
    if (Array.isArray(tappingHistory)) {
      tappingHistory.forEach((entry, index) => {
        const uid = String(entry.rfid_uid || entry.rfidUid || '').trim();
        const boxId = String(entry.id_box || entry.idBox || '').trim();
        if (!uid || isAdminUidLocal(uid)) return;
        const key = `${boxId.toLowerCase()}::${uid.toLowerCase()}`;
        if (!latestTappingByPerson.has(key)) {
          latestTappingByPerson.set(key, { entry, uid, boxId, eventType: String(entry.event_type || entry.eventType || '').toUpperCase(), index });
        }
      });
      latestTappingByPerson.forEach(({ entry, uid, eventType, index }) => {
        const isOut = eventType === 'OUT';
        const isIn = eventType === 'IN' && isHwOnline;
        results.push({
          id: `history-row-${entry.id || index}-${uid}`, uid, nama: entry.nama || getUserProfileLocal(uid).nama,
          foto: getUserProfileLocal(uid).foto, status: isOut ? 'SUDAH KELUAR' : (isIn ? 'SESI AKTIF' : (entry.event_text || 'TERCATAT')),
          badgeColor: isOut ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-green-50 text-green-700 border-green-200',
          waktuMasuk: isIn ? formatWaktu(entry.created_at) : '—', waktuKeluar: isOut ? formatWaktu(entry.created_at) : '— (Sedang di Dalam)', isInside: isIn
        });
      });
    }
    queueList.forEach((qItem, idx) => {
      const uid = typeof qItem === 'string' ? qItem : (qItem.uid || qItem.last_uid || '');
      if (isAdminUidLocal(uid)) return;
      const boxId = String(selectedBox?.id || hwData.id_box || '').toLowerCase();
      const tappingKey = `${boxId}::${String(uid).toLowerCase()}`;
      if (latestTappingByPerson.get(tappingKey)?.eventType === 'OUT') return;
      const isSpv = (uid === hwData.supervisor_uid) || (idx === 0 && hwData.state !== 'STATE_IDLE' && hwData.state !== 'STATE_REGISTER_RFID');
      results.push({
        id: `active-${uid}-${idx}`, uid, nama: getUserProfileLocal(uid).nama, foto: getUserProfileLocal(uid).foto,
        status: isSpv ? 'PENGAWAS (IN)' : 'MEKANIK (IN)',
        badgeColor: isSpv ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-green-50 text-green-700 border-green-200',
        waktuMasuk: new Date(Date.now() - (queueList.length - idx) * 45000).toLocaleTimeString('id-ID'), waktuKeluar: '— (Sedang di Dalam)', isInside: true
      });
    });
    if (hwData.active_fuelman && hwData.active_fuelman !== '' && !isAdminUidLocal(hwData.active_fuelman)) {
      results.push({
        id: 'fuelman-active', uid: hwData.active_fuelman, nama: getUserProfileLocal(hwData.active_fuelman).nama,
        foto: getUserProfileLocal(hwData.active_fuelman).foto, status: 'PENGISIAN BBM',
        badgeColor: 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse',
        waktuMasuk: new Date(Date.now() - 120000).toLocaleTimeString('id-ID'), waktuKeluar: '— (Sedang di Lokasi)', isInside: true
      });
    }
    logsYgDitampilkan.forEach((l, i) => {
      const eventLower = String(l.event || '').toLowerCase();
      const isValidTappingEvent = /^(supervisor_lock_in|supervisor_log_out|mechanic_log_in|mechanic_log_out|refuel_start|refuel_end)$/i.test(String(l.event || '').trim());
      if (!isValidTappingEvent || isAdminUidLocal(l.uid)) return;
      const isOut = eventLower.includes('out') || eventLower.includes('keluar');
      const isIn = eventLower.includes('in') || eventLower.includes('masuk');
      const tLog = l.ts ? new Date(Number(l.ts)).toLocaleTimeString('id-ID') : new Date().toLocaleTimeString('id-ID');
      if (!results.some(r => r.uid === l.uid && r.isInside)) {
        results.push({
          id: `history-${l.id || i}-${l.uid}`, uid: l.uid, nama: getUserProfileLocal(l.uid).nama,
          foto: getUserProfileLocal(l.uid).foto, status: isOut ? 'KELUAR (OUT) - SELESAI' : (isIn ? 'SUDAH KELUAR' : l.event),
          badgeColor: isOut ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-red-50 text-red-600 border-red-200',
          waktuMasuk: isIn ? tLog : '—', waktuKeluar: isOut ? tLog : 'Selesai', isInside: false
        });
      }
    });
    return results;
  }, [hwData.queue, hwData.active_fuelman, hwData.supervisor_uid, logsYgDitampilkan, tappingHistory, userDatabase]);

  const filteredTappingData = dataTappingProcessed.filter(row =>
    row.nama.toLowerCase().includes(tappingSearchTerm.toLowerCase()) || row.uid.toLowerCase().includes(tappingSearchTerm.toLowerCase()) || row.status.toLowerCase().includes(tappingSearchTerm.toLowerCase())
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
      const eventIds = rawHistory.filter(item => String(item.id_box || item.idBox || 'Universal Box').trim().toLowerCase() === boxId.toLowerCase() && String(item.rfid_uid || item.rfidUid || '').trim().toLowerCase() === uid.toLowerCase()).map(item => Number(item.id)).filter(Number.isInteger);
      rows.push({
        id: `session-${entry.id || index}`, deleteId: entry.id, deleteIds: eventIds, id_box: boxId,
        sessionDate: String(eventTime || '').slice(0, 10) || 'tanpa-tanggal',
        sessionStart: eventType === 'IN' ? eventTime : null,
        sessionEnd: eventType === 'OUT' || (eventType === 'IN' && !isHwOnline) ? eventTime : null,
        participants: [{ uid, nama: entry.nama || getUserProfileLocal(uid).nama, status: eventType === 'OUT' || !isHwOnline ? 'KELUAR' : 'MASUK' }],
        totalPersonel: 1, eventText: entry.event_text || `TAPPING_${eventType || 'CHECK'}`
      });
    });
    const liveParticipants = (Array.isArray(hwData.queue) ? hwData.queue : []).map(item => ({
      uid: typeof item === 'string' ? item : (item.uid || ''),
      nama: typeof item === 'string' ? terjemahkanIdKeNamaLengkapLocal(item) : (item.name || terjemahkanIdKeNamaLengkapLocal(item.uid)),
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
          id: `live-session-${selectedBox.id}`, deleteId: null, deleteIds: [], id_box: selectedBox.id,
          sessionDate: new Date().toISOString().slice(0, 10), sessionStart: new Date().toISOString(), sessionEnd: null,
          participants: liveParticipants, totalPersonel: liveParticipants.length, eventText: 'SESI AKTIF DARI PERANGKAT'
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

  const totalOrangMasukOtomatis = useMemo(() => {
    let count = 0;
    if (Array.isArray(hwData.queue)) count += hwData.queue.filter(item => !isAdminUidLocal(typeof item === 'string' ? item : item.uid)).length;
    if (hwData.active_fuelman && hwData.active_fuelman !== '' && !isAdminUidLocal(hwData.active_fuelman)) count += 1;
    return count;
  }, [hwData.queue, hwData.active_fuelman]);

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

  const value = {
    // State
    isLoggedIn, sessionUser, activeTab, setActiveTab,
    boxes, setBoxes, selectedBox, setSelectedBox,
    isHwOnline, hwData,
    userDatabase, setUserDatabase,
    logPemeliharaan, setLogPemeliharaan,
    rfidBufferList, setRfidBufferList,
    tappingHistory, setTappingHistory,
    localAuditLog, setLocalAuditLog,
    deletedAuditIds, setDeletedAuditIds,
    downtimeSeconds, isTrackingDowntime,
    photoBase64, setPhotoBase64, cropPhotoSrc, setCropPhotoSrc,
    isSyncing, printActiveLog, setPrintActiveLog,
    subTabMaintenance, setSubTabMaintenance, subTabAdmin, setSubTabAdmin,
    toast, modalInfo, setModalInfo,
    showRadarModal, setShowRadarModal, radarModalSearch, setRadarModalSearch,
    radarDetailBox, setRadarDetailBox,
    // Form states
    formData, setFormData, formDeskripsi, setFormDeskripsi,
    tipeKerusakan, setTipeKerusakan, estimasiWaktu, setEstimasiWaktu,
    showAddUserForm, setShowAddUserForm,
    formAlatBerat, setFormAlatBerat, editingBoxId, setEditingBoxId,
    formAdminNewUser, setFormAdminNewUser,
    showEditUserModal, setShowEditUserModal,
    formEditUser, setFormEditUser,
    manualMekanik, setManualMekanik, pengawasLoto, setPengawasLoto,
    selectedMechanicSids, setSelectedMechanicSids,
    teamBoxId, setTeamBoxId, teamMaintenanceType, setTeamMaintenanceType,
    // Search terms
    boxSearchTerm, setBoxSearchTerm, adminSearchTerm, setAdminSearchTerm,
    mechanicSearchTerm, setMechanicSearchTerm, tappingSearchTerm, setTappingSearchTerm,
    auditSearchTerm, setAuditSearchTerm, maintenanceSearchTerm, setMaintenanceSearchTerm,
    maintenanceTypeFilter, setMaintenanceTypeFilter,
    // Refs
    mapContainerRef, leafletMapInstanceRef, markersRef, geoAddressCacheRef,
    lastCenteredBoxIdRef, excelFileInputRef,
    // Derived data
    filteredUsers, groupPengawas, groupTeknisi, groupFuelman, groupAdmin,
    filteredTeamMechanics, filteredBoxes,
    logsYgDitampilkan, filteredAuditLogs,
    dataTappingProcessed, filteredTappingData,
    sessionHistoryRows, filteredSessionHistory,
    totalOrangMasukOtomatis, filteredMaintenanceLogs,
    isLiveTapPhotoVisible,
    // Helper functions
    pemicuToast, bukaModalUmum, bukaModalRadar,
    getUserProfile: getUserProfileLocal, isSystemUid: isSystemUidLocal,
    isAdminUid: isAdminUidLocal, terjemahkanIdKeNamaLengkap: terjemahkanIdKeNamaLengkapLocal,
    handleProfilePhotoUpload, handleConfirmProfileCrop, handleCancelProfileCrop,
    handleCaptureKamera,
    // Action handlers
    handleSelectBox, handleTambahAlatBerat, handleEditAlatBerat,
    handleBatalEditAlatBerat, handleHapusAlatBerat, handleAutoGps,
    dapatkanMekanikDariAntreanLoto, dapatkanPengawasDariLoto,
    handleSaveMechanicTeam, handleIndukTambahUser, handleImportExcel,
    handleBukaModalEditUser, handleSimpanEditUser, handleHapusUser,
    handleHapusBuffer, handleSimpanKerusakan,
    handleHapusLogPemeliharaan, handleHapusRiwayatTapping, handleHapusAudit,
    triggerSimulasiExcel, exportAuditTrailToCSV, triggerEmergencyOverride
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
}
