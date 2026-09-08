import React from 'react';
import { useApp } from '../context/useApp';
import Avatar from '../components/Avatar';

/**
 * Halaman Kelola Personel (Admin) - Daftar Akun & Buffer RFID
 */
export default function Users() {
  const {
    userDatabase, groupPengawas, groupTeknisi, groupFuelman,
    adminSearchTerm, setAdminSearchTerm,
    showAddUserForm, setShowAddUserForm,
    formAdminNewUser, setFormAdminNewUser,
     setShowEditUserModal,
     setFormEditUser,
    rfidBufferList, subTabAdmin, setSubTabAdmin,
    hwData,
    excelFileInputRef,
    handleIndukTambahUser, handleImportExcel,
    handleBukaModalEditUser,  handleHapusUser,
    handleHapusBuffer, handleProfilePhotoUpload,
  } = useApp();

  return (
    <div className="space-y-6">
      <div className="flex border-b border-gray-200 gap-2 font-mono-tech text-xs">
        <button type="button" onClick={() => setSubTabAdmin('daftar-personel')} className={`px-4 py-2 border-b-2 font-bold ${subTabAdmin === 'daftar-personel' ? 'border-red-600 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
          📁 Daftar Akun Personel
        </button>
        <button type="button" onClick={() => setSubTabAdmin('buffer-rfid')} className={`px-4 py-2 border-b-2 font-bold flex items-center gap-2 ${subTabAdmin === 'buffer-rfid' ? 'border-red-600 text-red-600 bg-red-50' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
          <span>📡 Pindaian Kartu Baru</span>
          {rfidBufferList.length > 0 && <span className="bg-red-600 text-white px-1.5 py-0.2 rounded-full text-[9px] font-bold animate-pulse">{rfidBufferList.length}</span>}
        </button>
      </div>

      {subTabAdmin === 'daftar-personel' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 pb-2">
            <h3 className="text-base font-bold text-red-600 font-mono-tech">Daftar Akun Personel & Karyawan</h3>
            <div className="flex items-center gap-2">
              <input type="file" ref={excelFileInputRef} accept=".xlsx, .xls, .csv" className="hidden" onChange={handleImportExcel} />
              <button type="button" onClick={() => excelFileInputRef.current && excelFileInputRef.current.click()} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold font-mono-tech uppercase flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">
                <i className="fa-solid fa-file-excel"></i> Impor Excel / CSV
              </button>
              <button type="button" onClick={() => setShowAddUserForm(!showAddUserForm)} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold font-mono-tech uppercase shadow-sm active:scale-95 transition-all">
                {showAddUserForm ? 'Tutup Form' : 'Tambah Karyawan'}
              </button>
            </div>
          </div>

          {rfidBufferList.length > 0 && (
            <div className="bg-blue-50 border border-blue-300 p-3 rounded-xl flex items-center justify-between gap-2 text-blue-900 font-mono-tech text-xs">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-satellite-dish text-blue-600 animate-pulse text-sm"></i>
                <span>Ada <b>{rfidBufferList.length} Kartu Baru</b> terdeteksi dari pindaian boks!</span>
              </div>
              <button type="button" onClick={() => setSubTabAdmin('buffer-rfid')} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-[10px] font-bold uppercase">Lihat Kartu</button>
            </div>
          )}

          {showAddUserForm && (
            <form onSubmit={handleIndukTambahUser} className="bg-gray-50 p-5 rounded-2xl border border-gray-200 space-y-4 text-xs font-mono-tech">
              <div className="text-xs font-bold text-red-600 uppercase border-b pb-2">
                <i className="fa-solid fa-user-plus mr-1"></i> Form Pendaftaran Karyawan Baru
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">ID Karyawan (SID)</label>
                  <input type="text" required placeholder="Contoh: FP3US-001" className="w-full bg-white border p-2.5 rounded-lg" value={formAdminNewUser.sid} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, sid: e.target.value })} />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Nama Lengkap</label>
                  <input type="text" required placeholder="Masukkan Nama..." className="w-full bg-white border p-2.5 rounded-lg" value={formAdminNewUser.nama} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, nama: e.target.value })} />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Jabatan</label>
                  <select className="w-full bg-white border p-2.5 rounded-lg font-bold" value={formAdminNewUser.role} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, role: e.target.value })}>
                    <option value="teknisi">TEKNISI / MEKANIK</option>
                    <option value="pengawas">PENGAWAS K3 (SUPERVISOR)</option>
                    <option value="fuelman">PETUGAS BBM (FUELMAN)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 mb-1 font-bold">Kode Kartu RFID</label>
                  <div className="flex gap-1">
                    <input type="text" placeholder="UID Kartu..." className="w-full bg-white border p-2.5 rounded-lg uppercase" value={formAdminNewUser.rfidUid} onChange={(e) => setFormAdminNewUser({ ...formAdminNewUser, rfidUid: e.target.value })} />
                    <button type="button" onClick={() => setFormAdminNewUser({ ...formAdminNewUser, rfidUid: (hwData.last_uid && hwData.last_uid !== '—' && hwData.last_uid !== 'SYSTEM') ? hwData.last_uid : '' })} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-2.5 rounded-lg font-bold text-xs shadow-sm">Ambil</button>
                  </div>
                </div>
                <div className="sm:col-span-2 md:col-span-4">
                  <label className="block text-slate-700 mb-1 font-bold">Password awal</label>
                  <input type="password" readOnly autoComplete="new-password" className="w-full bg-slate-100 border p-2.5 rounded-lg mb-1 text-slate-600" value={formAdminNewUser.sid} placeholder="Otomatis mengikuti SID" />
                  <p className="text-[10px] text-amber-700">Terisi otomatis sama dengan SID. User dapat menggantinya dari halaman profil.</p>
                  <label className="block text-slate-700 mb-1 font-bold">Foto Profil</label>
                  <input type="file" accept="image/*" className="w-full mt-2 text-[10px]" onChange={(e) => handleProfilePhotoUpload(e, setFormAdminNewUser)} />
                  {formAdminNewUser.foto && formAdminNewUser.foto.startsWith('data:') && <div className="mt-2 flex justify-center"><div className="rounded-full bg-white p-1.5 shadow-md ring-2 ring-red-100"><Avatar profile={{ nama: formAdminNewUser.nama, foto: formAdminNewUser.foto }} className="w-20 h-20" /></div></div>}
                </div>
              </div>
              <div className="flex justify-end pt-2 border-t">
                <button type="submit" className="bg-red-600 text-white font-bold px-6 py-2.5 rounded-xl uppercase">Simpan Akun</button>
              </div>
            </form>
          )}

          <div className="bg-white border border-gray-200 p-2.5 rounded-xl shadow-sm flex items-center gap-2 max-w-md">
            <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
            <input type="text" placeholder="Cari nama atau ID karyawan..." className="w-full bg-transparent text-xs focus:outline-none font-sans" value={adminSearchTerm} onChange={(e) => setAdminSearchTerm(e.target.value)} />
            {adminSearchTerm && <button type="button" onClick={() => setAdminSearchTerm('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">Clear</button>}
          </div>

          {/* 3 KOLOM KELOMPOK DIVISI PERSONEL */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono-tech text-xs">
            {/* PENGAWAS K3 */}
            <div className="bg-white border border-gray-200 p-4 rounded-xl space-y-2 shadow-sm">
              <h5 className="font-bold text-red-600 border-b pb-2">👮 PENGAWAS K3 ({groupPengawas.length})</h5>
              {groupPengawas.map(u => (
                <div key={u.sid} onClick={() => handleBukaModalEditUser(u)} className="p-2.5 rounded-lg border bg-gray-50 flex justify-between items-center hover:border-red-400 cursor-pointer transition-colors">
                  <Avatar profile={u} className="w-9 h-9" />
                  <div className="truncate flex-1 pl-2">
                    <p className="font-bold text-slate-950 truncate">{u.nama}</p>
                    <p className="text-[10px] text-slate-500">SID: {u.sid} | RFID: <span className="font-bold">{u.rfidUid || '—'}</span></p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleBukaModalEditUser(u); }} className="text-slate-400 hover:text-blue-600 p-1"><i className="fa-solid fa-pen-to-square"></i></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusUser(u.sid); }} className="text-slate-400 hover:text-red-600 p-1"><i className="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
              ))}
            </div>

            {/* TEKNISI / MEKANIK */}
            <div className="bg-white border border-gray-200 p-4 rounded-xl space-y-2 shadow-sm">
              <h5 className="font-bold text-red-600 border-b pb-2">🔧 TEKNISI / MEKANIK ({groupTeknisi.length})</h5>
              {groupTeknisi.map(u => (
                <div key={u.sid} onClick={() => handleBukaModalEditUser(u)} className="p-2.5 rounded-lg border bg-gray-50 flex justify-between items-center hover:border-red-400 cursor-pointer transition-colors">
                  <Avatar profile={u} className="w-9 h-9" />
                  <div className="truncate flex-1 pl-2">
                    <p className="font-bold text-slate-950 truncate">{u.nama}</p>
                    <p className="text-[10px] text-slate-500">SID: {u.sid} | RFID: <span className="font-bold">{u.rfidUid || '—'}</span></p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleBukaModalEditUser(u); }} className="text-slate-400 hover:text-blue-600 p-1"><i className="fa-solid fa-pen-to-square"></i></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusUser(u.sid); }} className="text-slate-400 hover:text-red-600 p-1"><i className="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
              ))}
            </div>

            {/* PETUGAS BBM */}
            <div className="bg-white border border-gray-200 p-4 rounded-xl space-y-2 shadow-sm">
              <h5 className="font-bold text-red-600 border-b pb-2">⛽ PETUGAS BBM ({groupFuelman.length})</h5>
              {groupFuelman.map(u => (
                <div key={u.sid} onClick={() => handleBukaModalEditUser(u)} className="p-2.5 rounded-lg border bg-gray-50 flex justify-between items-center hover:border-red-400 cursor-pointer transition-colors">
                  <Avatar profile={u} className="w-9 h-9" />
                  <div className="truncate flex-1 pl-2">
                    <p className="font-bold text-slate-950 truncate">{u.nama}</p>
                    <p className="text-[10px] text-slate-500">SID: {u.sid} | RFID: <span className="font-bold">{u.rfidUid || '—'}</span></p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleBukaModalEditUser(u); }} className="text-slate-400 hover:text-blue-600 p-1"><i className="fa-solid fa-pen-to-square"></i></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleHapusUser(u.sid); }} className="text-slate-400 hover:text-red-600 p-1"><i className="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* BUFFER RFID */}
      {subTabAdmin === 'buffer-rfid' && (
        <div className="space-y-4 font-mono-tech">
          <div className="flex justify-between items-center border-b pb-2">
            <div>
              <h3 className="text-base font-bold text-blue-700 uppercase flex items-center gap-2">
                <i className="fa-solid fa-satellite-dish text-blue-600 animate-pulse"></i>
                <span>Pindaian Kartu Baru yang Belum Terdaftar</span>
              </h3>
              <p className="text-xs text-slate-600 font-sans mt-0.5">Daftar kartu RFID fisik yang ditempelkan di boks dan siap ditautkan ke akun karyawan.</p>
            </div>
            <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold uppercase">{rfidBufferList.length} Kartu Terbaca</span>
          </div>

          {rfidBufferList.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {rfidBufferList.map((item) => (
                <div key={item.id} className="bg-white border-2 border-blue-200 p-3.5 rounded-2xl flex items-center justify-between shadow-sm hover:border-blue-500 transition-colors">
                  <div>
                    <p className="font-black text-blue-900 text-sm">{item.rfid_uid}</p>
                    <p className="text-[10px] text-slate-500 font-sans mt-0.5">Unit: {item.id_box}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => {
                      const target = userDatabase.find(u => !u.rfidUid);
                      if (target) {
                        setFormEditUser({ sid: target.sid, nama: target.nama, role: target.role, rfidUid: item.rfid_uid, foto: target.foto });
                        setShowEditUserModal(true);
                      } else {
                        window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg: 'Pilih karyawan di daftar personel untuk menautkan kartu ini!', type: 'ok' } }));
                        setSubTabAdmin('daftar-personel');
                      }
                    }} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold uppercase">Tautkan</button>
                    <button type="button" onClick={() => handleHapusBuffer(item.id)} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors" title="Hapus">
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 p-12 rounded-2xl text-center space-y-2">
              <i className="fa-solid fa-id-card text-slate-300 text-4xl"></i>
              <p className="text-sm font-bold text-slate-700">Belum Ada Kartu Baru yang Terbaca</p>
              <p className="text-xs text-slate-500 font-sans">Tekan Tombol 3 di boks untuk membaca kartu RFID fisik baru.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
