import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/useAuth';
import lotoPermitService from '../services/lotoPermitService';
import briefingService from '../services/briefingService';
import { livePoll } from '../services/live';
import { openTaskTarget, tglJam } from '../utils/fieldForm';

// Rekap laporan untuk HSE/safety, pengawas, dan admin: tujuan akhir izin LOTO dan daftar hadir.
// Periode dan unit bisa disaring, lalu diekspor ke Excel atau dicetak untuk laporan berkala.

const TZ = 'Asia/Makassar';
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shiftDays = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const monthStart = iso => `${iso.slice(0, 8)}01`;
const prevMonth = iso => { const d = new Date(`${monthStart(iso)}T00:00:00Z`); d.setUTCDate(0); return { dari: monthStart(d.toISOString().slice(0, 10)), sampai: d.toISOString().slice(0, 10) }; };
const formatDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');
const toast = (msg, type = 'ok') => window.dispatchEvent(new CustomEvent('eloto-toast', { detail: { msg, type } }));
const errorMessage = error => error?.response?.data?.message || error?.message || 'Gagal memuat rekap.';
const placeOf = x => (x.idBox ? `${x.idBox}${x.unit ? ` (${x.unit})` : ''}` : 'Manual');
const hoursBetween = (a, b) => (a && b ? Math.round(((new Date(b) - new Date(a)) / 36e5) * 10) / 10 : null);
const STATUS_IZIN = { DRAFT: 'Draft', MENUNGGU: 'Menunggu persetujuan', AKTIF: 'Aktif', DITUTUP: 'Ditutup' };
const STALE_HOURS = 24;

const mekanikOf = p => [...new Set(['I', 'II', 'III'].flatMap(s => String(p.shift?.[s]?.teknisi || '').split(',').map(n => n.trim()).filter(Boolean)))].join(', ');
const leaderOf = p => p.persetujuan?.nama || [...new Set(['I', 'II', 'III'].map(s => p.shift?.[s]?.groupLeader).filter(Boolean))].join(', ');
const hasilOf = p => (p.selesai?.status === 'SELESAI' ? 'Selesai' : p.selesai?.status === 'BELUM' ? 'Belum selesai (izin ulang)' : '');

function Stat({ label, value, tone = 'slate', hint }) {
  const tones = { slate: 'text-slate-900', red: 'text-red-600', amber: 'text-amber-600', emerald: 'text-emerald-600', sky: 'text-sky-700' };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 font-mono-tech text-xl font-black ${tones[tone]}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function RekapPrint({ range, unit, permits, briefings, summary }) {
  return (
    <div className="loto-print">
      <p className="lp-bold" style={{ fontSize: '13pt' }}>Rekap Laporan Formulir Lapangan E-LOTO</p>
      <p>Periode {formatDate(range.dari)} s/d {formatDate(range.sampai)} · Unit: {unit || 'semua'} · Dicetak {new Date().toLocaleString('id-ID', { timeZone: TZ })} WITA</p>
      <p style={{ margin: '6px 0' }}>
        Izin LOTO: {summary.izin.total} (ditutup {summary.izin.ditutup}, aktif {summary.izin.aktif}, menunggu {summary.izin.menunggu}, draft {summary.izin.draft}; terbuka &gt; {STALE_HOURS} jam: {summary.izin.lama}) ·
        Daftar hadir: {summary.hadir.total} (lengkap {summary.hadir.lengkap}, peserta {summary.hadir.peserta}, kurang tidur {summary.hadir.kurangTidur})
      </p>
      <table className="lp-table">
        <tbody>
          <tr className="lp-sub"><th>Tanggal</th><th>No</th><th>Unit</th><th>Pekerjaan</th><th>Mekanik</th><th>Penanggung jawab</th><th>Status</th><th>Hasil</th></tr>
          {permits.map(p => (
            <tr key={p.id}><td>{formatDate(p.tanggalISO)}</td><td>#{p.id}</td><td>{placeOf(p)}</td><td>{p.pekerjaan}</td><td>{mekanikOf(p)}</td><td>{leaderOf(p)}</td><td>{STATUS_IZIN[p.status]}</td><td>{hasilOf(p)}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="lp-table" style={{ marginTop: 8 }}>
        <tbody>
          <tr className="lp-sub"><th>Tanggal</th><th>No</th><th>Unit</th><th>Dokumen</th><th>Pembicara</th><th>Peserta</th><th>Kurang tidur</th><th>Status</th></tr>
          {briefings.map(b => (
            <tr key={b.id}><td>{formatDate(b.tanggalISO)}</td><td>#{b.id}</td><td>{placeOf(b)}</td><td>{b.namaDokumen}</td><td>{b.pembicara}</td><td>{b.peserta?.length || 0}</td><td>{(b.peringatan || []).join('; ')}</td><td>{b.status === 'LENGKAP' ? 'Lengkap' : 'Draft'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Rekap() {
  const { setActiveTab } = useAuth();
  const today = todayLocal();
  const [range, setRange] = useState({ dari: monthStart(today), sampai: today });
  const [unit, setUnit] = useState('');
  const [data, setData] = useState({ permits: [], briefings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [permits, briefings] = await Promise.all([
        lotoPermitService.getAll(range),
        briefingService.getAll(range).catch(() => ({ data: [] }))
      ]);
      setData({ permits: permits.data || [], briefings: briefings.data || [] });
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
    return livePoll(load, 60000);
  }, [load]);

  useEffect(() => {
    if (!printing) return undefined;
    const done = () => { delete document.body.dataset.print; setPrinting(false); };
    document.body.dataset.print = 'loto';
    window.addEventListener('afterprint', done, { once: true });
    const frame = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(frame); window.removeEventListener('afterprint', done); delete document.body.dataset.print; };
  }, [printing]);

  const units = useMemo(() => [...new Set([...data.permits, ...data.briefings].map(placeOf))].sort(), [data]);
  const permits = useMemo(() => data.permits.filter(p => !unit || placeOf(p) === unit), [data.permits, unit]);
  const briefings = useMemo(() => data.briefings.filter(b => !unit || placeOf(b) === unit), [data.briefings, unit]);

  const summary = useMemo(() => {
    const now = new Date();
    const count = status => permits.filter(p => p.status === status).length;
    const open = permits.filter(p => p.status !== 'DITUTUP');
    return {
      izin: {
        total: permits.length, ditutup: count('DITUTUP'), aktif: count('AKTIF'), menunggu: count('MENUNGGU'), draft: count('DRAFT'),
        selesai: permits.filter(p => p.selesai?.status === 'SELESAI').length,
        lama: open.filter(p => hoursBetween(p.createdAt, now) > STALE_HOURS).length
      },
      hadir: {
        total: briefings.length, lengkap: briefings.filter(b => b.status === 'LENGKAP').length,
        peserta: briefings.reduce((n, b) => n + (b.peserta?.length || 0), 0),
        kurangTidur: briefings.reduce((n, b) => n + (b.peringatan?.length || 0), 0)
      },
      perhatian: [
        ...open.map(p => ({ key: `izin-${p.id}`, jenis: 'izin', formId: p.id, text: `Izin LOTO #${p.id} · ${placeOf(p)} · ${STATUS_IZIN[p.status]}${hoursBetween(p.createdAt, now) > STALE_HOURS ? ` · terbuka ${Math.floor(hoursBetween(p.createdAt, now))} jam` : ''}`, urgent: hoursBetween(p.createdAt, now) > STALE_HOURS })),
        ...briefings.filter(b => b.peringatan?.length).map(b => ({ key: `tidur-${b.id}`, jenis: 'hadir', formId: b.id, text: `Kurang tidur · daftar hadir #${b.id} (${formatDate(b.tanggalISO)}): ${b.peringatan.join('; ')}`, urgent: true })),
        ...briefings.filter(b => b.status !== 'LENGKAP').map(b => ({ key: `hadir-${b.id}`, jenis: 'hadir', formId: b.id, text: `Daftar hadir #${b.id} · ${placeOf(b)} · belum lengkap: ${(b.kekurangan || []).join(', ')}`, urgent: false }))
      ]
    };
  }, [permits, briefings]);

  const openForm = (jenis, formId) => openTaskTarget({ jenis, formId }, setActiveTab);
  const setQuick = (dari, sampai) => { setLoading(true); setRange({ dari, sampai }); };

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const ringkasan = [
        { Keterangan: 'Periode', Nilai: `${formatDate(range.dari)} s/d ${formatDate(range.sampai)}` },
        { Keterangan: 'Unit', Nilai: unit || 'Semua' },
        { Keterangan: 'Izin LOTO', Nilai: summary.izin.total },
        { Keterangan: 'Izin ditutup', Nilai: summary.izin.ditutup },
        { Keterangan: 'Izin aktif', Nilai: summary.izin.aktif },
        { Keterangan: 'Izin menunggu persetujuan', Nilai: summary.izin.menunggu },
        { Keterangan: 'Izin draft', Nilai: summary.izin.draft },
        { Keterangan: `Izin terbuka > ${STALE_HOURS} jam`, Nilai: summary.izin.lama },
        { Keterangan: 'Daftar hadir', Nilai: summary.hadir.total },
        { Keterangan: 'Daftar hadir lengkap', Nilai: summary.hadir.lengkap },
        { Keterangan: 'Total peserta', Nilai: summary.hadir.peserta },
        { Keterangan: 'Peserta kurang tidur', Nilai: summary.hadir.kurangTidur }
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ringkasan), 'Ringkasan');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(permits.map(p => ({
        Tanggal: formatDate(p.tanggalISO), 'No Izin': p.id, Unit: placeOf(p), 'Project No.': p.projectNo, Lokasi: p.lokasi,
        Pekerjaan: p.pekerjaan, Inspeksi: p.inspeksi === 'NOT_OK' ? 'Not OK' : p.inspeksi, Mesin: (p.mesin || []).map(m => m.nama).join(', '),
        'Titik isolasi': (p.titik || []).map(t => t.nama).join(', '), Mekanik: mekanikOf(p), 'Penanggung jawab': leaderOf(p),
        'Disetujui': tglJam(p.persetujuan?.waktu), Status: STATUS_IZIN[p.status], Hasil: hasilOf(p),
        'PJ Teknis': p.selesai?.pjTeknis || '', 'Ditutup': tglJam(p.penutupan?.waktu),
        'Durasi (jam)': hoursBetween(p.createdAt, p.penutupan?.waktu) ?? ''
      }))), 'Izin LOTO');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(briefings.map(b => ({
        Tanggal: formatDate(b.tanggalISO), Waktu: b.waktu, 'No': b.id, Unit: placeOf(b), Departemen: b.departemen, Lokasi: b.lokasi,
        Pembicara: b.pembicara, 'Nama dokumen': b.namaDokumen, Peserta: b.peserta?.length || 0, 'Kurang tidur': (b.peringatan || []).join('; '),
        'Yang memimpin': b.tandaTangan?.yangMemimpin?.nama || b.yangMemimpin, Mengetahui: b.tandaTangan?.mengetahui?.nama || b.mengetahui,
        Status: b.status === 'LENGKAP' ? 'Lengkap' : 'Draft'
      }))), 'Daftar Hadir');
      const tapsOf = b => new Map((b.tapKartu || []).map(t => [t.sid, t]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(briefings.flatMap(b => {
        const taps = tapsOf(b);
        return (b.peserta || []).map(x => ({
          Tanggal: formatDate(b.tanggalISO), 'Daftar hadir': b.id, Unit: placeOf(b), Nama: x.nama, 'Instansi/Dept.': x.instansi || b.departemen,
          Jabatan: x.jabatan, 'Jam tidur': x.jamTidur ?? '', 'Kurang tidur': x.jamTidur !== null && x.jamTidur !== undefined && x.jamTidur < (b.minJamTidur || 6) ? 'Ya' : '',
          'Tap kartu': tglJam(taps.get(x.sid)?.masuk)
        }));
      })), 'Peserta');
      XLSX.writeFile(wb, `Rekap-ELOTO_${range.dari}_${range.sampai}${unit ? `_${unit.replace(/[^\w-]+/g, '-')}` : ''}.xlsx`);
    } catch (err) {
      toast(`Gagal membuat Excel: ${err.message}`, 'fail');
    }
  };

  const inputCls = 'min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30';
  const chipCls = 'min-h-9 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:border-red-300';

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono-tech text-base font-bold uppercase text-red-600 sm:text-lg"><i className="fa-solid fa-chart-column mr-2" aria-hidden="true"></i>Rekap Laporan</h1>
          <p className="mt-1 text-xs text-slate-500">Semua izin LOTO dan daftar hadir masuk ke sini otomatis. Saring periode dan unit, lalu ekspor ke Excel atau cetak untuk laporan HSE.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportExcel} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><i className="fa-solid fa-file-excel" aria-hidden="true"></i>Ekspor Excel</button>
          <button type="button" onClick={() => setPrinting(true)} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><i className="fa-solid fa-print" aria-hidden="true"></i>Cetak</button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:flex-row lg:items-end">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">Dari<input type="date" className={inputCls} value={range.dari} max={range.sampai} onChange={e => e.target.value && setQuick(e.target.value, range.sampai)} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">Sampai<input type="date" className={inputCls} value={range.sampai} min={range.dari} onChange={e => e.target.value && setQuick(range.dari, e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">Unit
          <select className={inputCls} value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="">Semua unit</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 lg:ml-auto">
          <button type="button" className={chipCls} onClick={() => setQuick(today, today)}>Hari ini</button>
          <button type="button" className={chipCls} onClick={() => setQuick(shiftDays(today, -6), today)}>7 hari</button>
          <button type="button" className={chipCls} onClick={() => setQuick(monthStart(today), today)}>Bulan ini</button>
          <button type="button" className={chipCls} onClick={() => { const m = prevMonth(today); setQuick(m.dari, m.sampai); }}>Bulan lalu</button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p role="status" className="text-sm text-slate-500">Memuat rekap…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="Izin LOTO" value={summary.izin.total} />
            <Stat label="Ditutup" value={summary.izin.ditutup} tone="emerald" hint={`${summary.izin.selesai} selesai`} />
            <Stat label="Aktif" value={summary.izin.aktif} tone="red" />
            <Stat label="Menunggu / draft" value={`${summary.izin.menunggu} / ${summary.izin.draft}`} tone="sky" />
            <Stat label={`Terbuka > ${STALE_HOURS} jam`} value={summary.izin.lama} tone={summary.izin.lama ? 'red' : 'slate'} />
            <Stat label="Daftar hadir" value={summary.hadir.total} hint={`${summary.hadir.lengkap} lengkap`} />
            <Stat label="Peserta" value={summary.hadir.peserta} />
            <Stat label="Kurang tidur" value={summary.hadir.kurangTidur} tone={summary.hadir.kurangTidur ? 'red' : 'slate'} />
          </div>

          {summary.perhatian.length > 0 && (
            <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 sm:p-4">
              <h2 className="text-sm font-bold text-amber-900"><i className="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>Perlu perhatian ({summary.perhatian.length})</h2>
              <ul className="space-y-1">
                {summary.perhatian.map(item => (
                  <li key={item.key}>
                    <button type="button" onClick={() => openForm(item.jenis, item.formId)} className={`w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white ${item.urgent ? 'font-bold text-red-700' : 'text-amber-900'}`}>{item.text}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-800">Izin LOTO ({permits.length})</h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[860px] border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>{['Tanggal', 'No', 'Unit', 'Pekerjaan', 'Mekanik', 'Penanggung jawab', 'Status', 'Hasil'].map(h => <th key={h} className="border-b border-slate-200 px-3 py-2 font-bold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {permits.length ? permits.map(p => (
                    <tr key={p.id} onClick={() => openForm('izin', p.id)} className="cursor-pointer border-b border-slate-100 hover:bg-red-50/50">
                      <td className="px-3 py-2">{formatDate(p.tanggalISO)}</td><td className="px-3 py-2 font-mono">#{p.id}</td><td className="px-3 py-2">{placeOf(p)}</td>
                      <td className="px-3 py-2 font-semibold">{p.pekerjaan || <span className="italic text-slate-400">belum diisi</span>}</td>
                      <td className="px-3 py-2">{mekanikOf(p)}</td><td className="px-3 py-2">{leaderOf(p)}</td>
                      <td className="px-3 py-2">{STATUS_IZIN[p.status]}</td><td className="px-3 py-2">{hasilOf(p)}</td>
                    </tr>
                  )) : <tr><td colSpan={8} className="px-3 py-6 text-center italic text-slate-400">Tidak ada izin LOTO pada periode ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-800">Daftar hadir sosialisasi ({briefings.length})</h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[860px] border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>{['Tanggal', 'No', 'Unit', 'Dokumen', 'Pembicara', 'Peserta', 'Kurang tidur', 'Status'].map(h => <th key={h} className="border-b border-slate-200 px-3 py-2 font-bold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {briefings.length ? briefings.map(b => (
                    <tr key={b.id} onClick={() => openForm('hadir', b.id)} className="cursor-pointer border-b border-slate-100 hover:bg-red-50/50">
                      <td className="px-3 py-2">{formatDate(b.tanggalISO)}</td><td className="px-3 py-2 font-mono">#{b.id}</td><td className="px-3 py-2">{placeOf(b)}</td>
                      <td className="px-3 py-2 font-semibold">{b.namaDokumen || <span className="italic text-slate-400">belum diisi</span>}</td>
                      <td className="px-3 py-2">{b.pembicara}</td><td className="px-3 py-2">{b.peserta?.length || 0}</td>
                      <td className={`px-3 py-2 ${b.peringatan?.length ? 'font-bold text-red-700' : ''}`}>{(b.peringatan || []).join('; ') || '—'}</td>
                      <td className="px-3 py-2">{b.status === 'LENGKAP' ? 'Lengkap' : 'Draft'}</td>
                    </tr>
                  )) : <tr><td colSpan={8} className="px-3 py-6 text-center italic text-slate-400">Tidak ada daftar hadir pada periode ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {printing && createPortal(<RekapPrint range={range} unit={unit} permits={permits} briefings={briefings} summary={summary} />, document.body)}
    </div>
  );
}
