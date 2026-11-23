// Bagian bersama formulir lapangan (Izin LOTO F-PLT-116, Daftar Hadir F-HSE-105).
const TZ = 'Asia/Makassar';
const jamFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const tglFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

export const jam = iso => (iso ? jamFmt.format(new Date(iso)) : '');
export const tglJam = iso => (iso ? `${tglFmt.format(new Date(iso))} ${jam(iso)}` : '');
export const tglJamPendek = iso => (iso ? `${tglFmt.format(new Date(iso)).slice(0, 5)} ${jam(iso)}` : '');
// Pola dua shift sistem: Shift I 06.00-17.59, Shift II 18.00-05.59 (WITA).
export const shiftOf = iso => {
  const hour = Number(jam(iso).slice(0, 2));
  return hour >= 6 && hour < 18 ? 'I' : 'II';
};

// Lembar formulir di layar: garis tegas dan pita abu-abu seperti dokumen kertas perusahaan.
export const sheetCls = 'mx-auto w-full max-w-5xl bg-white p-2 shadow-md ring-1 ring-slate-300 sm:p-6';
export const edTable = 'w-full border-collapse text-slate-900';
export const edCell = 'border border-slate-500 p-0 align-middle';
export const edBand = 'border border-slate-500 bg-slate-300 px-2 py-1.5 text-center text-[11px] font-black uppercase tracking-wide';
export const edHead = 'border border-slate-500 bg-slate-100 px-2 py-1.5 text-center text-[11px] font-bold uppercase leading-tight';
export const edRowHead = 'border border-slate-500 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold leading-tight';
export const edLabel = 'shrink-0 pt-1.5 text-xs font-bold sm:pt-0';
export const edInput = 'block min-h-10 w-full min-w-0 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-300 hover:bg-amber-50/50 focus:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500/50 disabled:text-slate-600';
export const inlineLabelCls = 'flex flex-col pl-2 sm:flex-row sm:items-center sm:gap-1';
export const blockLabelCls = 'block pl-2 pt-1.5';
export const docInputCls = 'block min-h-8 w-full min-w-0 border-0 bg-transparent px-1.5 py-1 text-[11px] text-slate-900 hover:bg-amber-50/50 focus:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500/50 disabled:text-slate-600 sm:px-2 sm:text-xs';
export const rowNoCls = 'w-7 shrink-0 pl-2 text-xs font-semibold text-slate-600';
export const rowDeleteCls = 'min-h-10 shrink-0 px-2.5 text-slate-300 hover:text-red-600 focus:text-red-600';
export const addRowCls = 'min-h-9 w-full px-2 text-left text-xs font-bold text-red-600 hover:bg-red-50';

export const JABATAN = { mekanik: 'Mekanik', foreman: 'Foreman', pengawas: 'Pengawas', admin: 'Admin', safety: 'Safety' };

// Membuka formulir pasangan dari sesi box yang sama (izin LOTO <-> daftar hadir) setelah pindah menu.
let pendingOpen = null;
export const requestOpen = target => { pendingOpen = target; };
export const takePendingOpen = kind => {
  if (!pendingOpen || pendingOpen.kind !== kind) return null;
  const target = pendingOpen;
  pendingOpen = null;
  return target;
};

// Membuka formulir dari kotak tugas: halaman tujuan mengambil permintaan ini setelah datanya dimuat.
export const TAB_OF = { izin: 'izin-loto', hadir: 'daftar-hadir' };
export function openTaskTarget(task, setActiveTab) {
  pendingOpen = { kind: task.jenis, formId: task.formId };
  setActiveTab(TAB_OF[task.jenis]);
}
export const matchesTarget = (target, form) => (target.formId
  ? Number(form.id) === Number(target.formId)
  : form.idBox === target.idBox && Number(form.sessionId) === Number(target.sessionId));
