import React from 'react';
import { useApp } from '../context/useApp';
import Avatar from '../components/Avatar';

/**
 * Halaman Tim Mekanik (Pengawas) - Penugasan mekanik per box
 */
export default function Supervisors() {
  const {
    sessionUser, boxes, groupTeknisi, filteredTeamMechanics,
    teamBoxId, setTeamBoxId, teamMaintenanceType, setTeamMaintenanceType,
    mechanicSearchTerm, setMechanicSearchTerm,
    selectedMechanicSids, setSelectedMechanicSids,
    handleSaveMechanicTeam
  } = useApp();

  if (sessionUser?.role !== 'pengawas') return null;

  return (
    <div className="w-full space-y-6">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-base sm:text-lg font-bold text-red-600 font-mono-tech uppercase"><i className="fa-solid fa-people-group mr-2"></i>Tim Mekanik Per Box</h1>
        <p className="text-xs text-slate-500 mt-1">Tentukan mekanik yang akan dibawa oleh pengawas pada setiap box pekerjaan.</p>
      </div>
      <form onSubmit={handleSaveMechanicTeam} className="bg-white border border-red-200 rounded-2xl shadow-sm p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-red-100 pb-3">
          <div><h2 className="font-bold text-slate-800 uppercase font-mono-tech">Penugasan Mekanik</h2><p className="text-[10px] text-slate-500 mt-1">Pilihan disimpan ke database berdasarkan pengawas dan box.</p></div>
          <span className="text-[10px] font-bold text-red-600 font-mono-tech">{selectedMechanicSids.length} Dipilih</span>
        </div>
        <div>
          <label className="block text-slate-700 mb-1 font-semibold">Box Pekerjaan</label>
          <select required value={teamBoxId} onChange={(e) => setTeamBoxId(e.target.value)} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 font-bold focus:outline-none focus:border-red-500">
            <option value="">Pilih box...</option>
            {boxes.map(box => <option key={box.id} value={box.id}>{box.id}{box.unit ? ` - ${box.unit}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-700 mb-1 font-semibold">Jenis Maintenance</label>
          <select required value={teamMaintenanceType} onChange={(e) => setTeamMaintenanceType(e.target.value)} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 font-bold focus:outline-none focus:border-red-500">
            <option value="Mekanikal">Mekanikal</option>
            <option value="Elektrikal">Elektrikal</option>
            <option value="Hidrolik">Hidrolik</option>
          </select>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 bg-gray-50 border border-gray-300 px-3 py-2 rounded-xl flex items-center gap-2">
            <i className="fa-solid fa-magnifying-glass text-slate-400"></i>
            <input type="search" value={mechanicSearchTerm} onChange={(e) => setMechanicSearchTerm(e.target.value)} placeholder="Cari nama, SID, atau RFID mekanik..." className="w-full bg-transparent text-xs text-slate-900 focus:outline-none" />
            {mechanicSearchTerm && <button type="button" onClick={() => setMechanicSearchTerm('')} className="text-slate-400 hover:text-red-600 font-bold">&times;</button>}
          </div>
          <button type="button" onClick={() => setSelectedMechanicSids(prev => [...new Set([...prev, ...filteredTeamMechanics.map(user => user.sid)])])} disabled={filteredTeamMechanics.length === 0} className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-xl font-bold text-[10px] uppercase disabled:opacity-40">Pilih Hasil</button>
          <button type="button" onClick={() => setSelectedMechanicSids([])} disabled={selectedMechanicSids.length === 0} className="bg-gray-100 border border-gray-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-[10px] uppercase disabled:opacity-40">Kosongkan</button>
        </div>
        {groupTeknisi.length > 0 ? (
          filteredTeamMechanics.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredTeamMechanics.map(user => (
                <label key={user.sid} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:border-red-300">
                  <input type="checkbox" className="w-4 h-4 accent-red-600" checked={selectedMechanicSids.includes(user.sid)} onChange={(e) => setSelectedMechanicSids(prev => e.target.checked ? [...new Set([...prev, user.sid])] : prev.filter(sid => sid !== user.sid))} />
                  <Avatar profile={user} className="w-10 h-10" />
                  <span className="min-w-0"><span className="block font-bold truncate">{user.nama}</span><span className="block text-[10px] text-slate-500">SID: {user.sid}</span></span>
                </label>
              ))}
            </div>
          ) : <p className="text-center text-slate-500 italic py-8">Mekanik tidak ditemukan.</p>
        ) : <p className="text-center text-slate-500 italic py-8">Belum ada mekanik terdaftar.</p>}
        <div className="flex justify-end border-t border-gray-100 pt-4"><button type="submit" className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-xl font-bold font-mono-tech uppercase"><i className="fa-solid fa-floppy-disk mr-2"></i>Simpan Tim Untuk Box</button></div>
      </form>
    </div>
  );
}
