import React from 'react';
import { useApp } from '../context/useApp';
import Avatar from '../components/Avatar';
import { formatWaktuDowntime, safeToFixed } from '../utils/helpers';

/**
 * Halaman Riwayat - Status Kerja Realtime, Pindaian Kartu
 */
export default function Logs() {
  const {
    activeTab, subTabMaintenance, setSubTabMaintenance,
    boxes, selectedBox, isHwOnline, hwData, downtimeSeconds, isTrackingDowntime,
    filteredTappingData, totalOrangMasukOtomatis,
    tappingSearchTerm, setTappingSearchTerm,
    terjemahkanIdKeNamaLengkap, isAdminUid
  } = useApp();

  // Riwayat Laporan (riwayat-tab)
  const renderRiwayatTab = () => (
    <div className="space-y-6">
      <div className="flex border-b border-gray-200 gap-2 no-print overflow-x-auto scrollbar-none">
        <button type="button" onClick={() => setSubTabMaintenance('realtime-status')} className={`px-4 py-2 text-xs font-bold font-mono-tech whitespace-nowrap border-b-2 transition-all ${subTabMaintenance === 'realtime-status' ? 'border-red-500 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-800'}`}> 📡 Status Kerja Petugas Saat Ini</button>
        <button type="button" onClick={() => setSubTabMaintenance('pindaian-kartu')} className={`px-4 py-2 text-xs font-bold font-mono-tech whitespace-nowrap border-b-2 transition-all ${subTabMaintenance === 'pindaian-kartu' ? 'border-red-500 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-800'}`}> 🪪 Data Pindaian Kartu</button>
      </div>

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
                {Array.isArray(boxes) && boxes.length > 0 ? boxes.map((box) => {
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
                }) : <tr><td colSpan="5" className="p-12 text-center text-slate-500 italic border border-red-200">Belum ada boks terdaftar.</td></tr>}
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
  );

  return (
    <>
      {activeTab === 'riwayat-tab' && renderRiwayatTab()}
    </>
  );
}
