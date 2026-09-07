import React, { useState, useEffect } from 'react';

/**
 * 1. Modal Formulir Tambah / Edit Data Box E-LOTO
 */
export const ModalBoxForm = ({ isOpen, onClose, onSubmit, initialData }) => {
  const [formData, setFormData] = useState({
    box_number: '',
    location_name: '',
    department: '',
    status: 'UNLOCKED'
  });

  // Mengisi form jika dalam mode edit
  useEffect(() => {
    if (initialData) {
      setFormData({
        box_number: initialData.box_number || '',
        location_name: initialData.location_name || '',
        department: initialData.department || '',
        status: initialData.status || 'UNLOCKED'
      });
    } else {
      setFormData({
        box_number: '',
        location_name: '',
        department: '',
        status: 'UNLOCKED'
      });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-700">
          <h3 className="text-lg font-bold text-slate-100">
            {initialData ? '✏️ Edit Data Box' : '➕ Tambah Unit Box Baru'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg p-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Nomor / Nama Box <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Contoh: BOX-01 / LOTO-PLANT-A"
              value={formData.box_number}
              onChange={(e) => setFormData({ ...formData, box_number: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Lokasi Area Kerja
            </label>
            <input
              type="text"
              placeholder="Contoh: Workshop Pit 1 / Panel Utama"
              value={formData.location_name}
              onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Departemen / Divisi
            </label>
            <input
              type="text"
              placeholder="Contoh: Electrical / Maintenance"
              value={formData.department}
              onChange={(e) => setFormData({ ...formData, department: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-medium transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-emerald-900/20"
            >
              {initialData ? 'Simpan Perubahan' : 'Daftarkan Box'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/**
 * 2. Modal Konfirmasi Perubahan Status Kunci E-LOTO (Lock / Unlock)
 */
export const ModalToggleStatus = ({ isOpen, onClose, onConfirm, box }) => {
  if (!isOpen || !box) return null;

  const willBeLocked = box.status?.toUpperCase() !== 'LOCKED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
        <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center text-3xl mb-4 bg-slate-900/80 border border-slate-700">
          {willBeLocked ? '🔒' : '🔓'}
        </div>

        <h3 className="text-base font-bold text-slate-100">
          Konfirmasi {willBeLocked ? 'Penguncian (Lock)' : 'Pembukaan (Unlock)'}
        </h3>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          Apakah kamu yakin ingin mengubah status unit{' '}
          <span className="font-semibold text-slate-200">{box.box_number}</span> menjadi{' '}
          <span className={`font-bold ${willBeLocked ? 'text-red-400' : 'text-emerald-400'}`}>
            {willBeLocked ? 'LOCKED' : 'UNLOCKED'}
          </span>?
        </p>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-xs font-medium transition-colors"
          >
            Batal
          </button>
          <button
            onClick={() => onConfirm(box.id, willBeLocked ? 'LOCKED' : 'UNLOCKED')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-white transition-colors shadow-lg ${
              willBeLocked
                ? 'bg-red-600 hover:bg-red-500 shadow-red-900/30'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
            }`}
          >
            Ya, Lanjutkan
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 3. Modal Konfirmasi Hapus Data
 */
export const ModalConfirmDelete = ({ isOpen, onClose, onConfirm, itemName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 text-2xl mb-4">
          ⚠️
        </div>

        <h3 className="text-base font-bold text-slate-100">
          Hapus Data Permanen?
        </h3>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          Data <span className="font-semibold text-slate-200">{itemName || 'ini'}</span> akan dihapus dari sistem dan tidak dapat dipulihkan.
        </p>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-xs font-medium transition-colors"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-lg shadow-red-900/30"
          >
            Hapus
          </button>
        </div>
      </div>
    </div>
  );
};