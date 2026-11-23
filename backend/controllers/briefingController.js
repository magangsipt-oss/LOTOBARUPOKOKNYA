import BriefingModel from '../models/briefingModel.js';
import { tapsFor } from '../models/sessionTaps.js';
import { canSeeBriefing, formatBriefing, parseBriefingPayload, validateBriefingPayload } from '../domain/briefing.js';
import { viewerOf } from '../domain/personnel.js';
import { dateRange } from '../domain/formFields.js';

const errorResponse = (res, error, operation) => {
  const status = [400, 403, 404, 409].includes(error.status) ? error.status : 500;
  if (status === 500) console.error(`Error ${operation}:`, error.message);
  return res.status(status).json({
    success: false,
    message: status === 500 ? 'Gagal memproses daftar hadir.' : error.message,
    ...(status === 500 ? { error: 'REQUEST_FAILED' } : {})
  });
};

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw Object.assign(new Error('ID daftar hadir tidak valid.'), { status: 400 });
  }
  return Number(value);
}

const notFound = res => res.status(404).json({ success: false, message: 'Daftar hadir tidak ditemukan.' });

async function present(rows, viewer) {
  const visible = rows.filter(row => canSeeBriefing(row, parseBriefingPayload(row), viewer));
  const taps = await BriefingModel.sessionTaps(visible);
  return visible.map(row => formatBriefing(row, { viewer, taps: tapsFor(taps, row) }));
}

const handle = (operation, work) => async (req, res) => {
  try { return await work(req, res, viewerOf(req.auth)); }
  catch (error) { return errorResponse(res, error, operation); }
};

const BriefingController = {
  getAll: handle('getAllBriefings', async (req, res, viewer) =>
    res.status(200).json({ success: true, data: await present(await BriefingModel.getAll(dateRange(req.query)), viewer) })),

  getById: handle('getBriefing', async (req, res, viewer) => {
    const row = await BriefingModel.getById(parseId(req.params.id));
    const [briefing] = row ? await present([row], viewer) : [];
    return briefing ? res.status(200).json({ success: true, data: briefing }) : notFound(res);
  }),

  create: handle('createBriefing', async (req, res, viewer) => {
    const row = await BriefingModel.create({ payload: validateBriefingPayload(req.body?.data), viewer });
    const [briefing] = await present([row], viewer);
    return res.status(201).json({ success: true, data: briefing });
  }),

  update: handle('updateBriefing', async (req, res, viewer) => {
    const id = parseId(req.params.id);
    const row = await BriefingModel.update(id, validateBriefingPayload(req.body?.data), viewer);
    if (!row) return notFound(res);
    const [briefing] = await present([row], viewer);
    return res.status(200).json({ success: true, data: briefing });
  }),

  sign: handle('signBriefing', async (req, res, viewer) => {
    const row = await BriefingModel.sign(parseId(req.params.id), String(req.body?.slot || ''), viewer);
    if (!row) return notFound(res);
    const [briefing] = await present([row], viewer);
    return res.status(200).json({ success: true, data: briefing });
  }),

  delete: handle('deleteBriefing', async (req, res) => {
    const deleted = await BriefingModel.delete(parseId(req.params.id), req.auth.role);
    return deleted ? res.status(200).json({ success: true }) : notFound(res);
  })
};

export default BriefingController;
