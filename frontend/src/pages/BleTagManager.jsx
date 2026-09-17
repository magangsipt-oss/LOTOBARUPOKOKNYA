import React, { useState, useEffect } from 'react';
import { useApp } from '../context/useApp';
import logService from '../services/logService';

/**
 * Halaman Manajemen BLE Tag untuk LOTO Compliance Monitoring
 */
export default function BleTagManager() {
  const { isLoggedIn, activeTab, sessionUser, userDatabase, pemicuToast, boxes } = useApp();
  const canManageTags = sessionUser?.role === 'admin';

  const [bleTags, setBleTags] = useState([]);
  const [presenceResult, setPresenceResult] = useState({ boxId: '', status: 'loading', rows: [] });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formTag, setFormTag] = useState({ mac_address: '', tag_name: '', assigned_sid: '' });
  const [chosenBoxId, setSelectedBoxId] = useState('');
  const [tagRevision, setTagRevision] = useState(0);
  const selectedBoxId = boxes.some(box => String(box.id) === chosenBoxId) ? chosenBoxId : String(boxes[0]?.id || '');
  const presenceStatus = !selectedBoxId ? 'unavailable' : presenceResult.boxId === selectedBoxId ? presenceResult.status : 'loading';
  const activePresence = presenceStatus === 'ready' ? presenceResult.rows : [];

  // Load BLE tags
  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'ble-tags') return;
    let active = true;
    const loadTags = async () => {
      try {
        const result = await logService.getAllBleTags();
        const data = result.data ?? result;
        if (active && Array.isArray(data)) setBleTags(data);
      } catch {}
    };
    loadTags();
    return () => { active = false; };
  }, [isLoggedIn, activeTab, tagRevision]);

  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'ble-tags' || !selectedBoxId) return;
    let active = true;
    let pending = false;
    const loadPresence = async () => {
      if (pending) return;
      pending = true;
      setPresenceResult({ boxId: selectedBoxId, status: 'loading', rows: [] });
      try {
        const result = await logService.getActivePresence(selectedBoxId);
        const data = result.data ?? result;
        if (!Array.isArray(data)) throw new Error('Data presence tidak valid.');
        if (active) setPresenceResult({ boxId: selectedBoxId, status: 'ready', rows: data });
      } catch {
        if (active) setPresenceResult({ boxId: selectedBoxId, status: 'error', rows: [] });
      } finally { pending = false; }
    };
    loadPresence();
    const interval = setInterval(loadPresence, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [isLoggedIn, activeTab, selectedBoxId]);

  // Register new BLE tag
  const handleRegisterTag = async (e) => {
    e.preventDefault();
    if (!canManageTags || loading) return;
    if (!formTag.mac_address.trim()) {
      pemicuToast('MAC Address wajib diisi!', 'fail');
      return;
    }
    setLoading(true);
    try {
      const result = await logService.registerBleTag({
        mac_address: formTag.mac_address.trim(),
        tag_name: formTag.tag_name.trim() || null,
        assigned_sid: formTag.assigned_sid || null
      });
      if (result.success || result.status === 'success') {
        pemicuToast('BLE Tag berhasil didaftarkan!', 'ok');
        setFormTag({ mac_address: '', tag_name: '', assigned_sid: '' });
        setShowForm(false);
        setTagRevision(revision => revision + 1);
      } else {
        pemicuToast(result.message || 'Gagal mendaftarkan tag', 'fail');
      }
    } catch (err) {
      pemicuToast('Gagal mendaftarkan BLE tag: ' + (err.message || ''), 'fail');
    }
    setLoading(false);
  };

  // Delete BLE tag
  const handleDeleteTag = async (id) => {
    if (!canManageTags) return;
    if (!window.confirm('Hapus BLE tag ini secara permanen?')) return;
    try {
      const result = await logService.deleteBleTag(id);
      if (result.success || result.status === 'success') {
        pemicuToast('BLE Tag dihapus', 'ok');
        setTagRevision(revision => revision + 1);
      } else {
        pemicuToast(result.message || 'Gagal menghapus tag', 'fail');
      }
    } catch { pemicuToast('Gagal menghapus BLE tag', 'fail'); }
  };

  // Toggle tag active status
  const handleToggleTag = async (id, currentActive) => {
    if (!canManageTags) return;
    try {
      await logService.updateBleTag(id, { is_active: !currentActive });
      setTagRevision(revision => revision + 1);
    } catch { pemicuToast('Gagal update status tag', 'fail'); }
  };

  if (activeTab !== 'ble-tags' || !(sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas')) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black font-mono-tech text-red-700 flex items-center gap-2">
            <i className="fa-solid fa-tag"></i> Manajemen BLE Tag
          </h2>
          <p className="text-xs text-slate-500 mt-1">Daftar & kelola BLE Smart Tag untuk LOTO Compliance Monitoring</p>
        </div>
        {canManageTags && <button onClick={() => setShowForm(!showForm)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors">
          <i className={`fa-solid ${showForm ? 'fa-times' : 'fa-plus'}`}></i> {showForm ? 'Batal' : 'Tambah Tag Baru'}
        </button>}
      </div>

      {/* Register Form */}
      {canManageTags && showForm && (
        <div className="bg-white border border-red-200 rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-bold text-red-700 mb-3">Registrasi BLE Tag Baru</h3>
          <form onSubmit={handleRegisterTag} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">MAC Address *</label>
              <input
                type="text"
                placeholder="AA:BB:CC:DD:EE:FF"
                value={formTag.mac_address}
                onChange={e => setFormTag({ ...formTag, mac_address: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono-tech mt-1 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">Nama Tag</label>
              <input
                type="text"
                placeholder="Misal: Tag Mekanik 1"
                value={formTag.tag_name}
                onChange={e => setFormTag({ ...formTag, tag_name: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono-tech mt-1 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">Assign ke Mekanik (SID)</label>
              <select
                value={formTag.assigned_sid}
                onChange={e => setFormTag({ ...formTag, assigned_sid: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono-tech mt-1 focus:outline-none focus:border-red-500"
              >
                <option value="">— Belum Di-assign —</option>
                {userDatabase.filter(u => u.role === 'teknisi' || u.role === 'mekanik' || u.role === 'worker').map(user => (
                  <option key={user.sid} value={user.sid}>{user.nama} ({user.sid})</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <button type="submit" disabled={loading} className="bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">
                {loading ? 'Menyimpan...' : 'Simpan Tag'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active Presence */}
      <div className="bg-white border border-green-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-green-50 px-4 py-3 border-b border-green-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-broadcast-tower text-green-600"></i>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-green-700 font-mono-tech">BLE Presence Aktif</h3>
              <p className="text-[10px] text-slate-600">Tag yang terdeteksi dalam 60 detik terakhir</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedBoxId}
              onChange={e => setSelectedBoxId(e.target.value)}
              className="border border-green-300 rounded-lg px-2 py-1 text-[10px] font-mono-tech"
            >
              {boxes.map(b => <option key={b.id} value={b.id}>{b.id} - {b.unit}</option>)}
            </select>
            <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded">{activePresence.length} Aktif</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11px] font-mono-tech">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="p-3">Status</th>
                <th className="p-3">BLE MAC</th>
                <th className="p-3">Tag Name</th>
                <th className="p-3">Mekanik (SID)</th>
                <th className="p-3">Role</th>
                <th className="p-3">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activePresence.length > 0 ? activePresence.map((presence, i) => (
                <tr key={i} className="hover:bg-green-50/50">
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                      <span className="text-green-700 font-bold text-[9px]">ACTIVE</span>
                    </span>
                  </td>
                  <td className="p-3 text-blue-700 font-bold">{presence.ble_mac}</td>
                  <td className="p-3 text-slate-700">{presence.tag_name || '—'}</td>
                  <td className="p-3 font-bold text-slate-900">
                    {presence.is_registered ? presence.nama : <span className="text-red-500">UNREGISTERED</span>}
                    <span className="block text-[9px] text-slate-400">{presence.assigned_sid || '—'}</span>
                  </td>
                  <td className="p-3 text-slate-600">{presence.role || '—'}</td>
                  <td className="p-3 text-slate-500">{presence.last_seen ? new Date(presence.last_seen).toLocaleTimeString('id-ID') : '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400 italic">Tidak ada BLE tag yang terdeteksi aktif</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BLE Tag Registry */}
      <div className="bg-white border border-red-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-red-50 px-4 py-3 border-b border-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-list text-red-600"></i>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-red-700 font-mono-tech">Daftar BLE Tag Terdaftar</h3>
              <p className="text-[10px] text-slate-600">Semua BLE Smart Tag yang terdaftar di sistem</p>
            </div>
          </div>
          <span className="text-[10px] font-bold text-red-700 font-mono-tech">{bleTags.length} Tag</span>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-left border-collapse text-[11px] font-mono-tech">
            <thead className="sticky top-0 bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">MAC Address</th>
                <th className="p-3">Tag Name</th>
                <th className="p-3">Assigned To</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bleTags.length > 0 ? bleTags.map((tag) => (
                <tr key={tag.id} className={`hover:bg-red-50/50 ${!tag.is_active ? 'opacity-50' : ''}`}>
                  <td className="p-3 font-bold text-slate-700">#{tag.id}</td>
                  <td className="p-3 text-blue-700 font-bold font-mono-tech">{tag.mac_address}</td>
                  <td className="p-3 text-slate-700">{tag.tag_name || '—'}</td>
                  <td className="p-3">
                    <span className="font-bold text-slate-900">{tag.assigned_name || 'Belum di-assign'}</span>
                    <span className="block text-[9px] text-slate-400">{tag.assigned_sid || ''}</span>
                  </td>
                  <td className="p-3 text-center">
                    <button onClick={() => handleToggleTag(tag.id, tag.is_active)} className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer transition-colors ${tag.is_active ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                      {tag.is_active ? 'AKTIF' : 'NONAKTIF'}
                    </button>
                  </td>
                  <td className="p-3 text-center">
                    <button onClick={() => handleDeleteTag(tag.id)} className="text-red-500 hover:text-red-700 text-[10px] font-bold" title="Hapus tag">
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400 italic">Belum ada BLE tag yang terdaftar. Klik "Tambah Tag Baru" untuk memulai.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-xs font-bold text-blue-700 mb-2 flex items-center gap-2">
          <i className="fa-solid fa-circle-info"></i> Cara Kerja BLE LOTO Compliance
        </h3>
        <ol className="text-[11px] text-blue-800 space-y-1 list-decimal list-inside">
          <li><strong>ESP32 scan BLE</strong> → Mendeteksi Smart Tag yang ada di area kerja</li>
          <li><strong>Backend resolve</strong> → BLE MAC dikonversi ke SID mekanik berdasarkan registrasi</li>
          <li><strong>Mekanik tap SID</strong> → Kartu RFID HID 6300 di-tap di LOTO station</li>
          <li><strong>Backend compare</strong> → BLE presence vs RFID tap → selisih = mekanik belum LOTO</li>
          <li><strong>Dashboard alert</strong> → Tampilkan peringatan untuk mekanik yang belum comply</li>
        </ol>
      </div>
    </div>
  );
}
