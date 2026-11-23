import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/useAuth';
import briefingService from '../services/briefingService';
import { livePoll } from '../services/live';
import logoMtl from '../assets/logo-mtl.png';
import { SignChip } from '../components/FieldForm';
import {
  addRowCls, docInputCls, edCell, edHead, edInput, edLabel, edRowHead, edTable, jam, requestOpen,
  rowDeleteCls, sheetCls, takePendingOpen, tglJam
} from '../utils/fieldForm';

// Daftar hadir sosialisasi digital: pengganti formulir kertas F-HSE-105.
// Peserta terisi dari tap kartu di box (tap = tanda tangan), jam tidur diisi tiap peserta (cek kelelahan),
// "Yang memimpin" (foreman) dan "Mengetahui" (supervisor) bertanda tangan lewat akun. Hak akses dari server.

const DEFAULT_DOKUMEN = { nomor: 'F-HSE-105', tanggalEfektif: '2017-02-25', revisi: '1', halaman: '1 dari 1' };
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MIN_ROWS = 12;
const MAX_PESERTA = 40;
const STATUS = {
  DRAFT: { label: 'Draft', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  LENGKAP: { label: 'Lengkap', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' }
};

const toast = (msg, type = 'ok') => window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
const errorMessage = error => error?.response?.data?.message || error?.message || 'Gagal berkomunikasi dengan server.';
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
const isIso = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '');
const formatDate = iso => (isIso(iso) ? iso.split('-').reverse().join('/') : '');
const formatLongDate = iso => (isIso(iso) ? `${Number(iso.slice(8, 10))} ${BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const hariOf = iso => (isIso(iso) ? HARI[new Date(`${iso}T00:00:00Z`).getUTCDay()] : '');
const blankPeserta = () => ({ sid: '', nama: '', instansi: '', jamTidur: '', jabatan: '' });
const pad = rows => [...rows, ...Array.from({ length: Math.max(0, MIN_ROWS - rows.length) }, blankPeserta)];
const sleepText = value => (value === null || value === undefined || value === '' ? '' : String(value));

function toForm(briefing) {
  const p = briefing || {};
  return {
    dokumen: { ...DEFAULT_DOKUMEN, ...(p.dokumen || {}) },
    departemen: p.departemen || '',
    tanggalISO: p.tanggalISO || todayLocal(),
    waktu: p.waktu || '',
    pembicara: p.pembicara || '',
    lokasi: p.lokasi || '',
    namaDokumen: p.namaDokumen || '',
    revisiDokumen: p.revisiDokumen || '',
    tanggalEfektifDokumen: p.tanggalEfektifDokumen || '',
    peserta: pad((p.peserta || []).map(x => ({ ...blankPeserta(), ...x, jamTidur: sleepText(x.jamTidur) }))),
    yangMemimpin: p.yangMemimpin || '',
    mengetahui: p.mengetahui || ''
  };
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.DRAFT;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>;
}

/* ------------------------------------------------------------------ */
/*  Cetak: tata letak mengikuti formulir kertas F-HSE-105              */
/* ------------------------------------------------------------------ */
function BriefingPrint({ briefing }) {
  const p = toForm(briefing);
  const taps = new Map((briefing.tapKartu || []).map(t => [t.sid, t]));
  const rows = p.peserta.filter(x => x.nama);
  while (rows.length < MIN_ROWS) rows.push(null);
  const ttd = briefing.tandaTangan || {};
  return (
    <div className="loto-print">
      <table className="lp-table lp-head">
        <tbody>
          <tr>
            <td rowSpan={4} className="lp-company"><img src={logoMtl} alt="Mutiara Tanjung Lestari" /></td>
            <td className="lp-center lp-bold">BERAU COAL GREEN MINING SYSTEM</td>
            <td>No. Dokumen</td><td>{p.dokumen.nomor}</td>
          </tr>
          <tr><td className="lp-center lp-bold">FORMULIR</td><td>Tanggal Efektif</td><td>{formatLongDate(p.dokumen.tanggalEfektif)}</td></tr>
          <tr><td rowSpan={2} className="lp-center lp-bold">Daftar Hadir Sosialisasi</td><td>Revisi</td><td>{p.dokumen.revisi}</td></tr>
          <tr><td>Halaman</td><td>{p.dokumen.halaman}</td></tr>
        </tbody>
      </table>

      <table className="lp-table">
        <colgroup><col style={{ width: '20%' }} /><col style={{ width: '50%' }} /><col style={{ width: '10%' }} /><col style={{ width: '20%' }} /></colgroup>
        <tbody>
          <tr><td>Departemen</td><td colSpan={3}>: {p.departemen}</td></tr>
          <tr><td>Hari/Tanggal</td><td>: {hariOf(p.tanggalISO)}{p.tanggalISO ? `, ${formatDate(p.tanggalISO)}` : ''}</td><td>Waktu</td><td>: {p.waktu}</td></tr>
          <tr><td>Pembicara</td><td colSpan={3}>: {p.pembicara}</td></tr>
          <tr><td>Lokasi</td><td colSpan={3}>: {p.lokasi}</td></tr>
          <tr><td>Nama Dokumen</td><td colSpan={3}>: {p.namaDokumen}</td></tr>
          <tr><td>Revisi</td><td colSpan={3}>: {p.revisiDokumen}</td></tr>
          <tr><td>Tanggal Efektif</td><td colSpan={3}>: {formatLongDate(p.tanggalEfektifDokumen)}</td></tr>
        </tbody>
      </table>
      <p className="lp-center lp-bold" style={{ margin: '6px 0', fontStyle: 'italic', textDecoration: 'underline' }}>
        Dengan ini kami menyatakan bahwa prosedur telah disampaikan dan dipahami.
      </p>

      <table className="lp-table lp-hadir">
        <colgroup>
          <col style={{ width: '6%' }} /><col style={{ width: '27%' }} /><col style={{ width: '17%' }} />
          <col style={{ width: '12%' }} /><col style={{ width: '14%' }} /><col style={{ width: '24%' }} />
        </colgroup>
        <tbody>
          <tr className="lp-sub"><th>NO</th><th>NAMA</th><th>INSTANSI/DEPT.</th><th>JAM TIDUR</th><th>JABATAN</th><th>TANDA TANGAN</th></tr>
          {rows.map((x, i) => {
            const tap = x?.sid ? taps.get(x.sid) : null;
            return (
              <tr key={i}>
                <td className="lp-center">{i + 1}</td>
                <td>{x?.nama}</td>
                <td>{x ? x.instansi || p.departemen : ''}</td>
                <td className="lp-center">{x?.jamTidur !== '' && x?.jamTidur !== undefined ? `${x.jamTidur} jam` : ''}</td>
                <td>{x?.jabatan}</td>
                <td>{tap?.masuk && <span className="lp-tte">TTE kartu {tglJam(tap.masuk)}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="lp-table" style={{ marginTop: 8 }}>
        <tbody>
          <tr>
            <td className="lp-half">
              Yang Memimpin,
              <div className="lp-signature">{ttd.yangMemimpin && <div className="lp-tte">TTE akun {tglJam(ttd.yangMemimpin.waktu)}</div>}</div>
              <b>{ttd.yangMemimpin?.nama || p.yangMemimpin}</b><div>Foreman</div>
            </td>
            <td className="lp-half">
              Mengetahui :
              <div className="lp-signature">{ttd.mengetahui && <div className="lp-tte">TTE akun {tglJam(ttd.mengetahui.waktu)}</div>}</div>
              <b>{ttd.mengetahui?.nama || p.mengetahui}</b><div>Supervisor</div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="lp-foot">
        Dicetak dari E-LOTO · Daftar hadir #{briefing.id} · {briefing.idBox ? `${briefing.idBox} sesi ${briefing.sessionId}` : 'manual'} ·
        Status {STATUS[briefing.status]?.label || briefing.status} · {new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA ·
        TTE = tanda tangan elektronik (tap kartu RFID di box / akun E-LOTO).
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Halaman                                                            */
/* ------------------------------------------------------------------ */
export default function DaftarHadir() {
  const { sessionUser, setActiveTab } = useAuth();
  const role = sessionUser?.role;
  // Daftar hadir manual dibuat oleh yang memimpin sosialisasi: foreman atau pengawas.
  const canCreate = ['admin', 'pengawas'].includes(role) || sessionUser?.jabatan === 'foreman';
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('SEMUA');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [printing, setPrinting] = useState(null);
  const topRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await briefingService.getAll();
      setList(Array.isArray(result.data) ? result.data : []);
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

  useEffect(() => {
    if (!printing) return undefined;
    const done = () => { delete document.body.dataset.print; setPrinting(null); };
    document.body.dataset.print = 'loto';
    window.addEventListener('afterprint', done, { once: true });
    const frame = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(frame); window.removeEventListener('afterprint', done); delete document.body.dataset.print; };
  }, [printing]);

  const latest = editing?.id ? list.find(b => b.id === editing.id) || editing : editing;
  const izin = editing?.id ? editing.izin || {} : { ubah: canCreate };
  const fullEdit = Boolean(izin.ubah);
  const ownSleep = Boolean(izin.jamTidurSendiri);
  const canSave = fullEdit || ownSleep;
  const dirty = useMemo(() => Boolean(editing && form) && JSON.stringify(form) !== JSON.stringify(toForm(editing)), [editing, form]);
  const changedOnServer = Boolean(editing?.id && latest && latest.updatedAt !== editing.updatedAt);
  const counts = useMemo(() => list.reduce((acc, b) => ({ ...acc, [b.status]: (acc[b.status] || 0) + 1 }), {}), [list]);
  const shown = filter === 'SEMUA' ? list : list.filter(b => b.status === filter);
  const taps = useMemo(() => new Map((latest?.tapKartu || []).map(t => [t.sid, t])), [latest]);
  const minSleep = latest?.minJamTidur || 6;

  const open = briefing => {
    setEditing(briefing);
    setForm(toForm(briefing));
    setFormError('');
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };
  const openNew = () => open({ id: null, status: 'DRAFT', waktu: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) });
  const close = () => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tetap keluar?')) return;
    setEditing(null);
    setForm(null);
    setFormError('');
  };

  // Dibuka dari izin LOTO sesi yang sama.
  useEffect(() => {
    if (loading || editing) return;
    const target = takePendingOpen('hadir');
    if (!target) return;
    const match = list.find(b => b.idBox === target.idBox && Number(b.sessionId) === Number(target.sessionId));
    if (match) open(match);
    else toast('Daftar hadir untuk sesi box ini belum ada (belum ada mekanik/foreman yang tap).', 'fail');
    // open() hanya mengubah state halaman ini.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, list, editing]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const setDok = (key, value) => setForm(f => ({ ...f, dokumen: { ...f.dokumen, [key]: value } }));
  const setPeserta = (index, patch) => setForm(f => ({ ...f, peserta: f.peserta.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
  const addPeserta = () => setForm(f => (f.peserta.length >= MAX_PESERTA ? f : { ...f, peserta: [...f.peserta, blankPeserta()] }));
  const removePeserta = index => setForm(f => ({ ...f, peserta: pad(f.peserta.filter((_, i) => i !== index)) }));

  const save = async event => {
    event?.preventDefault();
    if (saving || !canSave) return null;
    setSaving(true);
    setFormError('');
    try {
      const result = editing.id ? await briefingService.update(editing.id, form) : await briefingService.create(form);
      const saved = result.data;
      setEditing(saved);
      setForm(toForm(saved));
      toast(saved.status === 'LENGKAP' ? 'Daftar hadir lengkap dan sudah ditandatangani.' : 'Daftar hadir disimpan.');
      load();
      return saved;
    } catch (error) {
      setFormError(errorMessage(error));
      topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const sign = async slot => {
    if (dirty) { toast('Simpan perubahan dulu sebelum menandatangani.', 'fail'); return; }
    const label = slot === 'yangMemimpin' ? '"Yang memimpin"' : '"Mengetahui"';
    if (!window.confirm(`Tanda tangani kolom ${label}? Tanda tangan tercatat atas nama akun Anda.`)) return;
    setSaving(true);
    setFormError('');
    try {
      const saved = (await briefingService.sign(editing.id, slot)).data;
      setEditing(saved);
      setForm(toForm(saved));
      toast('Tanda tangan tersimpan.');
      load();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id || !window.confirm(`Hapus daftar hadir #${editing.id}? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await briefingService.delete(editing.id);
      toast('Daftar hadir dihapus.');
      setEditing(null);
      setForm(null);
      load();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  const openPermit = () => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tetap pindah ke izin LOTO?')) return;
    requestOpen({ kind: 'izin', idBox: editing.idBox, sessionId: editing.sessionId });
    setActiveTab('izin-loto');
  };

  const print = () => {
    if (dirty) { toast('Simpan perubahan dulu sebelum mencetak.', 'fail'); return; }
    setPrinting(latest);
  };

  const printLayer = printing ? createPortal(<BriefingPrint briefing={printing} />, document.body) : null;

  /* ------------------------------ Daftar ------------------------------ */
  if (!editing) {
    return (
      <div className="w-full space-y-5">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-mono-tech text-base font-bold uppercase text-red-600 sm:text-lg"><i className="fa-solid fa-users-line mr-2" aria-hidden="true"></i>Daftar Hadir Sosialisasi</h1>
            <p className="mt-1 text-xs text-slate-500">
              Formulir F-HSE-105. Peserta terisi otomatis dari tap kartu di box; tiap peserta mengisi jam tidurnya, foreman dan supervisor menandatangani lewat akun.
              {role === 'teknisi' && ' Anda melihat daftar hadir yang Anda ikuti.'}
            </p>
          </div>
          {canCreate && (
            <button type="button" onClick={openNew} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-xs font-bold text-red-700 hover:bg-red-50">
              <i className="fa-solid fa-plus" aria-hidden="true"></i>Daftar hadir baru (manual)
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Saring status daftar hadir">
          {['SEMUA', 'DRAFT', 'LENGKAP'].map(key => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
              className={`min-h-10 rounded-full border px-4 text-xs font-bold ${filter === key ? 'border-red-600 bg-red-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-red-300'}`}>
              {key === 'SEMUA' ? `Semua (${list.length})` : `${STATUS[key].label} (${counts[key] || 0})`}
            </button>
          ))}
        </div>

        {loadError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        {loading ? <p role="status" className="text-sm text-slate-500">Memuat daftar hadir…</p> : shown.length === 0 ? (
          list.length === 0 ? (
            <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600 sm:p-8">
              <p className="font-bold text-slate-800">Belum ada daftar hadir. Alurnya:</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs sm:text-sm">
                <li><b>Mekanik dan foreman tap kartu di box</b> → daftar hadir terbuat: nama, jabatan, tanggal, jam. Tap kartu = tanda tangan peserta.</li>
                <li><b>Foreman melengkapi</b> pembicara, lokasi, dan dokumen yang disosialisasikan (mis. IK Service &amp; JSA).</li>
                <li><b>Tiap peserta mengisi jam tidurnya</b> lewat akunnya (atau diisi foreman). Kurang dari batas jam tidur ditandai merah.</li>
                <li><b>Foreman tanda tangan "Yang memimpin"</b>, <b>supervisor "Mengetahui"</b> → status <b>Lengkap</b>.</li>
              </ol>
              {canCreate && (
                <button type="button" onClick={openNew} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-5 text-xs font-bold text-white shadow-md shadow-red-500/20 hover:bg-red-700">
                  <i className="fa-solid fa-file-pen" aria-hidden="true"></i>Buka formulir F-HSE-105
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada daftar hadir dengan status ini.</div>
          )
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {shown.map(b => (
              <li key={b.id}>
                <button type="button" onClick={() => open(b)} className="w-full space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-red-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={b.status} />
                    {b.peringatan?.length > 0 && <span className="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">{b.peringatan.length} kurang tidur</span>}
                    <span className="ml-auto font-mono text-[11px] text-slate-400">#{b.id}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{b.namaDokumen || <span className="font-semibold italic text-slate-400">Dokumen yang disosialisasikan belum diisi</span>}</p>
                  <p className="text-xs text-slate-500">
                    {hariOf(b.tanggalISO)}, {formatDate(b.tanggalISO)}{b.waktu ? ` ${b.waktu}` : ''} · {b.idBox ? `${b.idBox}${b.unit ? ` (${b.unit})` : ''}` : 'Manual'}
                    {b.lokasi ? ` · ${b.lokasi}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(b.peserta || []).length} peserta
                    {b.status === 'DRAFT' && b.kekurangan?.length ? <span className="text-amber-700"> · {b.kekurangan.length} hal belum lengkap</span> : null}
                    {b.izin?.jamTidurSendiri && (b.peserta || []).some(x => x.sid === sessionUser?.sid && (x.jamTidur === null || x.jamTidur === undefined)) ? <span className="font-semibold text-sky-700"> · isi jam tidur Anda</span> : null}
                    {b.izin?.ttdMemimpin || b.izin?.ttdMengetahui ? <span className="font-semibold text-sky-700"> · perlu tanda tangan Anda</span> : null}
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
  const ttd = latest?.tandaTangan || {};
  const lock = !fullEdit;
  const myRow = form.peserta.findIndex(x => x.sid && x.sid === sessionUser?.sid);
  return (
    <form onSubmit={save} className="w-full space-y-4 pb-24">
      <div ref={topRef} className="space-y-1 border-b border-gray-200 pb-3">
        <button type="button" onClick={close} className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-slate-500 hover:text-red-600">
          <i className="fa-solid fa-arrow-left" aria-hidden="true"></i>Daftar hadir
        </button>
        <h1 className="font-mono-tech text-base font-bold uppercase text-red-600 sm:text-lg">
          {editing.id ? `Daftar hadir #${editing.id}` : 'Daftar hadir manual baru'}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <StatusBadge status={editing.status} />
          {editing.idBox && <span>{editing.idBox}{latest?.unit ? ` (${latest.unit})` : ''} · sesi {editing.sessionId}</span>}
        </div>
      </div>

      {formError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">{formError}</p>}
      {changedOnServer && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>Ada perubahan baru (misalnya peserta baru tap di box atau mengisi jam tidur).</span>
          <button type="button" onClick={() => open(latest)} className="min-h-9 rounded-lg border border-amber-400 bg-white px-3 font-bold">Muat versi terbaru</button>
        </div>
      )}
      {myRow >= 0 && (fullEdit || ownSleep) && (
        <div className="flex flex-col gap-2 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sky-900 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-wrap items-center gap-2 text-sm font-semibold" htmlFor="dh-jam-saya">
            <i className="fa-solid fa-bed" aria-hidden="true"></i>Jam tidur Anda sebelum bekerja:
            <span className="inline-flex items-center gap-1">
              <input id="dh-jam-saya" type="number" inputMode="decimal" min="0" max="24" step="0.5" disabled={saving}
                className="h-11 w-24 rounded-lg border border-sky-400 bg-white px-3 text-center text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.peserta[myRow].jamTidur} onChange={e => setPeserta(myRow, { jamTidur: e.target.value })} />
              <span className="text-xs">jam</span>
            </span>
          </label>
          <p className="text-[11px]">{ownSleep ? 'Lalu tekan Simpan. Kolom lain diisi foreman.' : `Minimal ${minSleep} jam; kurang dari itu ditandai merah.`}</p>
        </div>
      )}
      {latest?.peringatan?.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-bold"><i className="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Kurang tidur (di bawah {minSleep} jam) — perlu evaluasi kelelahan sebelum bekerja:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{latest.peringatan.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {editing.status === 'DRAFT' && editing.kekurangan?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          <p className="font-bold">Lengkap setelah diisi:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{editing.kekurangan.map(g => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
      {!canSave && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Anda hanya bisa melihat daftar hadir ini.</p>}

      <div className={sheetCls}>
        <fieldset disabled={lock || saving} className="min-w-0">
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
                <td rowSpan={2} className={`${edCell} px-2 py-1 text-center font-bold`}>Daftar Hadir Sosialisasi</td>
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
            <colgroup><col className="w-28 sm:w-40" /><col /></colgroup>
            <tbody>
              {[['departemen', 'Departemen', 100], ['pembicara', 'Pembicara', 100], ['lokasi', 'Lokasi', 200], ['namaDokumen', 'Nama Dokumen', 200], ['revisiDokumen', 'Revisi', 20]].map(([key, label, max]) => (
                <React.Fragment key={key}>
                  <tr>
                    <th scope="row" className={edRowHead}><label htmlFor={`dh-${key}`}>{label}</label></th>
                    <td className={edCell}><input id={`dh-${key}`} className={edInput} maxLength={max} placeholder={key === 'namaDokumen' ? 'mis. IK Service & JSA' : undefined} value={form[key]} onChange={e => set(key, e.target.value)} /></td>
                  </tr>
                  {key === 'departemen' && (
                    <tr>
                      <th scope="row" className={edRowHead}><label htmlFor="dh-tanggal">Hari/Tanggal</label></th>
                      <td className={edCell}>
                        <div className="flex flex-wrap items-center">
                          <span className="min-w-[4.5rem] px-2 text-sm font-semibold text-slate-700">{hariOf(form.tanggalISO) || '—'}</span>
                          <input id="dh-tanggal" type="date" required className={`${edInput} w-auto flex-1`} value={form.tanggalISO} onChange={e => set('tanggalISO', e.target.value)} />
                          <label className="flex items-center"><span className={`${edLabel} px-2 sm:pt-0`}>Waktu :</span><input aria-label="Waktu" type="time" className={`${edInput} w-32`} value={form.waktu} onChange={e => set('waktu', e.target.value)} /></label>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              <tr>
                <th scope="row" className={edRowHead}><label htmlFor="dh-tgl-efektif">Tanggal Efektif</label></th>
                <td className={edCell}><input id="dh-tgl-efektif" type="date" className={edInput} value={form.tanggalEfektifDokumen} onChange={e => set('tanggalEfektifDokumen', e.target.value)} /></td>
              </tr>
            </tbody>
          </table>
        </fieldset>

        <p className="py-2 text-center text-xs font-bold italic text-slate-900 underline sm:text-sm">Dengan ini kami menyatakan bahwa prosedur telah disampaikan dan dipahami.</p>

        <div className="relative overflow-x-auto">
          <table className={`${edTable} min-w-[700px] table-fixed`}>
            <colgroup><col className="w-10" /><col /><col className="w-32 sm:w-40" /><col className="w-24" /><col className="w-28 sm:w-32" /><col className="w-36 sm:w-44" /></colgroup>
            <thead>
              <tr>
                {['No', 'Nama', 'Instansi/Dept.', 'Jam tidur', 'Jabatan', 'Tanda tangan'].map(h => <th key={h} scope="col" className={edHead}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {form.peserta.map((x, i) => {
                const mine = Boolean(x.sid) && x.sid === sessionUser?.sid;
                const sleepEditable = !saving && (fullEdit || (ownSleep && mine));
                const tired = x.jamTidur !== '' && Number(String(x.jamTidur).replace(',', '.')) < minSleep;
                const tap = x.sid ? taps.get(x.sid) : null;
                return (
                  <tr key={i} className={mine ? 'bg-sky-50/60' : undefined}>
                    <td className={`${edCell} text-center text-xs font-semibold text-slate-600`}>{i + 1}</td>
                    <td className={edCell}>
                      <div className="flex items-center">
                        <input aria-label={`Nama peserta ${i + 1}`} className={edInput} maxLength={100} disabled={lock || saving} value={x.nama} onChange={e => setPeserta(i, { nama: e.target.value })} />
                        {fullEdit && <button type="button" onClick={() => removePeserta(i)} aria-label={`Hapus peserta ${i + 1}`} className={rowDeleteCls}><i className="fa-solid fa-xmark" aria-hidden="true"></i></button>}
                      </div>
                    </td>
                    <td className={edCell}><input aria-label={`Instansi peserta ${i + 1}`} className={edInput} maxLength={100} disabled={lock || saving} placeholder={x.nama && form.departemen ? form.departemen : undefined} value={x.instansi} onChange={e => setPeserta(i, { instansi: e.target.value })} /></td>
                    <td className={`${edCell} ${tired ? 'bg-red-50' : ''}`}>
                      <div className="flex items-center">
                        <input aria-label={`Jam tidur peserta ${i + 1}`} type="number" inputMode="decimal" min="0" max="24" step="0.5" disabled={!sleepEditable}
                          className={`${edInput} text-center ${tired ? 'font-bold text-red-700' : ''} ${sleepEditable && mine && !fullEdit ? 'ring-2 ring-inset ring-sky-400' : ''}`}
                          value={x.jamTidur} onChange={e => setPeserta(i, { jamTidur: e.target.value })} />
                        <span className="pr-2 text-[10px] text-slate-500">jam</span>
                      </div>
                    </td>
                    <td className={edCell}><input aria-label={`Jabatan peserta ${i + 1}`} className={edInput} maxLength={100} disabled={lock || saving} value={x.jabatan} onChange={e => setPeserta(i, { jabatan: e.target.value })} /></td>
                    <td className={`${edCell} px-1`}>{tap?.masuk && <SignChip title={`Tap kartu masuk ${tglJam(tap.masuk)}`}>kartu {jam(tap.masuk)}</SignChip>}</td>
                  </tr>
                );
              })}
              {fullEdit && form.peserta.length < MAX_PESERTA && (
                <tr><td colSpan={6} className={edCell}><button type="button" onClick={addPeserta} className={addRowCls}><i className="fa-solid fa-plus mr-1" aria-hidden="true"></i>Tambah baris peserta</button></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <fieldset disabled={lock || saving} className="min-w-0">
          <table className={`${edTable} mt-3 table-fixed`}>
            <tbody>
              <tr>
                {[['yangMemimpin', 'Yang Memimpin,', 'Foreman', 'ttdMemimpin'], ['mengetahui', 'Mengetahui :', 'Supervisor', 'ttdMengetahui']].map(([key, head, caption, permission]) => (
                  <td key={key} className={`${edCell} w-1/2 align-top`}>
                    <p className="px-2 pt-1.5 text-xs font-bold">{head}</p>
                    <div className="flex min-h-12 flex-wrap items-center gap-1 px-2 py-1">
                      {ttd[key]
                        ? <SignChip title={`Tanda tangan akun ${tglJam(ttd[key].waktu)}`}>{ttd[key].nama} · {tglJam(ttd[key].waktu)}</SignChip>
                        : izin[permission] && editing.id
                          ? <button type="button" onClick={() => sign(key)} disabled={saving} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><i className="fa-solid fa-signature" aria-hidden="true"></i>Tanda tangani</button>
                          : <span className="text-[10px] italic text-slate-400">Tanda tangan: akun {caption.toLowerCase()}</span>}
                    </div>
                    <input aria-label={`Nama ${caption.toLowerCase()}`} placeholder="Nama" className={`${edInput} font-semibold`} maxLength={100} value={form[key]} onChange={e => set(key, e.target.value)} />
                    <p className="mx-2 border-t border-slate-400 py-0.5 text-center text-[10px] text-slate-600">{caption}</p>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </fieldset>
      </div>

      <p className="mx-auto max-w-5xl text-[11px] text-slate-500">
        Tanda <span className="font-semibold text-emerald-700">✓ hijau</span> = tanda tangan elektronik: tap kartu di box (peserta) atau tanda tangan akun (yang memimpin, mengetahui).
        Batas jam tidur minimal {minSleep} jam. Baris kosong tidak disimpan.
      </p>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {canSave && (
          <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-5 text-xs font-bold uppercase tracking-wide text-white shadow-md shadow-red-500/20 hover:bg-red-700 disabled:opacity-50">
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} aria-hidden="true"></i>{saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        )}
        {editing.id && (
          <button type="button" onClick={print} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <i className="fa-solid fa-print" aria-hidden="true"></i>Cetak F-HSE-105
          </button>
        )}
        {editing.idBox && (
          <button type="button" onClick={openPermit} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <i className="fa-solid fa-file-signature" aria-hidden="true"></i>Izin LOTO sesi ini
          </button>
        )}
        {dirty && canSave && <span className="text-[11px] font-semibold text-amber-700">Belum disimpan</span>}
        {editing.id && izin.hapus && (
          <button type="button" onClick={remove} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold text-slate-400 hover:text-red-600">
            <i className="fa-solid fa-trash" aria-hidden="true"></i>Hapus
          </button>
        )}
      </div>
      {printLayer}
    </form>
  );
}
