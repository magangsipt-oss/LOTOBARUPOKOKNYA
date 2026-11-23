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

const TASK_STYLE = {
  darurat: ['border-red-300 bg-red-50 text-red-900', 'fa-triangle-exclamation text-red-600'],
  tinggi: ['border-amber-300 bg-amber-50 text-amber-900', 'fa-bell text-amber-600'],
  normal: ['border-sky-200 bg-sky-50 text-sky-900', 'fa-pen-to-square text-sky-600']
};

// Kotak "Tugas Anda": formulir yang menunggu tindakan pengguna ini, paling mendesak di atas.
export function TaskPanel({ tasks, onOpen }) {
  if (!tasks?.length) return null;
  return (
    <section aria-label="Tugas Anda" className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <i className="fa-solid fa-inbox text-red-600" aria-hidden="true"></i>Tugas Anda
        <span className="rounded-full bg-red-600 px-2 text-[11px] font-black leading-5 text-white">{tasks.length}</span>
      </h2>
      <ul className="space-y-2">
        {tasks.map(task => {
          const [box, icon] = TASK_STYLE[task.prioritas] || TASK_STYLE.normal;
          return (
            <li key={task.id}>
              <button type="button" onClick={() => onOpen(task)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-shadow hover:shadow-md ${box}`}>
                <i className={`fa-solid ${icon} mt-0.5 shrink-0`} aria-hidden="true"></i>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold sm:text-sm">{task.judul}</span>
                  <span className="block text-[11px] opacity-80">{task.tempat} · {task.detail}</span>
                </span>
                <span className="shrink-0 self-center text-[11px] font-bold underline">Buka</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
