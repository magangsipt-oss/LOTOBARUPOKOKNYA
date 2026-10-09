import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  id_box: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  event: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  rfid_uid: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  lat: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: false,
    defaultValue: 0
  },
  lng: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'audit_logs',
  timestamps: true,
  createdAt: 'tanggal',
  updatedAt: false
});

export default AuditLog;
