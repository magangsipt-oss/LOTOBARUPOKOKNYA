import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const MaintenanceLog = sequelize.define('MaintenanceLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  waktu: {
    type: DataTypes.DATE,
    allowNull: false
  },
  id_box: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  mesin: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  jenis: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  estimasi: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  teknisi: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  pengawas: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  deskripsi: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  foto: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'maintenance_logs',
  timestamps: false
});

export default MaintenanceLog;
