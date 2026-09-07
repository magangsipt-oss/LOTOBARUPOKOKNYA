import React, { useState, useEffect } from 'react';
import userService from '../services/userService';
import { ModalConfirmDelete } from '../components/Modals';

/**
 * Halaman Manajemen Pengguna E-LOTO
 */
const Users = () => {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // State Modal Form & Hapus
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userToDeleteId, setUserToDeleteId] = useState(null);

  // State Input Form
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    card_number: '',
    role: 'WORKER',
    department: '',
  });
  const [profilePhoto, setProfilePhoto] = useState(null);

  // 1. Mengambil data seluruh pengguna dari backend
  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const response = await userService.getAllUsers();
      if (response && response.success) {
        setUsers(response.data || []);
      }
    } catch (error) {
      console.error('Gagal mengambil data user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // 2. Handler Buka Modal Form (Tambah / Edit)
  const handleOpenForm = (user = null) => {
    if (user) {
      setSelectedUser(user);
      setFormData({
        name: user.name || '',
        username: user.username || '',
        card_number: user.card_number || '',
        role: user.role || 'WORKER',
        department: user.department || '',
      });
    } else {
      setSelectedUser(null);
      setFormData({
        name: '',
        username: '',
        card_number: '',
        role: 'WORKER',
        department: '',
      });
    }
    setProfilePhoto(null);
    setIsFormOpen(true);
  };

  // 3. Handler Simpan Data (Create / Update)
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    try {
      const payload = new FormData();
      payload.append('name', formData.name);
      payload.append('username', formData.username);
      payload.append('card_number', formData.card_number);
      payload.append('role', formData.role);
      payload.append('department', formData.department);

      if (profilePhoto) {
        payload.append('profile_photo', profilePhoto);
      }

      if (selectedUser) {
        await userService.updateUser(selectedUser.id, payload);
      } else {
        await userService.createUser(payload);
      }

      setIsFormOpen(false);
      fetchUsers();
    } catch (error) {
      alert('Gagal menyimpan pengguna: ' + (error.response?.data?.message || error.message));
    }
  };

  // 4. Handler Hapus Pengguna
  const handleConfirmDelete = async () => {
    try {
      if (userToDeleteId) {
        await userService.deleteUser(userToDeleteId);
        setIsDeleteOpen(false);
        setUserToDeleteId(null);
        fetchUsers();
      }
    } catch (error) {
      alert('Gagal menghapus pengguna: ' + (error.response?.data?.message || error.message));
    }
  };

  // 5. Filter Pencarian & Peran
  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.card_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.department?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === 'ALL' || user.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      {/* Baris Atas: Judul & Tombol Tambah */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">
            Manajemen Pengguna & Akses RFID
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Kelola data teknisi lapangan, pengawas, dan integrasi nomor kartu RFID
          </p>
        </div>

        <button
          onClick={() => handleOpenForm()}
          className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-lg shadow-emerald-900/20"
        >
          <span>➕</span>
          <span>Daftarkan Pengguna</span>
        </button>
      </div>

      {/* Filter & Pencarian */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="w-full md:w-80 relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
            🔍
          </span>
          <input
            type="text"
            placeholder="Cari nama, kartu RFID, divisi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs text-slate-400 whitespace-nowrap">Filter Role:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">Semua Peran</option>
            <option value="WORKER">Pekerja (Worker)</option>
            <option value="SUPERVISOR">Supervisor</option>
          </select>
        </div>
      </div>

      {/* Tabel Data Pengguna */}
      {isLoading ? (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-slate-400">Memuat data pengguna...</p>
        </div>
      ) : (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-700 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-3.5">Profil</th>
                  <th className="px-5 py-3.5">Nama & Username</th>
                  <th className="px-5 py-3.5">UID Kartu RFID</th>
                  <th className="px-5 py-3.5">Peran (Role)</th>
                  <th className="px-5 py-3.5">Departemen</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-12 text-slate-500">
                      Tidak ada data pengguna yang sesuai.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-5 py-3">
                        <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center border border-slate-600">
                          {user.profile_photo ? (
                            <img
                              src={`${import.meta.env.VITE_API_URL}/users/photo/${encodeURIComponent(user.rfid_uid || user.rfidUid || user.card_number || user.username || user.sid)}`}
                              alt={user.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'https://via.placeholder.com/100?text=User';
                              }}
                            />
                          ) : (
                            <span className="text-base">👤</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-100">{user.name}</p>
                        <p className="text-[11px] text-slate-400">@{user.username || '-'}</p>
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-slate-200">
                        💳 {user.card_number}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            user.role === 'SUPERVISOR'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-300">
                        {user.department || '-'}
                      </td>
                      <td className="px-5 py-3 text-right space-x-2">
                        <button
                          onClick={() => handleOpenForm(user)}
                          className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-[11px] font-medium transition-colors"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => {
                            setUserToDeleteId(user.id);
                            setIsDeleteOpen(true);
                          }}
                          className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-[11px] font-medium transition-colors"
                        >
                          🗑️ Hapus
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Form Tambah / Edit Pengguna */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-slate-100">
                {selectedUser ? '✏️ Edit Data Pengguna' : '➕ Daftarkan Pengguna Baru'}
              </h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-lg p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="mt-4 space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nama Lengkap <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: John Doe"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  placeholder="Contoh: johndoe"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  UID Kartu RFID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: 1234567890"
                  value={formData.card_number}
                  onChange={(e) => setFormData({ ...formData, card_number: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Peran (Role)
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="WORKER">WORKER</option>
                    <option value="SUPERVISOR">SUPERVISOR</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Departemen
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Mekanik"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Foto Profil (Opsional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setProfilePhoto(e.target.files[0])}
                  className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-medium transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-emerald-900/20"
                >
                  {selectedUser ? 'Simpan' : 'Daftarkan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Hapus */}
      <ModalConfirmDelete
        isOpen={isDeleteOpen}
        onClose={() => {
          setIsDeleteOpen(false);
          setUserToDeleteId(null);
        }}
        onConfirm={handleConfirmDelete}
        itemName={`Pengguna ID #${userToDeleteId}`}
      />
    </div>
  );
};

export default Users;