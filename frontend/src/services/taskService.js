import api from './api';

const taskService = {
  getMine: async () => (await api.get('/tasks')).data
};

export default taskService;
