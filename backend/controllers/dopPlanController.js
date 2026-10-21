import DOPPlanModel from '../models/dopPlanModel.js';
import { formatDOPPlan, validateDOPPlanPayload } from '../domain/dopPlan.js';

const errorResponse = (res, error, operation) => {
  const status = [400, 404].includes(error.status) ? error.status : 500;
  if (status === 500) console.error(`Error ${operation}:`, error.message);
  return res.status(status).json({
    success: false,
    message: status === 500 ? 'Gagal memproses data DOP.' : error.message,
    ...(status === 500 ? { error: 'REQUEST_FAILED' } : {})
  });
};

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw Object.assign(new Error('ID DOP tidak valid.'), { status: 400 });
  }
  return Number(value);
}

const DOPPlanController = {
  getAll: async (_req, res) => {
    try {
      const rows = await DOPPlanModel.getAll();
      return res.status(200).json({
        success: true,
        data: rows.map(formatDOPPlan)
      });
    } catch (error) {
      return errorResponse(res, error, 'getAllDOPPlans');
    }
  },

  create: async (req, res) => {
    try {
      const payload = validateDOPPlanPayload(req.body?.data);
      const id = await DOPPlanModel.create({
        planDate: payload.tanggalISO,
        shift: payload.shift,
        payload,
        createdBy: req.auth.user.sid
      });
      return res.status(201).json({
        success: true,
        data: { ...payload, id }
      });
    } catch (error) {
      return errorResponse(res, error, 'createDOPPlan');
    }
  },

  // Melengkapi draft DOP otomatis dari sesi box (atau mengoreksi DOP yang sudah ada).
  complete: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const payload = validateDOPPlanPayload(req.body?.data);
      const row = await DOPPlanModel.complete(id, payload);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Data DOP tidak ditemukan.' });
      }
      return res.status(200).json({ success: true, data: formatDOPPlan(row) });
    } catch (error) {
      return errorResponse(res, error, 'completeDOPPlan');
    }
  },

  delete: async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const deleted = await DOPPlanModel.delete(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Data DOP tidak ditemukan.' });
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      return errorResponse(res, error, 'deleteDOPPlan');
    }
  }
};

export default DOPPlanController;
