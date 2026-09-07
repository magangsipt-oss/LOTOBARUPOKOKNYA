import sequelize from '../sequelize.js';
import User from './User.js';
import Box from './Box.js';
import TappingHistory from './TappingHistory.js';
import AuditLog from './AuditLog.js';
import PeopleCounting from './PeopleCounting.js';
import Queue from './Queue.js';
import RfidBuffer from './RfidBuffer.js';
import MaintenanceLog from './MaintenanceLog.js';
import RefuelingLog from './RefuelingLog.js';
import SupervisorBoxTeam from './SupervisorBoxTeam.js';

// ===== ASSOCIATIONS =====

// User -> TappingHistory
User.hasMany(TappingHistory, { foreignKey: 'rfid_uid', sourceKey: 'rfid_uid', as: 'taps' });
TappingHistory.belongsTo(User, { foreignKey: 'rfid_uid', targetKey: 'rfid_uid', as: 'user' });

// User -> Queue
User.hasMany(Queue, { foreignKey: 'rfid_uid', sourceKey: 'rfid_uid', as: 'queueEntries' });
Queue.belongsTo(User, { foreignKey: 'rfid_uid', targetKey: 'rfid_uid', as: 'user' });

// User -> SupervisorBoxTeam
User.hasMany(SupervisorBoxTeam, { foreignKey: 'supervisor_sid', sourceKey: 'sid', as: 'teams' });
SupervisorBoxTeam.belongsTo(User, { foreignKey: 'supervisor_sid', targetKey: 'sid', as: 'supervisor' });

// Box -> TappingHistory
Box.hasMany(TappingHistory, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'taps' });
TappingHistory.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

// Box -> AuditLog
Box.hasMany(AuditLog, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'logs' });
AuditLog.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

// Box -> Queue
Box.hasMany(Queue, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'queue' });
Queue.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

// Box -> RfidBuffer
Box.hasMany(RfidBuffer, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'buffer' });
RfidBuffer.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

// Box -> MaintenanceLog
Box.hasMany(MaintenanceLog, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'maintenance' });
MaintenanceLog.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

// Box -> RefuelingLog
Box.hasMany(RefuelingLog, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'refueling' });
RefuelingLog.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

// Box -> PeopleCounting
Box.hasMany(PeopleCounting, { foreignKey: 'id_box', sourceKey: 'id_box', as: 'peopleCounting' });
PeopleCounting.belongsTo(Box, { foreignKey: 'id_box', targetKey: 'id_box', as: 'box' });

export {
  sequelize,
  User,
  Box,
  TappingHistory,
  AuditLog,
  PeopleCounting,
  Queue,
  RfidBuffer,
  MaintenanceLog,
  RefuelingLog,
  SupervisorBoxTeam
};
