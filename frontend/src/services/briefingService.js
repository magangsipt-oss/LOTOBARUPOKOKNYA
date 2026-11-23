import api from './api';

const briefingService = {
  // params opsional untuk rekap: { dari: 'YYYY-MM-DD', sampai: 'YYYY-MM-DD' }
  getAll: async params => (await api.get('/briefings', { params })).data,
  create: async data => (await api.post('/briefings', { data })).data,
  update: async (id, data) => (await api.put(`/briefings/${encodeURIComponent(id)}`, { data })).data,
  sign: async (id, slot) => (await api.post(`/briefings/${encodeURIComponent(id)}/sign`, { slot })).data,
  delete: async id => (await api.delete(`/briefings/${encodeURIComponent(id)}`)).data
};

export default briefingService;
