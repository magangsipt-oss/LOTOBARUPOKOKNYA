import api from './api';

const briefingService = {
  getAll: async () => (await api.get('/briefings')).data,
  create: async data => (await api.post('/briefings', { data })).data,
  update: async (id, data) => (await api.put(`/briefings/${encodeURIComponent(id)}`, { data })).data,
  sign: async (id, slot) => (await api.post(`/briefings/${encodeURIComponent(id)}/sign`, { slot })).data,
  delete: async id => (await api.delete(`/briefings/${encodeURIComponent(id)}`)).data
};

export default briefingService;
