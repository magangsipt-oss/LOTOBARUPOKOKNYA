import React from 'react';

/**
 * Komponen Kartu Unit Box E-LOTO
 * @param {Object} box - Data objek box (id, box_number, location_name, status, department)
 * @param {Function} onToggleStatus - Fungsi untuk membuka modal/aksi ubah status LOTO
 * @param {Function} onEdit - Fungsi untuk membuka modal edit data box
 * @param {Function} onDelete - Fungsi untuk menghapus box
 */
const BoxCard = ({ box, onToggleStatus, onEdit, onDelete }) => {
  // Menentukan status apakah terkunci atau terbuka
  const isLocked = box.status?.toUpperCase() === 'LOCKED';

  return (
    <div className="bg-slate-800/80 border border-slate-700/70 hover:border-slate-600 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
      {/* 1. Bagian Atas: Nomor Box & Lencana Status */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <span className="text-xs font-mono font-medium text-slate-400 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700/50">
              ID #{box.id}
            </span>
            <h3 className="text-lg font-bold text-slate-100 mt-1.5 flex items-center gap-2">
              <span>{isLocked ? '🔒' : '🔓'}</span>
              <span>{box.box_number}</span>
            </h3>
          </div>

          {/* Lencana Status Visual */}
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase border ${
              isLocked
                ? 'bg-red-500/15 text-red-400 border-red-500/30'
                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            }`}
          >
            {isLocked ? 'LOCKED' : 'UNLOCKED'}
          </span>
        </div>

        {/* 2. Informasi Lokasi & Departemen */}
        <div className="space-y-1.5 text-xs text-slate-300 bg-slate-900/40 p-3 rounded-xl border border-slate-700/40">
          <p className="flex items-center justify-between">
            <span className="text-slate-400">Lokasi:</span>
            <span className="font-medium text-slate-200">{box.location_name || '-'}</span>
          </p>
          <p className="flex items-center justify-between">
            <span className="text-slate-400">Departemen:</span>
            <span className="font-medium text-slate-200">{box.department || '-'}</span>
          </p>
        </div>
      </div>

      {/* 3. Tombol Aksi Kendali LOTO & Manajemen */}
      <div className="mt-5 pt-4 border-t border-slate-700/60 space-y-2">
        {/* Tombol Utama: Ubah Status Kunci */}
        <button
          onClick={() => onToggleStatus(box)}
          className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 shadow-sm flex items-center justify-center gap-2 ${
            isLocked
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
              : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20'
          }`}
        >
          <span>{isLocked ? 'Buka Kunci (Unlock)' : 'Kunci Box (Lock)'}</span>
        </button>

        {/* Tombol Sekunder: Edit & Hapus */}
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(box)}
            className="flex-1 py-1.5 px-3 bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
          >
            ✏️ Edit
          </button>
          <button
            onClick={() => onDelete(box.id)}
            className="py-1.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg text-xs font-medium transition-colors"
          >
            🗑️ Hapus
          </button>
        </div>
      </div>
    </div>
  );
};

export default BoxCard;