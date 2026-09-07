import React, { useState, useEffect } from 'react';
import userService from '../services/userService';

/**
 * Halaman Tim Supervisor LOTO
 */
const Supervisors = () => {
  const [supervisors, setSupervisors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Mengambil data supervisor dari backend
  const fetchSupervisors = async () => {
    try {
      setIsLoading(true);
      const response = await userService.getSupervisors();
      if (response && response.success) {
        setSupervisors(response.data || []);
      }
    } catch (error) {
      console.error('Gagal mengambil data supervisor:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSupervisors();
  }, []);

  // 2. Filter pencarian nama / departemen
  const filteredSupervisors = supervisors.filter((spv) => {
    const query = searchQuery.toLowerCase();
    return (
      spv.name?.toLowerCase().includes(query) ||
      spv.department?.toLowerCase().includes(query) ||
      spv.card_number?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Baris Atas: Judul Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">
            Tim Supervisor LOTO
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Daftar pengawas yang memiliki hak akses verifikasi dan pembukaan box
          </p>
        </div>

        {/* Input Pencarian */}
        <div className="w-full sm:w-72 relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
            🔍
          </span>
          <input
            type="text"
            placeholder="Cari nama supervisor / departemen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Grid Kartu Supervisor */}
      {isLoading ? (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-slate-400">Memuat data tim supervisor...</p>
        </div>
      ) : filteredSupervisors.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/30 border border-slate-800 rounded-2xl">
          <p className="text-4xl mb-2">🛡️</p>
          <p className="text-sm font-semibold text-slate-300">Tidak ada supervisor yang ditemukan</p>
          <p className="text-xs text-slate-500 mt-1">Daftarkan akun dengan peran SUPERVISOR di menu Manajemen User.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredSupervisors.map((spv) => (
            <div
              key={spv.id}
              className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 flex flex-col items-center text-center shadow-sm hover:border-slate-600 transition-all"
            >
              {/* Foto Profil */}
              <div className="w-20 h-20 rounded-full bg-slate-700 border-2 border-emerald-500/40 overflow-hidden flex items-center justify-center mb-3 ring-2 ring-slate-600 shadow-md">
                {spv.profile_photo ? (
                  <img
                    src={`http://localhost:5002/api/users/photo/${encodeURIComponent(spv.rfid_uid || spv.rfidUid || spv.card_number || spv.sid)}`}
                    alt={spv.name}
                    className="w-full h-full object-cover object-center"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = 'https://via.placeholder.com/150?text=SPV';
                    }}
                  />
                ) : (
                  <span className="text-3xl">👤</span>
                )}
              </div>

              {/* Identitas */}
              <h3 className="text-sm font-bold text-slate-100">{spv.name}</h3>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                {spv.role || 'SUPERVISOR'}
              </span>

              {/* Rincian Tambahan */}
              <div className="w-full mt-4 pt-3 border-t border-slate-700/60 text-xs space-y-1 text-slate-400 text-left">
                <p className="flex justify-between">
                  <span>RFID:</span>
                  <span className="font-mono text-slate-200 font-medium">💳 {spv.card_number}</span>
                </p>
                <p className="flex justify-between">
                  <span>Divisi:</span>
                  <span className="text-slate-200 font-medium">{spv.department || '-'}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Supervisors;