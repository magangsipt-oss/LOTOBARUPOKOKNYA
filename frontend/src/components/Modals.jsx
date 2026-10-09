import React, { useRef, useEffect } from 'react';
import Avatar from './Avatar';
import { safeToFixed } from '../utils/helpers';

/**
 * Modal Umum Besar - menampilkan konten dinamis
 */
export function ModalUmum({ modalInfo, onClose }) {
  if (!modalInfo.open) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-red-200 w-full max-w-4xl rounded-2xl p-6 sm:p-8 shadow-2xl space-y-4 max-h-[90vh] flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 text-red-600 font-bold font-mono-tech text-base">
            <i className={`fa-solid ${modalInfo.icon || 'fa-circle-info'} text-lg`}></i>
            <span className="uppercase tracking-wide">{modalInfo.title}</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl font-bold">&times;</button>
        </div>
        <div className="text-xs text-slate-700 space-y-4 overflow-y-auto pr-1 flex-1">
          {modalInfo.content}
        </div>
        <div className="pt-3 flex justify-end border-t border-gray-200 shrink-0">
          <button type="button" onClick={onClose} className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl font-mono-tech text-xs uppercase shadow-md active:scale-95 transition-all">Tutup</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal Status Radar - diagnostik perangkat
 */
export function ModalRadar({ show, onClose, boxes, radarModalSearch, setRadarModalSearch, radarDetailBox, setRadarDetailBox, onSelectBox }) {
  const filteredBoxesInModal = Array.isArray(boxes)
    ? boxes.filter(b =>
      String(b.id || '').toLowerCase().includes(radarModalSearch.toLowerCase()) ||
      String(b.unit || '').toLowerCase().includes(radarModalSearch.toLowerCase()) ||
      String(b.ip || '').toLowerCase().includes(radarModalSearch.toLowerCase()) ||
      String(b.ssid || '').toLowerCase().includes(radarModalSearch.toLowerCase())
    )
    : [];

  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-red-200 w-full max-w-4xl rounded-2xl p-6 sm:p-8 shadow-2xl space-y-4 max-h-[90vh] flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 text-red-600 font-bold font-mono-tech text-base">
            <i className="fa-solid fa-satellite-dish text-lg"></i>
            <span className="uppercase tracking-wide">
              {radarDetailBox ? `Diagnostik Perangkat: ${radarDetailBox.id}` : 'Pilih Unit Boks Untuk Pantau Radar'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl font-bold">&times;</button>
        </div>
        <div className="text-xs text-slate-700 space-y-4 overflow-y-auto pr-1 flex-1">
          {radarDetailBox ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setRadarDetailBox(null)} className="text-red-600 hover:text-red-700 font-bold text-xs font-mono-tech flex items-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors">
                  <i className="fa-solid fa-arrow-left"></i> Pilih Boks Lain
                </button>
                <span className="text-[11px] text-slate-500 font-mono-tech">Unit ID: <b>{radarDetailBox.id}</b></span>
              </div>
              <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-sm">
                <table className="w-full text-left border-collapse text-xs font-mono-tech">
                  <thead>
                    <tr className="bg-gray-100 text-slate-800 border-b border-gray-200">
                      <th className="p-3 w-1/3 border-r border-gray-200">Parameter Sensor</th>
                      <th className="p-3">Nilai Real-Time / Status Perangkat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Unit Boks</td><td className="p-3 font-bold text-red-600">{radarDetailBox.id} ({radarDetailBox.unit})</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Status Jaringan Radar</td><td className="p-3">{Number(radarDetailBox.is_online) === 1 ? <span className="bg-green-50 text-green-700 border border-green-300 px-2 py-0.5 rounded font-bold">ONLINE (Tersinkron)</span> : <span className="bg-red-50 text-red-600 border border-red-300 px-2 py-0.5 rounded font-bold">OFFLINE (Standby)</span>}</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">IP Address Boks</td><td className="p-3 text-blue-600 font-bold">{radarDetailBox.ip || '192.168.1.100'}</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Nama Wi-Fi (SSID)</td><td className="p-3 font-bold text-slate-900">{radarDetailBox.ssid || 'Wi-Fi Hotspot'}</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Lama Alat Nyala (Uptime)</td><td className="p-3">{Math.round(Number(radarDetailBox.uptime_ms || 0) / 1000)} Detik ({Math.floor(Number(radarDetailBox.uptime_ms || 0) / 60000)} Menit)</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Aktivitas Terakhir</td><td className="p-3 font-bold text-slate-800">{radarDetailBox.last_event || 'SYS_INIT'}</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Koordinat Lokasi GPS</td><td className="p-3 text-slate-700 font-mono">{safeToFixed(radarDetailBox.lat, 6)}, {safeToFixed(radarDetailBox.lng, 6)}</td></tr>
                    <tr><td className="p-3 bg-gray-50 font-bold border-r">Status Penguncian</td><td className="p-3">{radarDetailBox.state || 'STATE_IDLE'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
                <p className="text-xs font-semibold text-slate-600">Pilih salah satu boks di bawah untuk melihat rincian diagnostik sensor hardware:</p>
                <span className="text-xs font-mono font-bold text-red-600 bg-white px-2.5 py-1 rounded border border-red-200">{filteredBoxesInModal.length} Unit Ditemukan</span>
              </div>
              <div className="bg-white border border-gray-300 p-2.5 rounded-xl shadow-sm flex items-center gap-2">
                <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs"></i>
                <input type="text" placeholder="Cari nama unit, ID boks, atau IP address..." className="w-full bg-transparent text-xs text-slate-950 focus:outline-none font-mono-tech" value={radarModalSearch} onChange={(e) => setRadarModalSearch(e.target.value)} />
                {radarModalSearch && <button type="button" onClick={() => setRadarModalSearch('')} className="text-slate-400 hover:text-red-600 text-[10px] uppercase font-bold font-mono-tech">Clear</button>}
              </div>
              <div className="space-y-3 pt-1">
                {filteredBoxesInModal.length > 0 ? filteredBoxesInModal.map((b) => {
                  const isOnline = Number(b.is_online) === 1;
                  return (
                    <div key={b.id} onClick={() => { onSelectBox(b); setRadarDetailBox(b); }} className="bg-white border-2 border-red-200 hover:border-red-500 p-4 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group" title="Klik untuk membuka tabel sensor telemetri boks ini">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <i className="fa-solid fa-location-dot text-red-600 text-sm"></i>
                          <span className="font-black text-slate-950 text-sm font-mono-tech group-hover:text-red-600 transition-colors">{b.id}</span>
                          <span className={`px-2 py-0.2 rounded text-[8px] font-bold uppercase border font-mono-tech ml-2 ${isOnline ? 'bg-green-50 text-green-700 border-green-300' : 'bg-gray-50 text-slate-500 border-gray-200'}`}>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                        </div>
                        <p className="text-xs font-semibold text-slate-700 font-sans pl-5">Mesin: <span className="text-slate-950 font-bold">{b.unit}</span></p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="flex items-center gap-3 text-[11px] font-mono-tech text-slate-600 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
                          <span><i className="fa-solid fa-network-wired text-blue-600 mr-1"></i> {b.ip || '192.168.1.100'}</span>
                          <span className="text-slate-300">|</span>
                          <span><i className="fa-solid fa-wifi text-slate-400 mr-1"></i> {b.ssid || 'Hotspot'}</span>
                        </div>
                        <div className="text-[11px] text-red-600 font-bold font-mono-tech group-hover:translate-x-1 transition-transform whitespace-nowrap"><span>Diagnostik &rarr;</span></div>
                      </div>
                    </div>
                  );
                }) : <div className="text-center py-10 text-slate-400 italic font-sans bg-gray-50 rounded-xl border">Tidak ada boks yang sesuai dengan pencarian.</div>}
              </div>
            </div>
          )}
        </div>
        <div className="pt-3 flex justify-end border-t border-gray-200 shrink-0">
          <button type="button" onClick={onClose} className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl font-mono-tech text-xs uppercase shadow-md active:scale-95 transition-all">Tutup</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal Crop Foto Profil
 */
export function ModalCropPhoto({ cropPhotoSrc, onConfirm, onCancel }) {
  const cropImageRef = useRef(null);
  const cropperRef = useRef(null);

  useEffect(() => {
    if (!cropPhotoSrc || !cropImageRef.current) return undefined;
    // Dynamic import CropperJS
    import('cropperjs').then(({ default: Cropper }) => {
      cropperRef.current = new Cropper(cropImageRef.current, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.85,
        responsive: true,
        background: false
      });
    });
    return () => {
      if (cropperRef.current) {
        cropperRef.current.destroy();
        cropperRef.current = null;
      }
    };
  }, [cropPhotoSrc]);

  const handleConfirm = () => {
    if (!cropperRef.current) return;
    const croppedCanvas = cropperRef.current.getCroppedCanvas({ width: 600, height: 600, imageSmoothingQuality: 'high' });
    onConfirm(croppedCanvas.toDataURL('image/jpeg', 0.92));
  };

  if (!cropPhotoSrc) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white border border-red-200 w-full max-w-xl rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3">
          <div className="flex items-center gap-2 text-red-600 font-bold font-mono-tech text-sm">
            <i className="fa-solid fa-crop-simple"></i>
            <span>SESUAIKAN FOTO PROFIL</span>
          </div>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-2xl font-bold">&times;</button>
        </div>
        <div className="h-[min(65vh,420px)] overflow-hidden rounded-xl bg-slate-100 border border-slate-200">
          <img ref={cropImageRef} src={cropPhotoSrc} alt="Pratinjau crop foto profil" className="block max-w-full" />
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold rounded-lg font-mono-tech text-xs">Batal</button>
          <button type="button" onClick={handleConfirm} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-black rounded-lg font-mono-tech text-xs uppercase"><i className="fa-solid fa-check mr-1"></i>Gunakan Foto</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal Edit Personel
 */
export function ModalEditUser({ show, onClose, formEditUser, setFormEditUser, onSubmit, hwData, onUploadPhoto }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-red-200 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2 text-red-600 font-bold font-mono-tech text-sm">
            <i className="fa-solid fa-user-pen"></i>
            <span>EDIT DATA PERSONEL & KARTU RFID</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 text-xs">
          {formEditUser.foto && <div className="flex justify-center pb-2"><Avatar profile={{ nama: formEditUser.nama, foto: formEditUser.foto }} className="w-28 h-28" /></div>}
          <div>
            <label className="block text-slate-700 font-bold mb-1">ID Karyawan (SID):</label>
            <input type="text" readOnly className="w-full bg-gray-100 border border-gray-300 rounded-lg p-2.5 text-slate-600 font-mono font-bold cursor-not-allowed" value={formEditUser.sid} />
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">Nama Lengkap:</label>
            <input type="text" required placeholder="Masukkan Nama Lengkap" className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-red-500 font-sans font-semibold" value={formEditUser.nama} onChange={(e) => setFormEditUser({ ...formEditUser, nama: e.target.value })} />
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">Jabatan:</label>
            <select className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:border-red-500 font-bold" value={formEditUser.role} onChange={(e) => setFormEditUser({ ...formEditUser, role: e.target.value })}>
              <option value="teknisi">TEKNISI / MEKANIK</option>
              <option value="pengawas">PENGAWAS K3 (SUPERVISOR)</option>
              <option value="fuelman">PETUGAS BBM (FUELMAN)</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">Kode Kartu RFID:</label>
            <div className="flex gap-2">
              <input type="text" placeholder="Ketik atau tempelkan kartu..." className="flex-1 bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-slate-900 font-mono font-bold uppercase focus:outline-none focus:border-red-500" value={formEditUser.rfidUid} onChange={(e) => setFormEditUser({ ...formEditUser, rfidUid: e.target.value })} />
              <button type="button" onClick={() => setFormEditUser({ ...formEditUser, rfidUid: (hwData.last_uid && hwData.last_uid !== '—' && hwData.last_uid !== 'SYSTEM') ? hwData.last_uid : '' })} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 px-3 py-2 rounded-lg font-mono-tech font-bold text-xs flex items-center gap-1 shrink-0">
                <i className="fa-solid fa-satellite-dish"></i> Ambil
              </button>
            </div>
            {hwData.last_uid && hwData.last_uid !== '—' && hwData.last_uid !== 'SYSTEM' && <p className="text-[10px] text-blue-600 font-mono mt-1">Pindaian Boks Terakhir: <b>{hwData.last_uid}</b></p>}
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">Foto Profil:</label>
            <input type="file" accept="image/*" className="w-full mt-2 text-[10px]" onChange={(e) => onUploadPhoto(e, setFormEditUser)} />
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-slate-700 font-bold rounded-lg font-mono-tech">Batal</button>
            <button type="submit" className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-black rounded-lg font-mono-tech uppercase shadow-md">Simpan</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Dokumen Cetak PDF K3
 */
export function PrintDocument({ printActiveLog }) {
  if (!printActiveLog) return null;
  return (
    <div className="print-show hidden p-8 bg-white font-sans text-slate-900">
      <div className="border-2 border-red-600 p-6 rounded-lg space-y-4">
        <div className="border-b-2 border-red-600 pb-3 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-black text-red-600 uppercase font-mono-tech">MANIFES K3 INDUSTRI - LAPORAN E-LOTO</h1>
            <p className="text-xs text-slate-600 font-bold uppercase">Dokumen Resmi Lembar Pemeliharaan Alat Berat</p>
          </div>
          <div className="text-right text-xs font-mono">
            <p><b>Waktu:</b> {printActiveLog.waktu || '—'}</p>
            <p><b>ID Laporan:</b> #{printActiveLog.id}</p>
          </div>
        </div>
        <table className="w-full text-xs border-collapse border border-slate-300">
          <tbody>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100 w-1/3">Nama Box / Unit Mesin</td><td className="p-2.5 font-bold text-red-600 uppercase">{printActiveLog.mesin}</td></tr>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100">Mekanik Penanggung Jawab</td><td className="p-2.5 font-semibold">{printActiveLog.teknisi}</td></tr>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100">Pengawas K3 Penanggung Jawab</td><td className="p-2.5 font-semibold">{printActiveLog.pengawas || '—'}</td></tr>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100">Klasifikasi Gangguan</td><td className="p-2.5">{printActiveLog.jenis}</td></tr>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100">Estimasi Waktu</td><td className="p-2.5">{printActiveLog.estimasi}</td></tr>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100">Status Akhir</td><td className="p-2.5 font-bold uppercase">{printActiveLog.status}</td></tr>
            <tr className="border-b"><td className="p-2.5 font-bold bg-slate-100">Deskripsi Perbaikan</td><td className="p-2.5 whitespace-pre-wrap">{printActiveLog.deskripsi}</td></tr>
          </tbody>
        </table>
        {printActiveLog.foto && (
          <div className="pt-2">
            <p className="text-xs font-bold mb-2 text-slate-700">Foto Bukti Kerusakan di Lapangan:</p>
            <img src={printActiveLog.foto} alt="Bukti Lapangan" className="max-h-56 border rounded-lg object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}
