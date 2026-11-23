import React from 'react';
import { edCell } from '../utils/fieldForm';

// Tanda tangan elektronik: tap kartu RFID di box atau persetujuan lewat akun.
export function SignChip({ children, title }) {
  return (
    <span title={title} className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold leading-tight text-emerald-800">
      <i className="fa-solid fa-check shrink-0" aria-hidden="true"></i><span className="truncate">{children}</span>
    </span>
  );
}

export function EdCheck({ checked, onChange, disabled, label, title }) {
  return (
    <td className={`${edCell} text-center`}>
      <label title={title} className={`flex min-h-10 items-center justify-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-amber-50/50'}`}>
        <input type="checkbox" aria-label={label} className="h-5 w-5 accent-red-600" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      </label>
    </td>
  );
}
