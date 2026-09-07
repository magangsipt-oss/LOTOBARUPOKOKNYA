import React, { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../context/AppContext';
import Avatar from '../components/Avatar';
import BoxCard from '../components/BoxCard';
import { STATE_DESC, formatWaktuDowntime, safeToFixed, resolveUserPhotoUrl, getInitialAvatar } from '../utils/helpers';

/**
 * Halaman Dashboard - Peta, Box Cards, Telemetri
 */
export default function Dashboard() {
  const {
    isLoggedIn, activeTab, sessionUser,
    boxes, selectedBox, isHwOnline, hwData,
    downtimeSeconds, isTrackingDowntime,
    boxSearchTerm, setBoxSearchTerm,
    filteredBoxes, filteredSessionHistory,
    totalOrangMasukOtomatis,
    mapContainerRef, leafletMapInstanceRef, markersRef,
    geoAddressCacheRef, lastCenteredBoxIdRef,
    formAlatBerat, setFormAlatBerat, editingBoxId,
    isSyncing,
    getUserProfile, isSystemUid, isAdminUid,
    terjemahkanIdKeNamaLengkap,
    handleSelectBox, handleTambahAlatBerat, handleEditAlatBerat,
    handleBatalEditAlatBerat, handleHapusAlatBerat, handleAutoGps,
    bukaModalUmum, bukaModalRadar, triggerEmergencyOverride,
    handleHapusRiwayatTapping,
    peopleCount, peopleCountHistory,
    pemicuToast
  } = useApp();

  const isLiveTapPhotoVisible = isHwOnline &&
    !isSystemUid(hwData.last_uid) &&
    ['STATE_SUPERVISOR_VALID', 'STATE_SPV_OUT_CONFIRM', 'STATE_MECHANIC_VALID', 'STATE_WORKER_DETAIL'].includes(hwData.state);

  // INITIALISASI MAP LEAFLET
  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'dashboard' || !mapContainerRef.current) {
      if (leafletMapInstanceRef.current) {
        try { leafletMapInstanceRef.current.remove(); } catch (e) {}
        leafletMapInstanceRef.current = null;
        markersRef.current = {};
        lastCenteredBoxIdRef.current = null;
      }
      return;
    }

    const mapLat = (selectedBox && !isNaN(Number(selectedBox.lat)) && Number(selectedBox.lat) !== 0) ? Number(selectedBox.lat) : 2.144691;
    const mapLng = (selectedBox && !isNaN(Number(selectedBox.lng)) && Number(selectedBox.lng) !== 0) ? Number(selectedBox.lng) : 117.477526;

    // Guard: skip if coordinates are still invalid
    if (isNaN(mapLat) || isNaN(mapLng) || mapLat === 0 || mapLng === 0) return;

    if (!leafletMapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, { center: [mapLat, mapLng], zoom: 13, zoomControl: true });
      leafletMapInstanceRef.current = map;
      L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: 'Google Satellite Hybrid' }).addTo(map);
      map.on('click', function (e) {
        if (e.originalEvent.target.closest('.custom-gps-marker') || e.originalEvent.target.closest('.leaflet-popup') || e.originalEvent.target.closest('.leaflet-tooltip')) return;
        map.closePopup();
        map.flyTo([2.144691, 117.477526], 13, { animate: true, duration: 1.2 });
      });
      map.on('zoomend', function () { if (map.getZoom() < 16) map.closePopup(); });
    }

    const t1 = setTimeout(() => { if (leafletMapInstanceRef.current) leafletMapInstanceRef.current.invalidateSize(); }, 200);
    const t2 = setTimeout(() => { if (leafletMapInstanceRef.current) leafletMapInstanceRef.current.invalidateSize(); }, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
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
      if (!isFinite(bLat) || !isFinite(bLng)) return;
      currentMarkerKeys.add(box.id);
      const isBoxLocked = box.state && box.state !== 'STATE_IDLE' && box.state !== 'STATE_REGISTER_RFID';
      const markerColor = isBoxLocked ? '#ef4444' : (box.state === 'STATE_REGISTER_RFID' ? '#2563eb' : '#22c55e');
      const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: `<svg width="30" height="42" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 32 12 32C12 32 24 21 24 12C24 5.37 18.63 0 12 0ZM12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16Z" fill="${markerColor}"/></svg>`,
        iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -40]
      });
      const renderPopupContent = (bId, bUnit, bState, lat, lng) => {
        const cacheKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
        const addressText = geoAddressCacheRef.current[cacheKey];
        let locationHtml = `<div id="geo-${bId}" class="text-[10px] text-slate-600 mt-1 font-mono"><i class="fa-solid fa-location-crosshairs text-red-500"></i> Koordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
        if (addressText) locationHtml = `<div id="geo-${bId}" class="text-[10px] text-slate-700 font-semibold mt-1"><i class="fa-solid fa-map-pin text-red-500"></i> ${addressText}</div>`;
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
          .bindTooltip(`${box.id} - ${box.unit}`, { permanent: true, direction: 'top', offset: [0, -42], className: 'box-permanent-label' });
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
                if (container) container.innerHTML = `<i class="fa-solid fa-map-pin text-red-500"></i> ${namaLokasiLengkap}`;
              })
              .catch(() => { geoAddressCacheRef.current[cacheKey] = `GPS: ${bLat.toFixed(4)}, ${bLng.toFixed(4)}`; });
          }
        });
        marker.on('click', function () { handleSelectBox(box); });
        markersRef.current[box.id] = marker;
      }
    });

    Object.keys(markersRef.current).forEach(id => {
      if (!currentMarkerKeys.has(id)) { try { markersRef.current[id].remove(); } catch (e) {} delete markersRef.current[id]; }
    });

    if (selectedBox) {
      const mapLat = !isNaN(Number(selectedBox.lat)) && Number(selectedBox.lat) !== 0 ? Number(selectedBox.lat) : 2.144691;
      const mapLng = !isNaN(Number(selectedBox.lng)) && Number(selectedBox.lng) !== 0 ? Number(selectedBox.lng) : 117.477526;
      if (!isFinite(mapLat) || !isFinite(mapLng)) return;
      const centerNow = map.getCenter();
      const distMoved = Math.abs(centerNow.lat - mapLat) + Math.abs(centerNow.lng - mapLng);
      if (lastCenteredBoxIdRef.current !== selectedBox.id || distMoved > 0.0001) {
        map.flyTo([mapLat, mapLng], 18, { animate: true, duration: 1.2 });
        setTimeout(() => { if (markersRef.current && markersRef.current[selectedBox.id]) markersRef.current[selectedBox.id].openPopup(); }, 500);
        lastCenteredBoxIdRef.current = selectedBox.id;
      }
    }
  }, [boxes, selectedBox?.id, activeTab]);

  if (activeTab !== 'dashboard' || !(sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas')) return null;

  return (
    <div className="space-y-6">
      {/* 5 KARTU METRIK */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div onClick={() => bukaModalUmum('Waktu Penguncian & Downtime Operasional', 'fa-stopwatch', <div className="overflow-x-auto border border-gray-200 rounded-xl"><table className="w-full text-left border-collapse text-xs font-mono-tech"><thead><tr className="bg-gray-100 text-slate-800 border-b border-gray-200"><th className="p-3 w-1/3 border-r border-gray-200">Parameter</th><th className="p-3">Keterangan</th></tr></thead><tbody className="divide-y divide-gray-100"><tr><td className="p-3 bg-gray-50 font-bold border-r">Unit Terfokus</td><td className="p-3 font-bold text-red-600">{selectedBox ? `${selectedBox.id} (${selectedBox.unit})` : '—'}</td></tr><tr><td className="p-3 bg-gray-50 font-bold border-r">Durasi Penguncian</td><td className="p-3 font-bold text-amber-600 text-sm">{formatWaktuDowntime(downtimeSeconds)} ({downtimeSeconds} detik)</td></tr><tr><td className="p-3 bg-gray-50 font-bold border-r">Status Timer</td><td className="p-3">{isTrackingDowntime ? <span className="text-amber-600 font-bold">Sedang Berjalan (Terkunci)</span> : <span className="text-green-600 font-bold">Standby (Nol)</span>}</td></tr></tbody></table></div>)} className="bg-white border border-red-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
          <div><p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Waktu Kunci <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p><h3 className={`text-lg font-black font-mono-tech mt-1 ${isTrackingDowntime ? 'text-amber-600 animate-pulse' : 'text-slate-500'}`}>{formatWaktuDowntime(downtimeSeconds)}</h3></div>
          <i className="fa-solid fa-stopwatch text-lg text-slate-400"></i>
        </div>
        <div onClick={() => bukaModalUmum('Daftar Seluruh Unit Boks', 'fa-boxes-stacked', <div className="space-y-3"><div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border"><span className="font-bold text-slate-700">Total: {boxes.length} Boks Terdaftar</span></div><div className="overflow-x-auto border border-gray-200 rounded-xl max-h-72 overflow-y-auto"><table className="w-full text-left border-collapse text-xs font-mono-tech"><thead><tr className="bg-gray-100 text-slate-800 border-b border-gray-200"><th className="p-3">ID Box</th><th className="p-3">Nama Alat / Mesin</th><th className="p-3">IP Address</th><th className="p-3 text-center">Status</th><th className="p-3 text-right">Pilih</th></tr></thead><tbody className="divide-y divide-gray-100">{boxes.map(b => (<tr key={b.id} className="hover:bg-red-50/50"><td className="p-3 font-bold text-red-600">{b.id}</td><td className="p-3 font-sans font-semibold text-slate-900">{b.unit}</td><td className="p-3 text-blue-600">{b.ip || '192.168.1.100'}</td><td className="p-3 text-center"><span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${Number(b.is_online) === 1 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{Number(b.is_online) === 1 ? 'ONLINE' : 'OFFLINE'}</span></td><td className="p-3 text-right"><button type="button" onClick={() => { handleSelectBox(b); }} className="bg-red-600 text-white px-3 py-1 rounded text-[10px] font-bold">Fokus</button></td></tr>))}</tbody></table></div></div>)} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
          <div><p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Total Boks <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p><h3 className="text-lg font-black font-mono-tech mt-1 text-slate-900">{boxes.length} Unit</h3></div>
          <i className="fa-solid fa-boxes-stacked text-lg text-slate-400"></i>
        </div>
        <div onClick={() => bukaModalUmum('Daftar Boks Yang Sedang Terkunci', 'fa-lock', <div className="overflow-x-auto border border-gray-200 rounded-xl"><table className="w-full text-left border-collapse text-xs font-mono-tech"><thead><tr className="bg-gray-100 text-slate-800 border-b border-gray-200"><th className="p-3">ID Box & Unit</th><th className="p-3">Status Kerja</th><th className="p-3 text-center">Relay Kunci</th><th className="p-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-gray-100">{boxes.filter(b => b.state && b.state !== 'STATE_IDLE' && b.state !== 'STATE_REGISTER_RFID').length > 0 ? (boxes.filter(b => b.state && b.state !== 'STATE_IDLE' && b.state !== 'STATE_REGISTER_RFID').map(b => (<tr key={b.id} className="hover:bg-red-50/50"><td className="p-3"><span className="font-bold text-red-600">{b.id}</span><span className="block text-[11px] text-slate-500 font-sans">{b.unit}</span></td><td className="p-3 font-bold text-slate-800">{b.state}</td><td className="p-3 text-center"><span className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded text-[10px] font-bold">TERKUNCI</span></td><td className="p-3 text-right"><button type="button" onClick={() => { handleSelectBox(b); }} className="bg-red-600 text-white px-3 py-1 rounded text-[10px] font-bold">Lihat di Peta</button></td></tr>))) : (<tr><td colSpan="4" className="text-center py-8 text-slate-400 italic font-sans">Tidak ada boks yang sedang terkunci saat ini.</td></tr>)}</tbody></table></div>)} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
          <div><p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Boks Terkunci <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p><h3 className="text-lg font-black font-mono-tech mt-1 text-red-600">{boxes.filter(b => b.state && b.state !== 'STATE_IDLE' && b.state !== 'STATE_REGISTER_RFID').length} Unit</h3></div>
          <i className="fa-solid fa-lock text-lg text-red-400"></i>
        </div>
        <div onClick={bukaModalRadar} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
          <div><p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">Status Radar <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p><h3 className={`text-lg font-black font-mono-tech mt-1 ${isHwOnline ? 'text-green-600' : 'text-red-600'}`}>{isHwOnline ? "1 Aktif" : "0 Standby"}</h3></div>
          <i className={`fa-solid fa-satellite-dish text-lg ${isHwOnline ? 'text-green-400' : 'text-red-400'}`}></i>
        </div>
        <div onClick={() => bukaModalUmum("Data Pindaian Kartu & Petugas Masuk", "fa-id-card-clip", null)} className="bg-red-50 border-2 border-red-300 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-red-100 hover:border-red-600 hover:shadow-md transition-all active:scale-[0.98]">
          <div><p className="text-[9px] text-red-700 font-bold uppercase tracking-wider flex items-center gap-1">Data Pindaian <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-red-500"></i></p><h3 className="text-lg font-black font-mono-tech mt-1 text-red-700">{totalOrangMasukOtomatis} Petugas</h3></div>
          <i className="fa-solid fa-id-card-clip text-lg text-red-600"></i>
        </div>

        {/* PEOPLE COUNTING CARD */}
        <div onClick={() => {
          const historyHtml = peopleCountHistory.length > 0
            ? `<div class="overflow-x-auto border border-gray-200 rounded-xl max-h-64 overflow-y-auto"><table class="w-full text-left border-collapse text-xs font-mono-tech"><thead class="bg-gray-100 text-slate-800 border-b border-gray-200"><tr><th class="p-2">Waktu</th><th class="p-2 text-center">Detected</th><th class="p-2 text-center">Registered</th><th class="p-2 text-center">Status</th></tr></thead><tbody class="divide-y divide-gray-100">${peopleCountHistory.map(h => {
              const match = h.detected_count === h.registered_count;
              const diff = h.detected_count - h.registered_count;
              const statusClass = match ? 'text-green-600 bg-green-50' : (diff > 0 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50');
              const statusText = match ? 'SESUAI' : (diff > 0 ? `+${diff} EXTRA` : `${diff} KURANG`);
              return `<tr class="hover:bg-red-50/50"><td class="p-2">${new Date(h.created_at).toLocaleTimeString('id-ID')}</td><td class="p-2 text-center font-bold">${h.detected_count}</td><td class="p-2 text-center">${h.registered_count}</td><td class="p-2 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-bold border ${statusClass}">${statusText}</span></td></tr>`;
            }).join('')}</tbody></table></div>`
            : '<div class="text-center py-6 text-slate-400 italic">Belum ada data counting</div>';

          const diff = peopleCount.detected_count - peopleCount.registered_count;
          const statusColor = diff === 0 ? 'text-green-600' : (diff > 0 ? 'text-amber-600' : 'text-red-600');
          const statusText = diff === 0 ? 'SESUAI' : (diff > 0 ? `+${diff} EXTRA PERSON` : `${diff} KURANG`);

          bukaModalUmum('People Counting - Realtime Monitor', 'fa-users', `
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div class="bg-green-50 border border-green-200 p-3 rounded-xl text-center">
                  <p class="text-[10px] text-green-700 font-bold uppercase">Detected (Camera)</p>
                  <p class="text-3xl font-black text-green-600 font-mono-tech">${peopleCount.detected_count}</p>
                </div>
                <div class="bg-blue-50 border border-blue-200 p-3 rounded-xl text-center">
                  <p class="text-[10px] text-blue-700 font-bold uppercase">Registered (RFID)</p>
                  <p class="text-3xl font-black text-blue-600 font-mono-tech">${peopleCount.registered_count}</p>
                </div>
              </div>
              <div class="text-center p-2 rounded-xl border ${diff === 0 ? 'bg-green-50 border-green-200' : (diff > 0 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200')}">
                <p class="text-sm font-bold ${statusColor}">${statusText}</p>
              </div>
              <p class="text-[10px] text-slate-500 font-bold uppercase">Riwayat Counting:</p>
              ${historyHtml}
            </div>
          `);
        }} className="bg-white border border-gray-200 p-3.5 rounded-xl flex items-center justify-between shadow-sm cursor-pointer hover:border-red-500 hover:shadow-md transition-all active:scale-[0.98]">
          <div>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">People Counting <i className="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-400"></i></p>
            <h3 className="text-lg font-black font-mono-tech mt-1">
              <span className="text-green-600">{peopleCount.detected_count}</span>
              <span className="text-slate-400 mx-1">/</span>
              <span className="text-blue-600">{peopleCount.registered_count}</span>
            </h3>
            <p className="text-[9px] text-slate-400">Detected / Registered</p>
          </div>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${peopleCount.detected_count === peopleCount.registered_count ? 'bg-green-100' : 'bg-amber-100'}`}>
            <i className={`fa-solid fa-video text-lg ${peopleCount.detected_count === peopleCount.registered_count ? 'text-green-600' : 'text-amber-600'}`}></i>
          </div>
        </div>
      </div>

      {/* RADAR TARGET BAR */}
      <div className="bg-white border border-red-200 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm text-xs font-mono-tech">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isHwOnline ? 'bg-green-500 shadow-[0_0_10px_#22e07a]' : 'bg-red-500 shadow-[0_0_10px_#ff5b5b]'}`} />
          <div>
            <span className="text-slate-500 font-bold">RADAR TARGET: </span>
            <span className="text-slate-950 font-black">{selectedBox ? `${selectedBox.id} (${selectedBox.unit})` : 'Belum Ada Boks'}</span>
            <span className="ml-2 text-blue-600 font-bold">[<i className="fa-solid fa-wifi text-[10px] mr-1"></i>SSID: {isHwOnline ? (selectedBox?.ssid || hwData.ssid || 'Wi-Fi Hotspot') : 'OFFLINE'}]</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest ${isHwOnline ? 'bg-green-50 text-green-700 border border-green-300' : 'bg-red-50 text-red-600 border border-red-200'}`}>{isHwOnline ? 'RADAR ONLINE' : 'RADAR OFFLINE'}</span>
        </div>
      </div>

      {/* PETA SATELIT & MONITORING */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-2 font-mono-tech"><i className="fa-solid fa-map-location-dot"></i> Peta Lokasi Alat Berat (Satelit)</div>
            <div ref={mapContainerRef} className="w-full h-[240px] sm:h-[350px] rounded-2xl border border-red-200 shadow-lg z-10" style={{ background: '#e5e7eb', minHeight: '240px' }} />
          </div>

          {/* CCTV LIVE FEED */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-red-600 flex items-center gap-2 font-mono-tech">
              <i className="fa-solid fa-video"></i> CCTV Live Feed
              {selectedBox && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold">{selectedBox.id}</span>}
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold">LIVE</span>
            </div>
            <div className="relative rounded-2xl border border-red-200 shadow-lg overflow-hidden bg-black" style={{ minHeight: '200px' }}>
              {selectedBox ? (
                <img
                  key={selectedBox.id}
                  src={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5002'}/api/stream/${encodeURIComponent(selectedBox.id)}`}
                  alt={`CCTV ${selectedBox.id}`}
                  className="w-full h-auto max-h-[360px] object-contain"
                  onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                />
              ) : null}
              <div className={`${selectedBox ? 'hidden' : 'flex'} absolute inset-0 items-center justify-center bg-slate-900 text-slate-400 flex-col gap-2`}>
                <i className="fa-solid fa-video-slash text-3xl"></i>
                <p className="text-xs">{selectedBox ? 'RTSP belum dikonfigurasi' : 'Pilih boks terlebih dahulu'}</p>
                <p className="text-[10px] text-slate-500">
                  {selectedBox ? 'Atur RTSP URL di form edit boks' : 'Klik boks di daftar untuk melihat CCTV'}
                </p>
              </div>
            </div>
          </div>

          {/* LCD & STATUS KERJA */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div onClick={() => bukaModalUmum('Tampilan Layar LCD Fisik di Alat', 'fa-tv', <div className="bg-black text-green-400 p-5 rounded-2xl border-2 border-green-800 text-base font-black shadow-inner font-mono-tech"><div className="flex items-center gap-4">{isLiveTapPhotoVisible && <img src={resolveUserPhotoUrl(getUserProfile(hwData.last_uid), getUserProfile(hwData.last_uid).foto)} alt={`Foto ${getUserProfile(hwData.last_uid).nama}`} className="w-20 h-20 rounded-lg object-cover border border-green-700 bg-green-950 shrink-0" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getInitialAvatar(getUserProfile(hwData.last_uid).nama); }} />}<div className="min-w-0 space-y-1.5"><p className="truncate">[BARIS 1]: {hwData.lcd0}</p><p className="truncate">[BARIS 2]: {hwData.lcd1}</p><p className="truncate text-sm text-green-300">{isHwOnline ? getUserProfile(hwData.last_uid).nama : 'Tidak ada data alat'}</p></div></div></div>)} className="bg-[#06140a] border-2 border-[#16271a] rounded-xl p-4 shadow-inner relative font-mono-tech text-sm sm:text-base text-[#27ff84] [text-shadow:0_0_8px_rgba(39,255,132,0.6)] cursor-pointer hover:border-green-600 transition-all min-h-[90px] flex flex-col justify-center">
              <div className="absolute inset-0 pointer-events-none rounded-xl opacity-10 bg-repeat" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,1) 50%, transparent 50%)', backgroundSize: '100% 4px' }} />
              <div className="relative z-[1] flex items-center gap-3">
                {isLiveTapPhotoVisible && <img src={resolveUserPhotoUrl(getUserProfile(hwData.last_uid), getUserProfile(hwData.last_uid).foto)} alt={`Foto ${getUserProfile(hwData.last_uid).nama}`} className="w-14 h-14 rounded-md object-cover border border-green-700 bg-green-950 shrink-0" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getInitialAvatar(getUserProfile(hwData.last_uid).nama); }} />}
                <div className="min-w-0">
                  <div className="min-h-[24px] flex items-center break-words whitespace-normal leading-relaxed font-bold">{isHwOnline ? hwData.lcd0 : '— ALAT TERPUTUS —'}</div>
                  <div className="min-h-[24px] flex items-center mt-1 text-xs sm:text-sm text-[#10b981]">{isHwOnline ? hwData.lcd1 : '— CLOUD TERSINKRON —'}</div>
                  <div className="truncate text-[10px] text-green-300">{isLiveTapPhotoVisible ? getUserProfile(hwData.last_uid).nama : 'Belum ada tapping aktif'}</div>
                </div>
              </div>
            </div>

            <div onClick={() => bukaModalUmum('Tahapan Status Penguncian Sistem', 'fa-diagram-project', <div className="overflow-x-auto border border-gray-200 rounded-xl font-mono-tech text-xs"><table className="w-full text-left border-collapse"><tbody><tr><td className="p-3 bg-gray-50 font-bold border-r w-1/3">Status Saat Ini</td><td className="p-3 font-bold text-red-600">{hwData.state}</td></tr><tr><td className="p-3 bg-gray-50 font-bold border-r">Petunjuk Prosedur</td><td className="p-3 font-sans text-slate-700">{STATE_DESC[hwData.state] || 'Standby'}</td></tr></tbody></table></div>)} className="bg-white border border-gray-200 p-4 rounded-xl flex flex-col justify-center shadow-sm cursor-pointer hover:border-red-400 transition-all">
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
                if (Array.isArray(hwData.queue)) queueList = hwData.queue;
                else if (typeof hwData.queue === 'string' && hwData.queue.trim() !== '') { try { queueList = JSON.parse(hwData.queue); } catch (e) { queueList = []; } }
                queueList = queueList.filter(item => !isAdminUid(typeof item === 'string' ? item : (item.uid || item.last_uid || '')));
                const hasActiveFuelman = hwData.active_fuelman && hwData.active_fuelman !== '';
                if (isHwOnline && (queueList.length > 0 || hasActiveFuelman)) {
                  return (<React.Fragment>{queueList.map((item, i) => {
                    const uidKartu = typeof item === 'string' ? item : (item.uid || item.last_uid || '');
                    const roleMetode = typeof item === 'object' ? item.role : '';
                    const isSpv = roleMetode === 'spv' || roleMetode === 'pengawas' || (uidKartu === hwData.supervisor_uid) || (i === 0 && hwData.state !== 'STATE_IDLE' && hwData.state !== 'STATE_REGISTER_RFID');
                    const profile = getUserProfile(uidKartu);
                    const namaPersonel = profile.nama;
                    return (<div key={i} onClick={() => bukaModalUmum(`Data Petugas #${i + 1}`, isSpv ? "fa-heart" : "fa-wrench", <div className="p-3 font-mono text-xs">{namaPersonel} ({uidKartu}) - {isSpv ? 'Pengawas' : 'Mekanik'}</div>)} className="flex items-center gap-1.5 font-mono-tech text-xs cursor-pointer hover:scale-105 transition-transform">
                      {i > 0 && <span className="text-slate-400 font-bold">→</span>}
                      <span className={`px-2.5 py-1 rounded-lg border flex items-center gap-1.5 shadow-sm transition-all max-w-[230px] ${isSpv ? 'border-blue-300 bg-blue-50 text-blue-700 font-bold' : 'border-slate-300 bg-white text-slate-800 shadow-sm'}`}>
                        <Avatar profile={profile} className="w-8 h-8" />
                        <span className="flex min-w-0 flex-col leading-tight text-left"><span className="truncate">{namaPersonel}</span><span className="text-[9px] text-slate-500 font-normal truncate">{isSpv ? 'PENGAWAS K3' : 'MEKANIK'} · {i === queueList.length - 1 ? 'TOP' : `#${i + 1}`}</span></span>
                      </span>
                    </div>);
                  })}{hasActiveFuelman && (<div onClick={() => bukaModalUmum("Status Petugas Pengisian BBM (Fuelman)", "fa-gas-pump", <div className="p-3 font-mono text-xs">{getUserProfile(hwData.active_fuelman).nama}</div>)} className="flex items-center gap-2 font-mono-tech text-xs ml-1 cursor-pointer hover:scale-105 transition-transform">
                    {queueList.length > 0 && <span className="text-slate-400 font-bold">|</span>}
                    <span className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-bold flex items-center gap-1.5 shadow-sm animate-pulse">
                      <Avatar profile={getUserProfile(hwData.active_fuelman)} className="w-7 h-7" />
                      <span>[BBM] {getUserProfile(hwData.active_fuelman).nama}</span>
                    </span>
                  </div>)}</React.Fragment>);
                }
                return <span className="text-xs text-slate-500 font-mono-tech italic">Antrean kosong — Belum ada gembok terpasang di lapangan.</span>;
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
                <input type="text" required disabled={Boolean(editingBoxId)} placeholder="ID Boks (Contoh: BOX ELOTO 1)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none disabled:bg-gray-100 disabled:text-slate-500" value={formAlatBerat.id} onChange={(e) => setFormAlatBerat({ ...formAlatBerat, id: e.target.value })} />
                <input type="text" required placeholder="Nama Alat / Mesin (Contoh: HD-785 DUMP TRUCK)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none" value={formAlatBerat.unit} onChange={(e) => setFormAlatBerat({ ...formAlatBerat, unit: e.target.value })} />
                <div className="flex gap-2">
                  <input type="text" required placeholder="IP Address ESP32 (192.168.1.100)" className="flex-1 bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900 text-[11px]" value={formAlatBerat.ip} onChange={(e) => setFormAlatBerat({ ...formAlatBerat, ip: e.target.value })} />
                  <button type="button" onClick={handleAutoGps} disabled={isSyncing} className="bg-red-600 hover:bg-red-700 text-white px-4 rounded-lg font-bold text-xs shadow-sm flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap">
                    <i className={`fa-solid ${isSyncing ? 'fa-spinner animate-spin' : 'fa-satellite-dish'}`}></i> Sync
                  </button>
                </div>
                <input type="text" placeholder="RTSP URL CCTV (opsional, rtsp://user:pass@ip:port/path)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900 text-[11px]" value={formAlatBerat.rtsp_url || ''} onChange={(e) => setFormAlatBerat({ ...formAlatBerat, rtsp_url: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Latitude (Otomatis)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900" value={formAlatBerat.lat} onChange={(e) => setFormAlatBerat({ ...formAlatBerat, lat: e.target.value })} />
                  <input type="text" placeholder="Longitude (Otomatis)" className="w-full bg-white border border-red-200 rounded-lg p-2 focus:outline-none font-mono text-slate-900" value={formAlatBerat.lng} onChange={(e) => setFormAlatBerat({ ...formAlatBerat, lng: e.target.value })} />
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
            <div className="bg-gray-50 border border-gray-300 p-2 rounded-xl flex items-center gap-2 mb-3">
              <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
              <input type="text" placeholder="Cari boks (ID, Unit, IP)..." className="w-full bg-transparent text-xs text-slate-900 focus:outline-none font-mono-tech" value={boxSearchTerm} onChange={(e) => setBoxSearchTerm(e.target.value)} />
              {boxSearchTerm && <button type="button" onClick={() => setBoxSearchTerm('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">&times;</button>}
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
              {filteredBoxes.length > 0 ? filteredBoxes.map((box) => (
                <BoxCard key={box.id} box={box} isSelected={selectedBox} isHwOnline={isHwOnline} hwData={hwData} sessionUser={sessionUser} onSelect={handleSelectBox} onEdit={handleEditAlatBerat} onDelete={handleHapusAlatBerat} />
              )) : <div className="p-4 text-center text-slate-400 italic text-xs">Tidak ada boks yang cocok.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* TABEL RIWAYAT SESI TAPPING */}
      <div className="bg-white border border-red-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-red-50 px-4 py-3 border-b border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div><h3 className="text-xs font-black uppercase tracking-wider text-red-700 font-mono-tech">Riwayat Sesi Tapping</h3><p className="text-[10px] text-slate-600 mt-0.5">Data permanen dari tabel tapping_history</p></div>
          <span className="text-[10px] font-bold text-red-700 font-mono-tech">{filteredSessionHistory.length} Sesi</span>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full min-w-[850px] text-left border-collapse text-[11px] font-mono-tech">
            <thead className="sticky top-0 z-10 bg-gray-100 text-slate-800 border-b border-gray-200">
              <tr>
                <th className="p-3">Waktu Masuk</th><th className="p-3">Waktu Keluar</th><th className="p-3">Boks</th><th className="p-3">Nama Personel</th><th className="p-3">UID RFID</th><th className="p-3 text-center">Status</th><th className="p-3">Event</th><th className="p-3 text-center">Total</th><th className="p-3 text-center">Aksi</th>
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
                    <td className="p-3 font-bold text-slate-900"><div className="flex flex-wrap gap-1.5">{entry.participants.length > 0 ? entry.participants.map(item => (<span key={`${entry.id}-${item.uid}`} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-slate-50">{item.nama}<small className={`text-[8px] font-black ${item.status === 'KELUAR' ? 'text-slate-500' : 'text-green-600'}`}>({item.status || 'MASUK'})</small></span>)) : 'Personel Belum Terdaftar'}</div></td>
                    <td className="p-3 text-blue-700">{entry.participants.map(item => item.uid).filter(Boolean).join(', ') || '—'}</td>
                    <td className="p-3 text-center"><span className={`px-2 py-1 rounded border text-[9px] font-bold ${sessionClosed ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-green-50 text-green-700 border-green-300'}`}>{sessionClosed ? 'SELESAI / OUT' : 'MASIH AKTIF / IN'}</span></td>
                    <td className="p-3 text-slate-600">{entry.eventText || '—'}</td>
                    <td className="p-3 text-center"><span className="inline-flex min-w-8 justify-center px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-black">{entry.totalPersonel} Orang</span></td>
                    <td className="p-3 text-center">{String(sessionUser?.role || '').trim().toLowerCase() === 'admin' && entry.deleteId && <button type="button" onClick={() => handleHapusRiwayatTapping(entry.deleteId, entry.deleteIds)} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-2.5 py-1.5 rounded border border-red-200 transition-colors" title="Hapus satu sesi"><i className="fa-solid fa-trash-can"></i><span className="ml-1 text-[9px] font-bold">HAPUS</span></button>}</td>
                  </tr>
                );
              }) : <tr><td colSpan="9" className="p-8 text-center text-slate-500 italic">Belum ada riwayat sesi tapping.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
