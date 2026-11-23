import LotoPermitModel from '../models/lotoPermitModel.js';
import { tapsFor } from '../models/sessionTaps.js';
import { canSeePermit, formatPermit, parsePermitPayload, validateLotoPermitPayload } from '../domain/lotoPermit.js';
import { viewerOf } from '../domain/personnel.js';

const errorResponse = (res, error, operation) => {
  const status = [400, 403, 404, 409].includes(error.status) ? error.status : 500;
  if (status === 500) console.error(`Error ${operation}:`, error.message);
  return res.status(status).json({
    success: false,
    message: status === 500 ? 'Gagal memproses izin LOTO.' : error.message,
    ...(status === 500 ? { error: 'REQUEST_FAILED' } : {})
  });
};

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw Object.assign(new Error('ID izin LOTO tidak valid.'), { status: 400 });
  }
  return Number(value);
}

const notFound = res => res.status(404).json({ success: false, message: 'Izin LOTO tidak ditemukan.' });

// Mekanik dan foreman hanya menerima izin yang ia ikuti; tanda tangan kartu disertakan per sesi box.
async function present(rows, viewer) {
  const visible = rows.filter(row => canSeePermit(row, parsePermitPayload(row), viewer));
  const taps = await LotoPermitModel.sessionTaps(visible);
  return visible.map(row => formatPermit(row, { viewer, taps: tapsFor(taps, row) }));
}

const LotoPermitController = {
  getAll: async (req, res) => {
    try {
      const data = await present(await LotoPermitModel.getAll(), viewerOf(req.auth));
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return errorResponse(res, error, 'getAllLotoPermits');
    }
  },

  getById: async (req, res) => {
    try {
      const row = await LotoPermitModel.getById(parseId(req.params.id));
      const [permit] = row ? await present([row], viewerOf(req.auth)) : [];
      if (!permit) return notFound(res);
      return res.status(200).json({ success: true, data: permit });
    } catch (error) {
      return errorResponse(res, error, 'getLotoPermit');
    }
  },

  create: async (req, res) => {
    try {
      const viewer = viewerOf(req.auth);
      const payload = validateLotoPermitPayload(req.body?.data);
      const row = await LotoPermitModel.create({ payload, createdBy: viewer.sid });
      const [permit] = await present([row], viewer);
      return res.status(201).json({ success: true, data: permit });
    } catch (error) {
      return errorResponse(res, error, 'createLotoPermit');
    }
  },

  update: async (req, res) => {
    try {
      const viewer = viewerOf(req.auth);
      const id = parseId(req.params.id);
      const payload = validateLotoPermitPayload(req.body?.data);
      const row = await LotoPermitModel.update(id, payload, viewer);
      if (!row) return notFound(res);
      const [permit] = await present([row], viewer);
      return res.status(200).json({ success: true, data: permit });
    } catch (error) {
      return errorResponse(res, error, 'updateLotoPermit');
    }
  },

  approve: async (req, res) => {
    try {
      const viewer = viewerOf(req.auth);
      const row = await LotoPermitModel.approve(parseId(req.params.id), viewer);
      if (!row) return notFound(res);
      const [permit] = await present([row], viewer);
      return res.status(200).json({ success: true, data: permit });
    } catch (error) {
      return errorResponse(res, error, 'approveLotoPermit');
    }
  },

  delete: async (req, res) => {
    try {
      const deleted = await LotoPermitModel.delete(parseId(req.params.id), req.auth.role);
      if (!deleted) return notFound(res);
      return res.status(200).json({ success: true });
    } catch (error) {
      return errorResponse(res, error, 'deleteLotoPermit');
    }
  }
};

export default LotoPermitController;
