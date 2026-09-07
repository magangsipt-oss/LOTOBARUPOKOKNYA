import React, { useState, useEffect } from 'react';
import logService from '../services/logService';
import { ModalConfirmDelete } from '../components/Modals';

/**
 * Halaman Log Aktivitas & Riwayat Tap RFID E-LOTO
 */
const Logs = () => {
  // State data
  const [activeTab, setActiveTab] = useState('activity'); // 'activity' atau 'rfid'
  const [activityLogs, setActivityLogs] = useState([]);
  const [tappingLogs, setTappingLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // State Modal Pembersihan Log
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  // 1. Mengambil data log dari backend
  const fetchData = async () => {
    try {
      setIsLoading(true);
      if (activeTab === 'activity') {
        const response = await logService.getAllLogs();
        if (response && response.success) {
          setActivityLogs(response.data || []);
        }
      } else {
        const response = await logService.getTappingHistory();
        if (response && response.success) {
          setTappingLogs(response.data || []);
        }
      }
    } catch (error) {
      console.error('Gagal mengambil data log:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  // 2. Fungsi membersihkan riwayat log
  const handleClearLogs = async () => {
    try {
      if (activeTab === 'activity') {
        await logService.clearAllLogs();
      } else {
        await logService.clearTappingHistory();
      }
      setIsClearModalOpen(false);
      fetchData(); // Refresh data setelah dibersihkan
    } catch (error) {
      alert('Gagal membersihkan log: ' + (error.response?.data?.message || error.message));
    }
  };

  // 3. Helper format waktu lokal
  const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  // 4. Filter pencarian
  const filteredActivityLogs = activityLogs.filter((log) => {
    const query = searchQuery.toLowerCase();
    return (
      log.user_name?.toLowerCase().includes(query) ||
      log.box_number?.toLowerCase().includes(query) ||
      log.action?.toLowerCase().includes(query) ||
      log.notes?.toLowerCase().includes(query) ||
      String(log.event || '').toLowerCase().includes(query)
    );
  });

  const filteredTappingLogs = tappingLogs.filter((tap) => {
    const query = searchQuery.toLowerCase();
    return (
      tap.card_number?.toLowerCase().includes(query) ||
      tap.user_name?.toLowerCase().includes(query) ||
      tap.box_number?.toLowerCase().includes(query) ||
      tap.status?.toLowerCase().includes(query) ||
      String(tap.event_type || '').toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* A. Baris Atas: Judul & Tombol Bersihkan Log */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">
            Log Aktivitas & Audit E-LOTO
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Catatan kronologis penguncian LOTO dan riwayat verifikasi kartu RFID
          </p>
        </div>

        <button
          onClick={() => setIsClearModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <span>🗑️</span>
          <span>{activeTab === 'activity' ? 'Bersihkan Log Aktivitas' : 'Bersihkan Riwayat Tap'}</span>
        </button>
      </div>

      {/* B. Tab Pilihan & Pencarian */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Tombol Tab Navigasi */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-700/70 w-full md:w-auto">
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'activity'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Log Aktivitas LOTO
          </button>
          <button
            onClick={() => setActiveTab('rfid')}
            className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'rfid'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💳 Riwayat Tap RFID
          </button>
        </div>

        {/* Input Pencarian */}
        <div className="w-full md:w-72 relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
            🔍
          </span>
          <input
            type="text"
            placeholder={activeTab === 'activity' ? 'Cari user, box, aksi...' : 'Cari nomor kartu, user, status...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* C. Tabel Log Aktivitas */}
      {isLoading ? (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-slate-400">Memuat riwayat log...</p>
        </div>
      ) : activeTab === 'activity' ? (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-700 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-3.5">Waktu</th>
                  <th className="px-5 py-3.5">Unit Box</th>
                  <th className="px-5 py-3.5">Nama Pekerja</th>
                  <th className="px-5 py-3.5">Aksi / Tindakan</th>
                  <th className="px-5 py-3.5">Status Akhir</th>
                  <th className="px-5 py-3.5">Status Data</th>
                  <th className="px-5 py-3.5">Lokasi (GPS)</th>
                  <th className="px-5 py-3.5">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {filteredActivityLogs.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center py-12 text-slate-500">
                      Tidak ada riwayat aktivitas yang ditemukan.
                    </td>
                  </tr>
                ) : (
                  filteredActivityLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-slate-400 whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-slate-200">
                        {log.box_number || `Box ID #${log.box_id}`}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-slate-200">{log.user_name || 'Tidak Diketahui'}</p>
                        <p className="text-[10px] text-slate-400 uppercase">{log.user_role || '-'}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            log.status_after?.toUpperCase() === 'LOCKED'
                              ? 'bg-red-500/15 text-red-400 border-red-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          }`}
                        >
                          {log.status_after || '-'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400 max-w-xs truncate">
                        <span className={`mr-2 px-2 py-0.5 rounded border text-[10px] font-bold ${Number(log.is_online) === 1 ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>{Number(log.is_online) === 1 ? 'Realtime' : 'Offline Sync'}</span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap">
                        {log.lat != null && log.lng != null ? <a className="text-cyan-400 hover:underline" href={`https://www.google.com/maps?q=${log.lat},${log.lng}`} target="_blank" rel="noreferrer">{Number(log.lat).toFixed(5)}, {Number(log.lng).toFixed(5)}</a> : '-'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-400 max-w-xs truncate">
                        {log.notes || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* D. Tabel Riwayat Tap RFID */
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-700 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-3.5">Waktu Tap</th>
                  <th className="px-5 py-3.5">UID Kartu RFID</th>
                  <th className="px-5 py-3.5">Pemilik Kartu</th>
                  <th className="px-5 py-3.5">Peran (Role)</th>
                  <th className="px-5 py-3.5">Unit Box Terkait</th>
                  <th className="px-5 py-3.5">Status Tap</th>
                  <th className="px-5 py-3.5">Status Data</th>
                  <th className="px-5 py-3.5">Lokasi (GPS)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {filteredTappingLogs.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center py-12 text-slate-500">
                      Tidak ada riwayat tap RFID yang ditemukan.
                    </td>
                  </tr>
                ) : (
                  filteredTappingLogs.map((tap) => (
                    <tr key={tap.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-slate-400 whitespace-nowrap">
                        {formatDateTime(tap.tapped_at)}
                      </td>
                      <td className="px-5 py-3.5 font-mono font-bold text-slate-200">
                        💳 {tap.card_number}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-200">
                        {tap.user_name || 'Kartu Belum Terdaftar'}
                      </td>
                      <td className="px-5 py-3.5 uppercase text-slate-400">
                        {tap.user_role || '-'}
                      </td>
                      <td className="px-5 py-3.5 font-medium text-slate-300">
                        {tap.box_number || (tap.box_id ? `Box ID #${tap.box_id}` : '-')}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            tap.status?.toUpperCase() === 'SUCCESS'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-red-500/15 text-red-400 border-red-500/30'
                          }`}
                        >
                          {tap.status || 'SUCCESS'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5"><span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${Number(tap.is_online) === 1 ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>{Number(tap.is_online) === 1 ? 'Realtime' : 'Offline Sync'}</span></td>
                      <td className="px-5 py-3.5 whitespace-nowrap">{tap.lat != null && tap.lng != null ? <a className="text-cyan-400 hover:underline" href={`https://www.google.com/maps?q=${tap.lat},${tap.lng}`} target="_blank" rel="noreferrer">{Number(tap.lat).toFixed(5)}, {Number(tap.lng).toFixed(5)}</a> : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* E. Modal Konfirmasi Bersihkan Log */}
      <ModalConfirmDelete
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirm={handleClearLogs}
        itemName={activeTab === 'activity' ? 'seluruh log aktivitas LOTO' : 'seluruh riwayat tap kartu RFID'}
      />
    </div>
  );
};

export default Logs;