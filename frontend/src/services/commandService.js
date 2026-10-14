import api from './api';

const commandService = {
  syncUsers: async (idBox) => {
    const response = await api.post('/commands', { idBox, command: 'SYNC_USERS' });
    return response.data;
  }
};

export default commandService;
