import React, { useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/useAuth';
import Avatar from '../components/Avatar';

/**
 * Halaman Profil Saya
 */
export default function Profile() {
  const { sessionUser, activeTab, setActiveTab } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const changePassword = async event => {
    event.preventDefault();
    try {
      const { data } = await api.post('/users/password', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setMessage(data.message);
      window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg: data.message, type: 'ok' } }));
      setTimeout(() => window.dispatchEvent(new Event('eloto-session-expired')), 1500);
    } catch (error) { setMessage(error.response?.data?.message || 'Gagal mengubah kata sandi.'); }
  };
  if (activeTab !== 'profil-tab') return null;

  return (
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
      {sessionUser?.role !== 'admin' && (
        <form onSubmit={changePassword} className="bg-white border border-red-200 rounded-2xl p-5 space-y-3">
          <h2 className="font-bold">Ubah kata sandi</h2>
          <input aria-label="Kata sandi lama" type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Kata sandi lama" className="w-full border rounded-lg p-3" />
          <input aria-label="Kata sandi baru" type="password" autoComplete="new-password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Kata sandi baru" className="w-full border rounded-lg p-3" />
          <button className="bg-red-600 text-white rounded-lg p-3">Simpan dan login ulang</button>
          <p role="status">{message}</p>
        </form>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') && <button type="button" onClick={() => setActiveTab('dashboard')} className="bg-red-600 hover:bg-red-700 text-white p-3 rounded-xl font-bold text-xs font-mono-tech"><i className="fa-solid fa-house mr-2"></i>Buka Home / Pantau Langsung</button>}
        {(sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') && <button type="button" onClick={() => setActiveTab('teknisi-tab')} className="bg-white hover:bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl font-bold text-xs font-mono-tech"><i className="fa-solid fa-screwdriver-wrench mr-2"></i>Form Laporan Servis</button>}
      </div>
    </div>
  );
}
