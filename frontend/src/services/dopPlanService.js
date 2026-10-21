import api from './api';

const dopPlanService = {
  getAll: async () => {
    const response = await api.get('/dop-plans');
    return response.data;
  },

  create: async data => {
    const response = await api.post('/dop-plans', { data });
    return response.data;
  },

  complete: async (id, data) => {
    const response = await api.put(`/dop-plans/${encodeURIComponent(id)}`, { data });
    return response.data;
  },

  delete: async id => {
    const response = await api.delete(`/dop-plans/${encodeURIComponent(id)}`);
    return response.data;
  }
};

export default dopPlanService;
