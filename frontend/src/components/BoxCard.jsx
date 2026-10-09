import React from 'react';

/**
 * Komponen Kartu Box untuk daftar box di sidebar Dashboard
 */
export default function BoxCard({ box, isSelected, isHwOnline, hwData, sessionUser, onSelect, onEdit, onDelete }) {
  const isCurrentSelected = isSelected && String(isSelected.id).toLowerCase().trim() === String(box.id).toLowerCase().trim();
  const isThisBoxLocked = box.state && box.state !== 'STATE_IDLE' && box.state !== 'STATE_REGISTER_RFID';
  const isBoxOnlineInDb = Number(box.is_online) === 1;

  let badgeText = "STANDBY";
  let badgeStyle = "bg-green-50 text-green-600 border-green-200";
  if (isCurrentSelected) {
    if (!isHwOnline) {
      badgeText = "OFFLINE";
      badgeStyle = "bg-gray-100 text-gray-500 border-gray-200 font-normal";
    } else if (hwData.state === 'STATE_REGISTER_RFID') {
      badgeText = "DAFTAR KARTU";
      badgeStyle = "bg-blue-600 text-white border-blue-700 font-bold animate-pulse";
    } else if (hwData.state && hwData.state !== 'STATE_IDLE') {
      badgeText = "TERKUNCI";
      badgeStyle = "bg-red-600 text-white border-red-700 font-bold animate-pulse";
    }
  } else {
    if (!isBoxOnlineInDb) {
      badgeText = "OFFLINE";
      badgeStyle = "bg-gray-100 text-gray-500 border-gray-200 font-normal";
    } else if (box.state === 'STATE_REGISTER_RFID') {
      badgeText = "DAFTAR KARTU";
      badgeStyle = "bg-blue-600 text-white border-blue-700 font-bold animate-pulse";
    } else if (isThisBoxLocked) {
      badgeText = "TERKUNCI";
      badgeStyle = "bg-red-600 text-white border-red-700 font-bold animate-pulse";
    }
  }

  return (
    <div
      onClick={() => onSelect(box)}
      className={`p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all hover:border-red-400 ${
        isCurrentSelected ? 'bg-red-50/50 border-red-500 shadow-sm' : 'bg-white border-gray-200'
      }`}
    >
      <div className="truncate text-xs font-mono-tech">
        <p className="font-bold text-slate-950 flex items-center gap-1.5">
          <i className="fa-solid fa-location-dot text-red-600"></i> {box.id}
        </p>
        <p className="text-slate-600 text-[10px] font-sans mt-0.5 truncate">
          Unit: <span className="text-slate-950 font-semibold">{box.unit}</span>
        </p>
        <p className="text-[10px] text-blue-600 font-mono font-bold mt-0.5">
          <i className="fa-solid fa-network-wired"></i> IP: {box.ip || '192.168.1.100'} | <i className="fa-solid fa-wifi text-[9px] text-slate-500"></i> SSID: <span className="text-slate-950 font-black">{box.ssid || 'Wi-Fi Hotspot'}</span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono border ${badgeStyle}`}>{badgeText}</span>
        {sessionUser?.role === 'admin' && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(box); }} className="text-slate-500 hover:text-blue-600 p-1 rounded transition-colors" title="Edit data boks">
              <i className="fa-solid fa-pen-to-square"></i>
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(box.id); }} className="text-slate-500 hover:text-red-600 p-1 rounded transition-colors" title="Hapus boks">
              <i className="fa-solid fa-trash-can"></i>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
