import LotoPermitModel from '../models/lotoPermitModel.js';
import { formatPermit, validateLotoPermitPayload } from '../domain/lotoPermit.js';

const errorResponse = (res, error, operation) => {
  const status = [400, 404, 409].includes(error.status) ? error.status : 500;
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

const LotoPermitController = {
  getAll: async (_req, res) => {
    try {
      const rows = await LotoPermitModel.getAll();
      return res.status(200).json({ success: true, data: rows.map(formatPermit) });
    } catch (error) {
      return errorResponse(res, error, 'getAllLotoPermits');
    }
  },

  getById: async (req, res) => {
    try {
      const row = await LotoPermitModel.getById(parseId(req.params.id));
      if (!row) return notFound(res);
      return res.status(200).json({ success: true, data: formatPermit(row) });
    } catch (error) {
      return errorResponse(res, error, 'getLotoPermit');
    }
  },

  create: async (req, res) => {
    try {
      const payload = validateLotoPermitPayload(req.body?.data);
      const row = await LotoPermitModel.create({ payload, createdBy: req.auth.user.sid });
      return res.status(201).json({ success: true, data: formatPermit(row) });
    } catch (error) {
      return errorResponse(res, error, 'createLotoPermit');
    }
  },

  update: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const payload = validateLotoPermitPayload(req.body?.data);
      const row = await LotoPermitModel.update(id, payload, req.auth.user.sid);
      if (!row) return notFound(res);
      return res.status(200).json({ success: true, data: formatPermit(row) });
    } catch (error) {
      return errorResponse(res, error, 'updateLotoPermit');
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
