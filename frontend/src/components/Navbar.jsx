import React, { useState, useEffect } from 'react';

/**
 * Komponen Navbar untuk Dashboard E-LOTO
 */
const Navbar = () => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Memperbarui waktu setiap detik secara otomatis
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Format tanggal dan waktu Indonesia
  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(currentTime);

  const formattedTime = currentTime.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-30 shadow-md">
      {/* 1. Logo & Judul Sistem */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xl shadow-inner">
          ⚡
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-wide text-slate-100">
            E-LOTO PLATFORM
          </h1>
          <p className="text-xs text-slate-400 font-medium">
            Industrial IoT Safety Management System
          </p>
        </div>
      </div>

      {/* 2. Indikator Sistem & Waktu Real-Time */}
      <div className="flex items-center gap-4 text-sm">
        {/* Status Koneksi IoT */}
        <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-xs font-medium text-emerald-300">Server & IoT Online</span>
        </div>

        {/* Waktu & Tanggal */}
        <div className="hidden sm:flex flex-col text-right border-l border-slate-700 pl-4">
          <span className="text-xs text-slate-400">{formattedDate}</span>
          <span className="text-xs font-mono font-semibold text-slate-200">
            {formattedTime} WITA
          </span>
        </div>
      </div>
    </header>
  );
};

export default Navbar;