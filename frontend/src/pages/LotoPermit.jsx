import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/useAuth';
import lotoPermitService from '../services/lotoPermitService';
import { livePoll } from '../services/live';
import logoMtl from '../assets/logo-mtl.png';

// Izin LOTO digital: pengganti formulir kertas F-PLT-116 "Izin Penguncian Mesin, Alat, Unit/Instalasi".
// Aturan keselamatan (kapan LOTO boleh ditarik, kapan izin boleh ditutup) ditegakkan di backend.

const SHIFTS = ['I', 'II', 'III'];
// Nilai awal kepala dokumen (revisi formulir kertas yang berlaku); tetap bisa diubah per izin.
const DEFAULT_DOKUMEN = { nomor: 'F-PLT-116', tanggalEfektif: '2017-11-16', revisi: '0', halaman: '1 dari 1' };
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MAX_MESIN = 10;
const MAX_TITIK = 20;
const STATUS = {
  DRAFT: { label: 'Draft', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  AKTIF: { label: 'Aktif · LOTO terpasang', cls: 'border-red-300 bg-red-50 text-red-700' },
  DITUTUP: { label: 'Ditutup', cls: 'border-slate-300 bg-slate-100 text-slate-600' }
};
const ALTERNATIF = [
  ['blockControlSwitch', 'Block Control Switch'],
  ['pullwire', 'Pullwire'],
  ['handleValve', 'Handle Valve diangkat'],
  ['lainnya', 'Lainnya']
];

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 disabled:bg-slate-100 disabled:text-slate-500';
// Lembar formulir di layar: garis tegas dan pita abu-abu seperti dokumen kertas F-PLT-116.
const sheetCls = 'mx-auto w-full max-w-5xl bg-white p-2 shadow-md ring-1 ring-slate-300 sm:p-6';
const edTable = 'w-full border-collapse text-slate-900';
const edCell = 'border border-slate-500 p-0 align-middle';
const edBand = 'border border-slate-500 bg-slate-300 px-2 py-1.5 text-center text-[11px] font-black uppercase tracking-wide';
const edHead = 'border border-slate-500 bg-slate-100 px-2 py-1.5 text-center text-[11px] font-bold uppercase leading-tight';
const edRowHead = 'border border-slate-500 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold leading-tight';
const edLabel = 'shrink-0 pt-1.5 text-xs font-bold sm:pt-0';
const edInput = 'block min-h-10 w-full min-w-0 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-300 hover:bg-amber-50/50 focus:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500/50 disabled:text-slate-600';
const inlineLabelCls = 'flex flex-col pl-2 sm:flex-row sm:items-center sm:gap-1';
const blockLabelCls = 'block pl-2 pt-1.5';
const docInputCls = 'block min-h-8 w-full min-w-0 border-0 bg-transparent px-1.5 py-1 text-[11px] text-slate-900 hover:bg-amber-50/50 focus:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500/50 disabled:text-slate-600 sm:px-2 sm:text-xs';
const rowNoCls = 'w-7 shrink-0 pl-2 text-xs font-semibold text-slate-600';
const rowDeleteCls = 'min-h-10 shrink-0 px-2.5 text-slate-300 hover:text-red-600 focus:text-red-600';
const addRowCls = 'min-h-9 w-full px-2 text-left text-xs font-bold text-red-600 hover:bg-red-50';

const toast = (msg, type = 'ok') => window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
const errorMessage = error => error?.response?.data?.message || error?.message || 'Gagal berkomunikasi dengan server.';
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
const formatDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');
const formatDocDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${Number(iso.slice(8, 10))} ${BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const blankMesin = () => ({ nama: '', terisolasi: false, kembaliNormal: false });
const blankTitik = () => ({ nama: '', dipasang: false, ditarik: false });
const blankShift = () => ({ teknisi: '', groupLeader: '', tanggal: '', waktu: '' });
// Formulir kertas punya 3 baris mesin dan 5 baris titik isolasi; baris kosong dibuang saat disimpan.
const MIN_ROWS = { mesin: 3, titik: 5 };
const pad = (rows, min, blank) => [...rows, ...Array.from({ length: Math.max(0, min - rows.length) }, blank)];

function toForm(permit) {
  const p = permit || {};
  const alt = p.alternatif || {};
  const selesai = p.selesai || {};
  return {
    dokumen: { ...DEFAULT_DOKUMEN, ...(p.dokumen || {}) },
    projectNo: p.projectNo || '',
    tanggalISO: p.tanggalISO || todayLocal(),
    lokasi: p.lokasi || '',
    pekerjaan: p.pekerjaan || '',
    inspeksi: p.inspeksi || '',
    defisiensi: p.defisiensi || '',
    diperbaiki: Boolean(p.diperbaiki),
    mesin: pad((p.mesin || []).map(m => ({ ...blankMesin(), ...m })), MIN_ROWS.mesin, blankMesin),
    titik: pad((p.titik || []).map(t => ({ ...blankTitik(), ...t })), MIN_ROWS.titik, blankTitik),
    alternatif: {
      blockControlSwitch: Boolean(alt.blockControlSwitch), pullwire: Boolean(alt.pullwire),
      handleValve: Boolean(alt.handleValve), lainnya: Boolean(alt.lainnya), lainnyaKet: alt.lainnyaKet || ''
    },
    shift: Object.fromEntries(SHIFTS.map(s => [s, { ...blankShift(), ...(p.shift?.[s] || {}) }])),
    keterangan: p.keterangan || '',
    selesai: {
      status: selesai.status || '', teknisi: selesai.teknisi || '', teknisiTanggal: selesai.teknisiTanggal || '',
      teknisiWaktu: selesai.teknisiWaktu || '', pjTeknis: selesai.pjTeknis || '', pjTanggal: selesai.pjTanggal || '',
      pjWaktu: selesai.pjWaktu || ''
    }
  };
}

function Check({ checked, onChange, disabled, label, title }) {
  return (
    <label title={title} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-xs font-semibold ${disabled ? 'text-slate-400' : 'cursor-pointer text-slate-700'}`}>
      <input type="checkbox" className="h-5 w-5 accent-red-600" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function EdCheck({ checked, onChange, disabled, label, title }) {
  return (
    <td className={`${edCell} text-center`}>
      <label title={title} className={`flex min-h-10 items-center justify-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-amber-50/50'}`}>
        <input type="checkbox" aria-label={label} className="h-5 w-5 accent-red-600" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      </label>
    </td>
  );
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.DRAFT;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>;
}

function SessionBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-white px-2.5 py-0.5 text-[11px] font-bold text-red-700">
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true"></span>Sesi box berjalan
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Cetak: tata letak mengikuti formulir kertas F-PLT-116              */
/* ------------------------------------------------------------------ */
const Box = ({ on }) => <span className="lp-box">{on ? '✓' : ''}</span>;

function PermitPrint({ permit }) {
  const p = toForm(permit);
  const mesin = [...p.mesin.filter(m => m.nama)];
  while (mesin.length < 3) mesin.push(null);
  const titik = [...p.titik.filter(t => t.nama)];
  while (titik.length < 5) titik.push(null);
  const personel = (permit.personel || []).map(x => x.nama).filter(Boolean).join(', ');
  return (
    <div className="loto-print">
      <table className="lp-table lp-head">
        <tbody>
          <tr>
            <td rowSpan={4} className="lp-company"><img src={logoMtl} alt="Mutiara Tanjung Lestari" /></td>
            <td className="lp-center lp-bold">BERAU COAL GREEN MINING SYSTEM</td>
            <td>No. Dokumen</td><td>{p.dokumen.nomor}</td>
          </tr>
          <tr><td className="lp-center lp-bold">FORMULIR</td><td>Tanggal Efektif</td><td>{formatDocDate(p.dokumen.tanggalEfektif)}</td></tr>
          <tr><td rowSpan={2} className="lp-center lp-bold"><i>Lock Out &amp; Tag Out</i></td><td>Revisi</td><td>{p.dokumen.revisi}</td></tr>
          <tr><td>Halaman</td><td>{p.dokumen.halaman}</td></tr>
        </tbody>
      </table>

      <table className="lp-table">
        <colgroup><col style={{ width: '62%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /></colgroup>
        <tbody>
          <tr><th colSpan={3} className="lp-band">IZIN PENGUNCIAN MESIN, ALAT, UNIT/INSTALASI</th></tr>
          <tr><td><b>Project No. :</b> {p.projectNo}</td><td colSpan={2}><b>Tanggal :</b> {formatDate(p.tanggalISO)}</td></tr>
          <tr><td colSpan={3}><b>Lokasi :</b> {p.lokasi}</td></tr>
          <tr><td colSpan={3}><b>Penjelasan Pekerjaan :</b> {p.pekerjaan}</td></tr>
          <tr>
            <td><b>Inspeksi Lapangan</b></td>
            <td><Box on={p.inspeksi === 'OK'} /> <b>OK</b></td>
            <td><Box on={p.inspeksi === 'NOT_OK'} /> <b>Not OK, lakukan perbaikan</b></td>
          </tr>
          <tr>
            <td colSpan={3} className="lp-tall">
              <b>Penjelasan Defisiensi :</b> {p.defisiensi}
              <div className="lp-bottom"><Box on={p.diperbaiki} /> <b>Diperbaiki</b></div>
            </td>
          </tr>
          <tr className="lp-sub"><th>I. MESIN/ALAT/UNIT/INSTALASI YANG AKAN DIISOLASI</th><th>Terisolasi</th><th>Kembali Normal</th></tr>
          {mesin.map((m, i) => (
            <tr key={`m${i}`}><td>{i + 1}. {m?.nama}</td><td className="lp-center"><Box on={m?.terisolasi} /></td><td className="lp-center"><Box on={m?.kembaliNormal} /></td></tr>
          ))}
          <tr className="lp-sub"><th>II. TITIK-TITIK ISOLASI</th><th>LOTO Dipasang</th><th>LOTO Ditarik</th></tr>
          {titik.map((t, i) => (
            <tr key={`t${i}`}><td>{i + 1}. {t?.nama}</td><td className="lp-center"><Box on={t?.dipasang} /></td><td className="lp-center"><Box on={t?.ditarik} /></td></tr>
          ))}
          <tr>
            <td colSpan={3} className="lp-small">
              Jika <i>lock</i> tidak dapat dilakukan, sebutkan langkah tambahan yang perlu dilakukan
              <div className="lp-alt">
                {ALTERNATIF.map(([key, label]) => (
                  <span key={key}><Box on={p.alternatif[key]} /> <i>{label}</i>{key === 'lainnya' && p.alternatif.lainnyaKet ? `: ${p.alternatif.lainnyaKet}` : ''}</span>
                ))}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="lp-table lp-shift">
        <colgroup><col style={{ width: '16%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '18%' }} /></colgroup>
        <tbody>
          <tr><td>Shift</td>{SHIFTS.map(s => <th key={s}>{s}</th>)}<th>Keterangan</th></tr>
          <tr>
            <td>Dilakukan oleh/<br />Tanda tangan</td>
            {SHIFTS.map(s => <td key={s} className="lp-sign"><div className="lp-name">{p.shift[s].teknisi}</div><div className="lp-role">Teknisi</div></td>)}
            <td rowSpan={4} className="lp-top">{p.keterangan}</td>
          </tr>
          <tr>
            <td>Penanggung jawab/<br />Tanda tangan</td>
            {SHIFTS.map(s => <td key={s} className="lp-sign"><div className="lp-name">{p.shift[s].groupLeader}</div><div className="lp-role">Group Leader</div></td>)}
          </tr>
          <tr><td>Tanggal</td>{SHIFTS.map(s => <td key={s}>{formatDate(p.shift[s].tanggal)}</td>)}</tr>
          <tr><td>Waktu</td>{SHIFTS.map(s => <td key={s}>{p.shift[s].waktu}</td>)}</tr>
        </tbody>
      </table>

      <table className="lp-table">
        <colgroup><col style={{ width: '88%' }} /><col style={{ width: '12%' }} /></colgroup>
        <tbody>
          <tr><th colSpan={2} className="lp-band lp-left">III. PEKERJAAN SELESAI (PEMBUKAAN KUNCI)</th></tr>
          <tr>
            <td>Pekerjaan TELAH selesai dan tidak ada lagi personil yang melakukan pekerjaan di area isolasi. Mesin/ alat siap dioperasikan kembali.</td>
            <td className="lp-center"><Box on={p.selesai.status === 'SELESAI'} /></td>
          </tr>
          <tr>
            <td>Pekerjaan BELUM selesai dan akan dilanjutkan di lain waktu dengan membuat izin LOTO ulang</td>
            <td className="lp-center"><Box on={p.selesai.status === 'BELUM'} /></td>
          </tr>
        </tbody>
      </table>
      <table className="lp-table">
        <tbody>
          <tr>
            <td className="lp-half">
              <b>Teknisi</b>
              <div className="lp-signature">{p.selesai.teknisi}</div>
              <div>Tanggal : {formatDate(p.selesai.teknisiTanggal)}</div>
              <div>Waktu : {p.selesai.teknisiWaktu}</div>
            </td>
            <td className="lp-half">
              <b>Penanggung Jawab Teknis</b>
              <div className="lp-signature">{p.selesai.pjTeknis}</div>
              <div>Tanggal : {formatDate(p.selesai.pjTanggal)}</div>
              <div>Waktu : {p.selesai.pjWaktu}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="lp-foot">
        Dicetak dari E-LOTO · Izin #{permit.id} · {permit.idBox ? `${permit.idBox} sesi ${permit.sessionId}` : 'izin manual'} ·
        Status {STATUS[permit.status]?.label || permit.status} · {new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA
        {personel ? ` · Personel tap di box: ${personel}` : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Halaman                                                            */
/* ------------------------------------------------------------------ */
export default function LotoPermit() {
  const { sessionUser } = useAuth();
  const role = sessionUser?.role;
  const canWrite = role === 'admin' || role === 'pengawas';
  const [permits, setPermits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('SEMUA');
  const [editing, setEditing] = useState(null); // izin yang dibuka; { id: null } untuk izin manual baru
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [printPermit, setPrintPermit] = useState(null);
  const topRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await lotoPermitService.getAll();
      setPermits(Array.isArray(result.data) ? result.data : []);
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return livePoll(load, 30000);
  }, [load]);

  // Cetak lewat portal di luar #root; CSS print menyembunyikan aplikasi selama dialog cetak.
  useEffect(() => {
    if (!printPermit) return undefined;
    const done = () => { delete document.body.dataset.print; setPrintPermit(null); };
    document.body.dataset.print = 'loto';
    window.addEventListener('afterprint', done, { once: true });
    const frame = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(frame); window.removeEventListener('afterprint', done); delete document.body.dataset.print; };
  }, [printPermit]);

  const latest = editing?.id ? permits.find(p => p.id === editing.id) || editing : editing;
  const sessionActive = Boolean(latest?.sessionActive);
  const readOnly = !canWrite || editing?.status === 'DITUTUP';
  const dirty = useMemo(() => Boolean(editing && form) && JSON.stringify(form) !== JSON.stringify(toForm(editing)), [editing, form]);
  const changedOnServer = Boolean(editing?.id && latest && latest.updatedAt !== editing.updatedAt);
  const counts = useMemo(() => permits.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {}), [permits]);
  const shown = filter === 'SEMUA' ? permits : permits.filter(p => p.status === filter);

  const open = permit => {
    setEditing(permit);
    setForm(toForm(permit));
    setFormError('');
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };
  const openNew = () => open({ id: null, status: 'DRAFT' });
  const close = () => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tetap keluar?')) return;
    setEditing(null);
    setForm(null);
    setFormError('');
  };
  const reloadFromServer = () => { if (latest) open(latest); };

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const setRow = (list, index, patch) => setForm(f => ({ ...f, [list]: f[list].map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  const addRow = (list, blank, max) => setForm(f => (f[list].length >= max ? f : { ...f, [list]: [...f[list], blank()] }));
  const removeRow = (list, index, blank) => setForm(f => ({
    ...f, [list]: pad(f[list].filter((_, i) => i !== index), MIN_ROWS[list], blank)
  }));
  const setShift = (s, key, value) => setForm(f => ({ ...f, shift: { ...f.shift, [s]: { ...f.shift[s], [key]: value } } }));
  const setDok = (key, value) => setForm(f => ({ ...f, dokumen: { ...f.dokumen, [key]: value } }));
  const setAlt = (key, value) => setForm(f => ({ ...f, alternatif: { ...f.alternatif, [key]: value } }));
  const setSelesai = (key, value) => setForm(f => ({ ...f, selesai: { ...f.selesai, [key]: value } }));

  const save = async event => {
    event.preventDefault();
    if (saving || readOnly) return;
    setSaving(true);
    setFormError('');
    try {
      const result = editing.id
        ? await lotoPermitService.update(editing.id, form)
        : await lotoPermitService.create(form);
      const saved = result.data;
      setEditing(saved);
      setForm(toForm(saved));
      toast(saved.status === 'DITUTUP' ? 'Izin LOTO ditutup.' : saved.status === 'AKTIF' ? 'Izin LOTO aktif: LOTO terpasang.' : 'Draft izin LOTO disimpan.');
      load();
    } catch (error) {
      setFormError(errorMessage(error));
      topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id || !window.confirm(`Hapus izin LOTO #${editing.id}? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await lotoPermitService.delete(editing.id);
      toast('Izin LOTO dihapus.');
      setEditing(null);
      setForm(null);
      load();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  const print = () => {
    if (dirty) { toast('Simpan perubahan dulu sebelum mencetak.', 'fail'); return; }
    setPrintPermit(latest);
  };

  const printLayer = printPermit ? createPortal(<PermitPrint permit={printPermit} />, document.body) : null;

  /* ------------------------------ Daftar ------------------------------ */
  if (!editing) {
    return (
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-mono-tech text-base font-bold uppercase text-red-600 sm:text-lg"><i className="fa-solid fa-file-signature mr-2" aria-hidden="true"></i>Izin LOTO</h1>
            <p className="mt-1 text-xs text-slate-500">Formulir F-PLT-116. Draft dibuat otomatis saat pengawas tap di box; lengkapi titik isolasi sebelum pekerjaan dimulai.</p>
          </div>
          {canWrite && (
            <button type="button" onClick={openNew} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-xs font-bold text-red-700 hover:bg-red-50">
              <i className="fa-solid fa-plus" aria-hidden="true"></i>Isi formulir baru (manual)
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Saring status izin">
          {['SEMUA', 'DRAFT', 'AKTIF', 'DITUTUP'].map(key => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
              className={`min-h-10 rounded-full border px-4 text-xs font-bold ${filter === key ? 'border-red-600 bg-red-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-red-300'}`}>
              {key === 'SEMUA' ? `Semua (${permits.length})` : `${STATUS[key].label.split(' ·')[0]} (${counts[key] || 0})`}
            </button>
          ))}
        </div>

        {loadError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        {loading ? <p role="status" className="text-sm text-slate-500">Memuat izin LOTO…</p> : shown.length === 0 ? (
          permits.length === 0 ? (
            <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600 sm:p-8">
              <p className="font-bold text-slate-800">Belum ada izin LOTO. Alurnya:</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs sm:text-sm">
                <li><b>Pengawas tap kartu di box</b> → izin otomatis terbuat dengan tanggal, unit, nama teknisi &amp; group leader, dan jam tap.</li>
                <li><b>Pengawas melengkapi di sini</b>: lokasi, pekerjaan, inspeksi, titik isolasi, lalu centang <i>LOTO Dipasang</i> → status <b>Aktif</b>.</li>
                <li><b>Setelah semua personel tap keluar</b> di box: centang <i>LOTO Ditarik</i> &amp; <i>Kembali Normal</i>, isi bagian III → status <b>Ditutup</b>.</li>
                <li>Cetak formulir F-PLT-116 bila perlu tanda tangan basah.</li>
              </ol>
              <p className="text-xs text-slate-500">Tabel formulir (mesin, titik isolasi, shift, penutupan) tampil setelah izin dibuka. Untuk pekerjaan tanpa box, atau untuk melihat formulirnya sekarang, isi secara manual:</p>
              {canWrite && (
                <button type="button" onClick={openNew} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-5 text-xs font-bold text-white shadow-md shadow-red-500/20 hover:bg-red-700">
                  <i className="fa-solid fa-file-pen" aria-hidden="true"></i>Buka formulir F-PLT-116
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada izin dengan status ini.</div>
          )
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shown.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => open(p)} className="w-full space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-red-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={p.status} />
                    {p.sessionActive && <SessionBadge />}
                    <span className="ml-auto font-mono text-[11px] text-slate-400">#{p.id}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{p.pekerjaan || <span className="font-semibold italic text-slate-400">Penjelasan pekerjaan belum diisi</span>}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(p.tanggalISO)} · {p.idBox ? `${p.idBox}${p.unit ? ` (${p.unit})` : ''}` : 'Izin manual'}
                    {p.lokasi ? ` · ${p.lokasi}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(p.titik || []).length} titik isolasi · {(p.personel || []).length} personel tap
                    {p.status === 'DRAFT' && p.kekurangan?.length ? <span className="text-amber-700"> · {p.kekurangan.length} hal belum lengkap</span> : null}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
        {printLayer}
      </div>
    );
  }

  /* ------------------------------ Form ------------------------------ */
  const releaseLocked = sessionActive;
  const releaseHint = 'Sesi box masih berjalan: tunggu semua personel tap keluar dan pengawas menutup sesi.';
  return (
    <form onSubmit={save} className="w-full space-y-4 pb-24">
      <div ref={topRef} className="flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <button type="button" onClick={close} className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-slate-500 hover:text-red-600">
            <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>Daftar izin
          </button>
          <h1 className="font-mono-tech text-base font-bold uppercase text-red-600 sm:text-lg">
            {editing.id ? `Izin LOTO #${editing.id}` : 'Izin LOTO manual baru'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <StatusBadge status={editing.status} />
            {sessionActive && <SessionBadge />}
            {editing.idBox && <span>{editing.idBox}{latest?.unit ? ` (${latest.unit})` : ''} · sesi {editing.sessionId}</span>}
          </div>
        </div>
      </div>

      {formError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">{formError}</p>}
      {changedOnServer && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>Ada perubahan baru untuk izin ini (misalnya personel baru tap di box).</span>
          <button type="button" onClick={reloadFromServer} className="min-h-9 rounded-lg border border-amber-400 bg-white px-3 font-bold">Muat versi terbaru</button>
        </div>
      )}
      {editing.status === 'DRAFT' && editing.kekurangan?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          <p className="font-bold">Izin aktif setelah dilengkapi:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{editing.kekurangan.map(g => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
      {editing.status === 'DITUTUP' && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Izin sudah ditutup dan tidak bisa diubah lagi.</p>}

      {releaseLocked && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{releaseHint} Kolom LOTO ditarik, kembali normal, dan bagian III terkunci sampai saat itu.</p>}

      <fieldset disabled={readOnly || saving} className="min-w-0">
        {/* Lembar formulir: tata letak dan urutan mengikuti dokumen kertas F-PLT-116. */}
        <div className={sheetCls}>
          <table className={`${edTable} table-fixed text-[10px] sm:text-xs`}>
            <colgroup><col className="w-[18%]" /><col className="w-[30%] sm:w-[34%]" /><col className="w-[20%]" /><col className="w-[32%] sm:w-[28%]" /></colgroup>
            <tbody>
              <tr>
                <td rowSpan={4} className={`${edCell} p-1 text-center`}><img src={logoMtl} alt="Mutiara Tanjung Lestari" className="mx-auto h-auto max-h-20 w-full max-w-[150px] object-contain" /></td>
                <td className={`${edCell} px-2 py-1 text-center font-bold`}>BERAU COAL GREEN MINING SYSTEM</td>
                <td className={`${edCell} px-2 py-1`}>No. Dokumen</td>
                <td className={edCell}><input aria-label="No. Dokumen" className={docInputCls} maxLength={50} value={form.dokumen.nomor} onChange={e => setDok('nomor', e.target.value)} /></td>
              </tr>
              <tr>
                <td className={`${edCell} px-2 py-1 text-center font-bold`}>FORMULIR</td>
                <td className={`${edCell} px-2 py-1`}>Tanggal Efektif</td>
                <td className={edCell}><input aria-label="Tanggal Efektif" type="date" className={docInputCls} value={form.dokumen.tanggalEfektif} onChange={e => setDok('tanggalEfektif', e.target.value)} /></td>
              </tr>
              <tr>
                <td rowSpan={2} className={`${edCell} px-2 py-1 text-center font-bold italic`}>Lock Out &amp; Tag Out</td>
                <td className={`${edCell} px-2 py-1`}>Revisi</td>
                <td className={edCell}><input aria-label="Revisi" className={docInputCls} maxLength={10} value={form.dokumen.revisi} onChange={e => setDok('revisi', e.target.value)} /></td>
              </tr>
              <tr>
                <td className={`${edCell} px-2 py-1`}>Halaman</td>
                <td className={edCell}><input aria-label="Halaman" className={docInputCls} maxLength={20} value={form.dokumen.halaman} onChange={e => setDok('halaman', e.target.value)} /></td>
              </tr>
            </tbody>
          </table>

          <table className={`${edTable} mt-3 table-fixed`}>
            <colgroup><col /><col className="w-20 sm:w-36" /><col className="w-20 sm:w-36" /></colgroup>
            <tbody>
              <tr><th colSpan={3} className={edBand}>Izin penguncian mesin, alat, unit/instalasi</th></tr>
              <tr>
                <td className={edCell}><label className={inlineLabelCls}><span className={edLabel}>Project No. :</span><input id="lp-project" className={edInput} maxLength={50} value={form.projectNo} onChange={e => set('projectNo', e.target.value)} /></label></td>
                <td colSpan={2} className={edCell}><label className={inlineLabelCls}><span className={edLabel}>Tanggal :</span><input id="lp-date" type="date" required className={edInput} value={form.tanggalISO} onChange={e => set('tanggalISO', e.target.value)} /></label></td>
              </tr>
              <tr>
                <td colSpan={3} className={edCell}><label className={inlineLabelCls}><span className={edLabel}>Lokasi :</span><input id="lp-lokasi" className={edInput} maxLength={200} value={form.lokasi} onChange={e => set('lokasi', e.target.value)} /></label></td>
              </tr>
              <tr>
                <td colSpan={3} className={edCell}><label className={blockLabelCls}><span className={edLabel}>Penjelasan Pekerjaan :</span><textarea id="lp-pekerjaan" rows={2} className={edInput} maxLength={1000} value={form.pekerjaan} onChange={e => set('pekerjaan', e.target.value)} /></label></td>
              </tr>
              <tr>
                <td className={`${edCell} px-2 py-2 text-xs font-bold`}>Inspeksi Lapangan</td>
                {[['OK', 'OK'], ['NOT_OK', 'Not OK, lakukan perbaikan']].map(([value, label]) => (
                  <td key={value} className={edCell}>
                    <label className="flex min-h-10 cursor-pointer flex-col items-start justify-center gap-1 px-2 py-1 text-[11px] font-bold leading-tight sm:flex-row sm:items-center sm:justify-start sm:gap-2 sm:text-xs">
                      <input type="radio" name="lp-inspeksi" className="h-4 w-4 shrink-0 accent-red-600" checked={form.inspeksi === value} onChange={() => set('inspeksi', value)} />{label}
                    </label>
                  </td>
                ))}
              </tr>
              <tr>
                <td colSpan={3} className={edCell}>
                  <label className={blockLabelCls}><span className={edLabel}>Penjelasan Defisiensi : <span className="font-normal text-slate-500">(wajib bila Not OK)</span></span><textarea id="lp-defisiensi" rows={3} className={edInput} maxLength={2000} value={form.defisiensi} onChange={e => set('defisiensi', e.target.value)} /></label>
                  <div className="px-1"><Check checked={form.diperbaiki} onChange={v => set('diperbaiki', v)} label="Diperbaiki" /></div>
                </td>
              </tr>

              <tr>
                <th scope="col" className={`${edHead} text-left`}>I. Mesin/alat/unit/instalasi yang akan diisolasi</th>
                <th scope="col" className={edHead}>Terisolasi</th>
                <th scope="col" className={edHead}>Kembali Normal</th>
              </tr>
              {form.mesin.map((m, i) => (
                <tr key={`m${i}`}>
                  <td className={edCell}>
                    <div className="flex items-center">
                      <span className={rowNoCls}>{i + 1}.</span>
                      <input aria-label={`Mesin ${i + 1}`} className={edInput} maxLength={100} value={m.nama} onChange={e => setRow('mesin', i, { nama: e.target.value })} />
                      {!readOnly && <button type="button" onClick={() => removeRow('mesin', i, blankMesin)} aria-label={`Hapus mesin ${i + 1}`} className={rowDeleteCls}><i className="fa-solid fa-xmark" aria-hidden="true"></i></button>}
                    </div>
                  </td>
                  <EdCheck checked={m.terisolasi} label={`Mesin ${i + 1} terisolasi`} onChange={v => setRow('mesin', i, v ? { terisolasi: true } : { terisolasi: false, kembaliNormal: false })} />
                  <EdCheck checked={m.kembaliNormal} label={`Mesin ${i + 1} kembali normal`} disabled={!m.terisolasi || releaseLocked} title={releaseLocked ? releaseHint : undefined} onChange={v => setRow('mesin', i, { kembaliNormal: v })} />
                </tr>
              ))}
              {!readOnly && form.mesin.length < MAX_MESIN && (
                <tr><td colSpan={3} className={edCell}><button type="button" onClick={() => addRow('mesin', blankMesin, MAX_MESIN)} className={addRowCls}><i className="fa-solid fa-plus mr-1" aria-hidden="true"></i>Tambah baris mesin</button></td></tr>
              )}

              <tr>
                <th scope="col" className={`${edHead} text-left`}>II. Titik-titik isolasi</th>
                <th scope="col" className={edHead}>LOTO Dipasang</th>
                <th scope="col" className={edHead}>LOTO Ditarik</th>
              </tr>
              {form.titik.map((t, i) => (
                <tr key={`t${i}`}>
                  <td className={edCell}>
                    <div className="flex items-center">
                      <span className={rowNoCls}>{i + 1}.</span>
                      <input aria-label={`Titik isolasi ${i + 1}`} className={edInput} maxLength={150} value={t.nama} onChange={e => setRow('titik', i, { nama: e.target.value })} />
                      {!readOnly && <button type="button" onClick={() => removeRow('titik', i, blankTitik)} aria-label={`Hapus titik isolasi ${i + 1}`} className={rowDeleteCls}><i className="fa-solid fa-xmark" aria-hidden="true"></i></button>}
                    </div>
                  </td>
                  <EdCheck checked={t.dipasang} label={`Titik ${i + 1} LOTO dipasang`} disabled={t.ditarik && releaseLocked} onChange={v => setRow('titik', i, v ? { dipasang: true } : { dipasang: false, ditarik: false })} />
                  <EdCheck checked={t.ditarik} label={`Titik ${i + 1} LOTO ditarik`} disabled={!t.dipasang || releaseLocked} title={releaseLocked ? releaseHint : undefined} onChange={v => setRow('titik', i, { ditarik: v })} />
                </tr>
              ))}
              {!readOnly && form.titik.length < MAX_TITIK && (
                <tr><td colSpan={3} className={edCell}><button type="button" onClick={() => addRow('titik', blankTitik, MAX_TITIK)} className={addRowCls}><i className="fa-solid fa-plus mr-1" aria-hidden="true"></i>Tambah baris titik isolasi</button></td></tr>
              )}
              <tr>
                <td colSpan={3} className={`${edCell} px-2 py-1.5`}>
                  <p className="text-[11px] text-slate-800">Jika <i>lock</i> tidak dapat dilakukan, sebutkan langkah tambahan yang perlu dilakukan</p>
                  <div className="flex flex-wrap gap-x-4">
                    {ALTERNATIF.map(([key, label]) => <Check key={key} checked={form.alternatif[key]} label={<i>{label}</i>} onChange={v => setAlt(key, v)} />)}
                  </div>
                  {form.alternatif.lainnya && <input aria-label="Keterangan langkah lainnya" placeholder="Sebutkan langkah lainnya" className={`${inputCls} mb-1`} maxLength={200} value={form.alternatif.lainnyaKet} onChange={e => setAlt('lainnyaKet', e.target.value)} />}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="relative mt-3 overflow-x-auto">
            <table className={`${edTable} min-w-[680px] table-fixed`}>
              <colgroup><col className="w-[16%]" /><col className="w-[22%]" /><col className="w-[22%]" /><col className="w-[22%]" /><col className="w-[18%]" /></colgroup>
              <thead>
                <tr>
                  <th scope="col" className={`${edHead} text-left`}>Shift</th>
                  {SHIFTS.map(s => <th key={s} scope="col" className={edHead}>{s}</th>)}
                  <th scope="col" className={edHead}>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {[['teknisi', 'Dilakukan oleh', 'Teknisi', 'Dilakukan oleh (teknisi)'], ['groupLeader', 'Penanggung jawab', 'Group Leader', 'Penanggung jawab (group leader)']].map(([field, head, caption, aria], row) => (
                  <tr key={field}>
                    <th scope="row" className={edRowHead}>{head}/<br />Tanda tangan</th>
                    {SHIFTS.map(s => (
                      <td key={s} className={`${edCell} align-bottom`}>
                        <textarea aria-label={`${aria}, shift ${s}`} rows={2} className={edInput} maxLength={1000} value={form.shift[s][field]} onChange={e => setShift(s, field, e.target.value)} />
                        <p className="mx-2 border-t border-slate-400 py-0.5 text-center text-[10px] text-slate-600">{caption}</p>
                      </td>
                    ))}
                    {row === 0 && (
                      <td rowSpan={4} className={`${edCell} relative`}>
                        <textarea id="lp-ket" aria-label="Keterangan" className={`${edInput} absolute inset-0 h-full`} maxLength={500} value={form.keterangan} onChange={e => set('keterangan', e.target.value)} />
                      </td>
                    )}
                  </tr>
                ))}
                {[['tanggal', 'Tanggal', 'date'], ['waktu', 'Waktu', 'time']].map(([field, label, type]) => (
                  <tr key={field}>
                    <th scope="row" className={edRowHead}>{label}</th>
                    {SHIFTS.map(s => (
                      <td key={s} className={edCell}><input aria-label={`${label}, shift ${s}`} type={type} className={edInput} value={form.shift[s][field]} onChange={e => setShift(s, field, e.target.value)} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <table className={`${edTable} mt-3 table-fixed`}>
            <colgroup><col /><col className="w-16 sm:w-24" /></colgroup>
            <tbody>
              <tr><th colSpan={2} className={`${edBand} text-left`}>III. Pekerjaan selesai (pembukaan kunci)</th></tr>
              {[
                ['SELESAI', 'Pekerjaan TELAH selesai dan tidak ada lagi personil yang melakukan pekerjaan di area isolasi. Mesin/ alat siap dioperasikan kembali.', 'Pekerjaan telah selesai'],
                ['BELUM', 'Pekerjaan BELUM selesai dan akan dilanjutkan di lain waktu dengan membuat izin LOTO ulang', 'Pekerjaan belum selesai']
              ].map(([value, text, aria]) => (
                <tr key={value}>
                  <td className={`${edCell} px-2 py-2 text-xs leading-snug sm:text-sm`}>{text}</td>
                  <EdCheck checked={form.selesai.status === value} label={aria} disabled={releaseLocked} title={releaseLocked ? releaseHint : undefined} onChange={v => setSelesai('status', v ? value : '')} />
                </tr>
              ))}
            </tbody>
          </table>
          <table className={`${edTable} -mt-px table-fixed`}>
            <tbody>
              <tr>
                {[['teknisi', 'teknisiTanggal', 'teknisiWaktu', 'Teknisi'], ['pjTeknis', 'pjTanggal', 'pjWaktu', 'Penanggung Jawab Teknis']].map(([name, date, time, label]) => (
                  <td key={name} className={`${edCell} w-1/2 align-top`}>
                    <p className="px-2 pt-1.5 text-xs font-bold">{label}</p>
                    <input aria-label={`Nama ${label.toLowerCase()}`} placeholder="Nama" className={edInput} maxLength={100} value={form.selesai[name]} onChange={e => setSelesai(name, e.target.value)} />
                    <p className="px-2 text-[10px] italic text-slate-400">Tanda tangan di hasil cetak</p>
                    <label className={inlineLabelCls}><span className={`${edLabel} font-normal sm:w-16`}>Tanggal :</span><input aria-label={`Tanggal ${label.toLowerCase()}`} type="date" className={edInput} value={form.selesai[date]} onChange={e => setSelesai(date, e.target.value)} /></label>
                    <label className={`${inlineLabelCls} pb-1`}><span className={`${edLabel} font-normal sm:w-16`}>Waktu :</span><input aria-label={`Waktu ${label.toLowerCase()}`} type="time" className={edInput} value={form.selesai[time]} onChange={e => setSelesai(time, e.target.value)} /></label>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mx-auto mt-3 max-w-5xl space-y-2 text-[11px] text-slate-500">
          <p>Kolom shift terisi otomatis dari tap kartu di box (Shift I = 06.00–17.59, Shift II = 18.00–05.59, Shift III untuk lanjutan). Bagian III: biarkan kedua kotak kosong selama pekerjaan berjalan; tanggal dan waktu yang kosong diisi otomatis saat izin ditutup, dan izin yang ditutup tidak bisa diubah.</p>
          {latest?.personel?.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-slate-700">Personel yang tap di box</p>
              <ul className="flex flex-wrap gap-1.5">
                {latest.personel.map(x => <li key={x.sid} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">{x.nama} <span className="text-slate-400">· {x.role}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {!readOnly && (
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-red-500/20 hover:bg-red-700 disabled:opacity-50">
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} aria-hidden="true"></i>{saving ? 'Menyimpan…' : form.selesai.status ? 'Simpan & tutup izin' : 'Simpan'}
          </button>
        )}
        {editing.id && (
          <button type="button" onClick={print} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <i className="fa-solid fa-print" aria-hidden="true"></i>Cetak F-PLT-116
          </button>
        )}
        {dirty && !readOnly && <span className="text-[11px] font-semibold text-amber-700">Belum disimpan</span>}
        {editing.id && (role === 'admin' || (role === 'pengawas' && editing.status === 'DRAFT')) && (
          <button type="button" onClick={remove} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold text-slate-400 hover:text-red-600">
            <i className="fa-solid fa-trash" aria-hidden="true"></i>Hapus
          </button>
        )}
      </div>
      {printLayer}
    </form>
  );
}
