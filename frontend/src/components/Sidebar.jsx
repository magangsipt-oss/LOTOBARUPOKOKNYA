import React from 'react';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';

export default function Sidebar() {
  const { sessionUser, activeTab, setActiveTab, handleLogout: doLogout } = useAuth();

  const handleLogout = () => {
    doLogout((msg, type) => {
      window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
    });
  };

  const navItems = [];

  if (sessionUser?.role !== 'admin') {
    navItems.push({ id: 'profil-tab', icon: 'fa-user', label: 'Profil Saya' });
  }
  if (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') {
    navItems.push({ id: 'dashboard', icon: 'fa-house', label: 'Home / Pantau Langsung' });
  }
  if (sessionUser?.role === 'admin' || sessionUser?.role === 'teknisi' || sessionUser?.role === 'mekanik') {
    navItems.push({ id: 'teknisi-tab', icon: 'fa-screwdriver-wrench', label: 'Form Laporan Servis' });
  }
  navItems.push({ id: 'riwayat-tab', icon: 'fa-clock-history', label: 'Riwayat Laporan', subTab: 'form-mekanik' });
  if (sessionUser?.role === 'admin') {
    navItems.push({ id: 'admin-tab', icon: 'fa-users-gear', label: 'Kelola Personel' });
  }
  if (sessionUser?.role === 'pengawas') {
    navItems.push({ id: 'team-tab', icon: 'fa-people-group', label: 'Tim Mekanik' });
  }

  return (
    <aside className="w-full md:w-64 bg-red-50 border-b md:border-b-0 md:border-r border-red-100 p-4 md:p-6 flex flex-col justify-between shrink-0 backdrop-blur-sm">
      <div className="space-y-4 md:space-y-6">
        <div className="flex items-center gap-3 border-b border-red-200 pb-3">
          <i className="fa-solid fa-radio text-red-600 text-xl animate-pulse"></i>
          <div>
            <h2 className="font-black text-sm tracking-wider text-red-600 font-mono-tech">E-LOTO PLATFORM</h2>
            <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold font-mono-tech">Sistem Monitoring Terpadu</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => sessionUser?.role !== 'admin' && setActiveTab('profil-tab')}
          className={`w-full bg-white p-3 rounded-xl border border-red-200 text-center space-y-2 shadow-sm hover:border-red-500 transition-all ${sessionUser?.role === 'admin' ? 'cursor-default' : ''}`}
        >
          <Avatar profile={sessionUser} className="w-16 h-16 mx-auto" />
          <p className="text-[10px] text-slate-500 font-bold uppercase font-mono-tech">Pengguna Aktif:</p>
          <p className="text-xs font-bold text-slate-950 truncate">{sessionUser?.nama}</p>
          <span className="inline-block text-[9px] bg-red-600 text-white px-2 py-0.5 rounded font-mono font-black uppercase tracking-wider font-mono-tech">{sessionUser?.role}</span>
          {sessionUser?.role !== 'admin' && <span className="block text-[9px] text-red-600 font-mono-tech uppercase font-bold">Lihat Profil</span>}
        </button>

        <nav className="flex flex-row md:flex-col overflow-x-auto md:overflow-visible gap-1 pb-2 md:pb-0 text-xs font-semibold text-slate-800 scrollbar-none">
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
              className={`whitespace-nowrap text-left flex items-center gap-2.5 p-3 rounded-xl transition-all ${
                activeTab === item.id
                  ? 'bg-red-600 text-white font-bold shadow-md shadow-red-200'
                  : 'hover:bg-red-50 text-slate-900'
              }`}
            >
              <i className={`fa-solid ${item.icon} w-4 text-center`}></i> {item.label}
            </button>
          ))}
        </nav>
      </div>

      <button
        type="button"
        onClick={handleLogout}
        className="mt-4 md:mt-0 w-full flex items-center justify-center gap-2 bg-white border border-gray-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 hover:text-red-600 hover:border-red-200 transition-all font-mono-tech shadow-sm"
      >
        <i className="fa-solid fa-right-from-bracket"></i> KELUAR
      </button>
    </aside>
  );
}
