import api from './api';

const lotoPermitService = {
  // params opsional untuk rekap: { dari: 'YYYY-MM-DD', sampai: 'YYYY-MM-DD' }
  getAll: async params => (await api.get('/loto-permits', { params })).data,
  create: async data => (await api.post('/loto-permits', { data })).data,
  update: async (id, data) => (await api.put(`/loto-permits/${encodeURIComponent(id)}`, { data })).data,
  approve: async id => (await api.post(`/loto-permits/${encodeURIComponent(id)}/approve`)).data,
  delete: async id => (await api.delete(`/loto-permits/${encodeURIComponent(id)}`)).data
};

export default lotoPermitService;
