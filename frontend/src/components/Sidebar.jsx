import React from 'react';

/**
 * Komponen Sidebar Navigasi E-LOTO
 * @param {string} activeTab - Tab/halaman yang sedang aktif saat ini
 * @param {function} setActiveTab - Fungsi untuk mengubah tab yang aktif
 */
const Sidebar = ({ activeTab, setActiveTab }) => {
  // Daftar menu navigasi utama aplikasi E-LOTO
  const menuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard Box',
      icon: '📦',
      description: 'Status & kendali unit E-LOTO'
    },
    {
      id: 'logs',
      label: 'Log Aktivitas',
      icon: '📋',
      description: 'Riwayat penguncian & verifikasi'
    },
    {
      id: 'supervisors',
      label: 'Tim Supervisor',
      icon: '🛡️',
      description: 'Daftar supervisor pengawas'
    },
    {
      id: 'users',
      label: 'Manajemen User',
      icon: '👥',
      description: 'Data pekerja & kartu RFID'
    }
  ];

  return (
    <aside className="w-full md:w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0 min-h-full p-4">
      {/* 1. Bagian Atas: Daftar Menu Navigasi */}
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-3">
            Menu Utama
          </p>
          <nav className="space-y-1.5">
            {menuItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-start gap-3 px-3.5 py-3 rounded-xl text-left transition-all duration-200 ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span className="text-xl shrink-0 mt-0.5">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isActive ? 'text-emerald-300' : 'text-slate-200'}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 2. Bagian Bawah: Informasi Sistem / Bantuan */}
      <div className="mt-8 pt-4 border-t border-slate-800/80 px-3">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <span>ℹ️</span> Panduan LOTO
          </p>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Pastikan verifikasi fisik dan kartu RFID telah disetujui supervisor sebelum membuka box.
          </p>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;