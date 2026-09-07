import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const RefuelingLog = sequelize.define('RefuelingLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  id_box: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  fuelman_uid: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  fuelman_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: false
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: true
  },
  duration_seconds: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true
  },
  longitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true
  },
  is_loto_active: {
    type: DataTypes.TINYINT,
    allowNull: true
  }
}, {
  tableName: 'refueling_logs',
  timestamps: false
});

export default RefuelingLog;
