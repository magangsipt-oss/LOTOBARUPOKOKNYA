import api from './api';

const lotoPermitService = {
  getAll: async () => (await api.get('/loto-permits')).data,
  create: async data => (await api.post('/loto-permits', { data })).data,
  update: async (id, data) => (await api.put(`/loto-permits/${encodeURIComponent(id)}`, { data })).data,
  approve: async id => (await api.post(`/loto-permits/${encodeURIComponent(id)}/approve`)).data,
  delete: async id => (await api.delete(`/loto-permits/${encodeURIComponent(id)}`)).data
};

export default lotoPermitService;
