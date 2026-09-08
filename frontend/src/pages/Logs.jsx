import React from 'react';
import { useApp } from '../context/useApp';
import Avatar from '../components/Avatar';
import { formatWaktuDowntime, safeToFixed } from '../utils/helpers';

/**
 * Halaman Riwayat Laporan - Maintenance, Status Realtime, Pindaian Kartu
 */
export default function Logs() {
  const {
    activeTab, subTabMaintenance, setSubTabMaintenance,
    boxes, selectedBox, isHwOnline, hwData, downtimeSeconds, isTrackingDowntime,
     filteredMaintenanceLogs,
     filteredTappingData,
    totalOrangMasukOtomatis,
    maintenanceSearchTerm, setMaintenanceSearchTerm,
    maintenanceTypeFilter, setMaintenanceTypeFilter,
    tappingSearchTerm, setTappingSearchTerm,
    terjemahkanIdKeNamaLengkap, isAdminUid,
     setPrintActiveLog,
    handleSimpanKerusakan, handleHapusLogPemeliharaan,
     triggerSimulasiExcel,

    // Form states for teknisi-tab
    formDeskripsi, setFormDeskripsi, tipeKerusakan, setTipeKerusakan,
    estimasiWaktu, setEstimasiWaktu, manualMekanik, setManualMekanik,
    pengawasLoto, setPengawasLoto, photoBase64,
     dapatkanMekanikDariAntreanLoto, dapatkanPengawasDariLoto,
    handleCaptureKamera,  sessionUser,




    handleSelectBox: doSelectBox
  } = useApp();

  // Form Laporan Servis (teknisi-tab)
  const renderTeknisiForm = () => (
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
                  if (targetBox) doSelectBox(targetBox);
                }}>
                {Array.isArray(boxes) && boxes.length > 0 ? (
                  boxes.map(b => <option key={b.id} value={b.id}>{b.id} ({b.unit})</option>)
                ) : <option value="">Belum ada boks terdaftar</option>}
              </select>
            </div>
            <div>
              <label className="block text-slate-700 mb-1 font-semibold">Mekanik Penanggung Jawab</label>
              <input type="text" placeholder="Tempelkan kartu RFID atau ketik nama mekanik..."
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
              <input type="text" placeholder="Nama Pengawas K3..."
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
  );

  // Riwayat Laporan (riwayat-tab)
  const renderRiwayatTab = () => (
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
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={maintenanceTypeFilter} onChange={(e) => setMaintenanceTypeFilter(e.target.value)} className="bg-white border border-gray-300 px-3 py-1.5 rounded-xl text-xs text-slate-900 font-mono-tech shadow-sm focus:outline-none focus:border-red-500">
                <option value="">Semua Jenis</option>
                <option value="Mekanikal">Mekanikal</option>
                <option value="Elektrikal">Elektrikal</option>
                <option value="Hidrolik">Hidrolik</option>
              </select>
              <div className="bg-white border border-gray-300 px-3 py-1.5 rounded-xl flex items-center gap-2 max-w-xs shadow-sm">
                <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                <input type="text" placeholder="Cari mesin, teknisi, jenis..." className="w-full bg-transparent text-xs text-slate-900 focus:outline-none font-mono-tech" value={maintenanceSearchTerm} onChange={(e) => setMaintenanceSearchTerm(e.target.value)} />
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
                {filteredMaintenanceLogs.length > 0 ? filteredMaintenanceLogs.map((log, idx) => (
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
                )) : <tr><td colSpan="8" className="p-12 text-center text-slate-500 italic font-sans border border-red-200">Belum ada berkas laporan yang sesuai.</td></tr>}
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
      {activeTab === 'teknisi-tab' && (sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') && renderTeknisiForm()}
      {activeTab === 'riwayat-tab' && renderRiwayatTab()}
    </>
  );
}
