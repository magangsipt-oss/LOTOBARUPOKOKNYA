import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/useAuth';
import Avatar from './Avatar';

export default function Sidebar({ isOpen, onOpen, onClose }) {
  const { sessionUser, activeTab, setActiveTab, handleLogout: doLogout } = useAuth();
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const buttons = [...sidebarRef.current.querySelectorAll('button')]
        .filter(button => !button.disabled && button.getClientRects().length > 0);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      menuButtonRef.current?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const handleResize = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener('change', handleResize);
    return () => desktop.removeEventListener('change', handleResize);
  }, [onClose]);

  const navigate = (item) => {
    if (item.id === 'dop-plan') {
      window.dispatchEvent(new Event('eloto-open-dop-plan'));
    }
    setActiveTab(item.id);
    onClose();
  };

  const handleLogout = () => {
    onClose();
    doLogout((msg, type) => {
      window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
    });
  };

  // Profil dibuka lewat kartu "Pengguna aktif", bukan item menu.
  const navItems = [];
  if (sessionUser?.role === 'admin' || sessionUser?.role === 'pengawas') {
    navItems.push({ id: 'dashboard', icon: 'fa-house', label: 'Dashboard' });
    navItems.push({ id: 'dop-plan', icon: 'fa-clipboard-list', label: 'DOP Plan' });
  }
  if (['admin', 'teknisi', 'mekanik'].includes(sessionUser?.role)) {
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

  const activePage = navItems.find(item => item.id === activeTab)?.label || 'E-LOTO';
  const UserCard = sessionUser ? 'button' : 'div';

  return (
    <>
      <header className="mobile-app-header md:hidden" inert={isOpen ? true : undefined}>
        <button ref={menuButtonRef} type="button" onClick={onOpen} aria-label="Buka menu navigasi" aria-expanded={isOpen} aria-controls="app-sidebar" className="mobile-menu-button">
          <i className="fa-solid fa-bars" aria-hidden="true"></i>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-sm shadow-red-200">
            <i className="fa-solid fa-shield-halved" aria-hidden="true"></i>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black tracking-tight text-slate-900">E-LOTO</p>
            <p className="truncate text-xs font-medium text-slate-500">{activePage}</p>
          </div>
        </div>
        <Avatar profile={sessionUser} className="h-9 w-9 shrink-0 ring-2 ring-red-100" />
      </header>

      {isOpen && <div className="fixed inset-0 z-[55] bg-slate-900/45 backdrop-blur-sm md:hidden" onClick={onClose} aria-hidden="true" />}

      <aside ref={sidebarRef} id="app-sidebar" role={isOpen ? 'dialog' : undefined} aria-modal={isOpen ? true : undefined} aria-label="Menu utama E-LOTO" className={`app-sidebar ${isOpen ? 'is-open' : ''}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 shadow-lg shadow-red-500/20">
              <i className="fa-solid fa-shield-halved text-sm text-white" aria-hidden="true"></i>
            </div>
            <div>
              <h2 className="text-sm font-black tracking-tight text-slate-800">E-LOTO</h2>
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Safety System</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Tutup menu navigasi" className="mobile-menu-button md:hidden">
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4">
            <UserCard {...(sessionUser && { type: 'button', onClick: () => navigate({ id: 'profil-tab' }), title: 'Buka profil saya', 'aria-current': activeTab === 'profil-tab' ? 'page' : undefined })} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${activeTab === 'profil-tab' ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50 hover:border-red-300 hover:bg-red-50/50 cursor-pointer'}`}>
              <Avatar profile={sessionUser} className="h-11 w-11 shrink-0 ring-2 ring-white shadow-sm" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pengguna aktif</p>
                <p className="truncate text-sm font-bold text-slate-800">{sessionUser?.nama}</p>
                <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">{sessionUser?.role}</span>
              </div>
            </UserCard>
          </div>

          <nav aria-label="Navigasi utama" className="px-3 pb-4">
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Menu utama</p>
            <div className="space-y-1">
              {navItems.map((item) => (
                <button key={item.id} type="button" onClick={() => navigate(item)} aria-current={activeTab === item.id ? 'page' : undefined} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors md:min-h-11 md:text-xs ${activeTab === item.id ? 'bg-red-600 text-white shadow-md shadow-red-500/20' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                  <i className={`fa-solid ${item.icon} w-5 text-center text-base md:text-sm`} aria-hidden="true"></i>
                  <span className="flex-1">{item.label}</span>
                  {activeTab === item.id && <i className="fa-solid fa-chevron-right text-[10px] opacity-70" aria-hidden="true"></i>}
                </button>
              ))}
            </div>
          </nav>
        </div>

        <div className="sidebar-footer shrink-0 border-t border-slate-100 p-4">
          <button type="button" onClick={handleLogout} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 md:text-xs">
            <i className="fa-solid fa-right-from-bracket" aria-hidden="true"></i>
            <span>Keluar</span>
          </button>
        </div>
      </aside>
    </>
  );
}
