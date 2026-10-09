import React from 'react';
import { useAuth } from '../context/useAuth';
import Avatar from './Avatar';

export default function Sidebar() {
  const { sessionUser, activeTab, setActiveTab, handleLogout: doLogout } = useAuth();

  const handleLogout = () => {
    doLogout((msg, type) => {
      window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
    });
  };

  const navItems = [];

  if (sessionUser && sessionUser?.role !== 'admin') {
    navItems.push({ id: 'profil-tab', icon: 'fa-user', label: 'Profil Saya' });
  }
  if (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') {
    navItems.push({ id: 'dashboard', icon: 'fa-house', label: 'Dashboard' });
  }
  if (sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') {
    navItems.push({ id: 'teknisi-tab', icon: 'fa-screwdriver-wrench', label: 'Laporan Servis' });
  }
  navItems.push({ id: 'riwayat-tab', icon: 'fa-clock-rotate-left', label: 'Riwayat' });
  if (sessionUser?.role === 'admin') {
    navItems.push({ id: 'admin-tab', icon: 'fa-users-gear', label: 'Personel' });
  }
  if (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') {
    navItems.push({ id: 'ble-tags', icon: 'fa-tag', label: 'BLE Tag' });
  }
  if (sessionUser?.role === 'pengawas') {
    navItems.push({ id: 'team-tab', icon: 'fa-people-group', label: 'Tim Kerja' });
  }

  return (
    <aside className="w-full md:w-64 h-screen bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col shrink-0 shadow-lg md:shadow-none overflow-y-auto">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-700 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/20">
            <i className="fa-solid fa-shield-halved text-white text-sm"></i>
          </div>
          <div>
            <h2 className="font-black text-sm text-slate-800 tracking-tight">E-LOTO</h2>
            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">Safety System</p>
          </div>
        </div>
      </div>

      {/* User Card */}
      <div className="p-4">
        <div
          className={`w-full bg-slate-50 p-3 rounded-2xl border border-slate-200 text-center space-y-2 ${sessionUser?.role !== 'admin' ? 'cursor-pointer hover:border-red-300 hover:bg-red-50/50 transition-all' : ''}`}
          {...(sessionUser?.role !== 'admin' && { onClick: () => setActiveTab('profil-tab'), role: 'button', tabIndex: 0 })}
        >
          <Avatar profile={sessionUser} className="w-14 h-14 mx-auto ring-2 ring-white shadow-md" />
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Pengguna Aktif</p>
          <p className="text-xs font-bold text-slate-800 truncate">{sessionUser?.nama}</p>
          <span className="inline-block text-[9px] bg-slate-800 text-white px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">{sessionUser?.role}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 pb-4">
        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest px-3 mb-2">Menu</p>
        <div className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.subTab) {
                  window.dispatchEvent(new CustomEvent('eloto-set-subtab', { detail: { subTab: item.subTab } }));
                }
                setActiveTab(item.id);
              }}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === item.id
                  ? 'bg-red-600 text-white shadow-lg shadow-red-500/30'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <i className={`fa-solid ${item.icon} w-5 text-center text-sm`}></i>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Logout */}
      <div className="p-4 border-t border-slate-100 sticky bottom-0 bg-white">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-red-50 border border-slate-200 hover:border-red-200 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-red-600 transition-all"
        >
          <i className="fa-solid fa-right-from-bracket"></i>
          <span>Keluar</span>
        </button>
      </div>
    </aside>
  );
}
