import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const TappingHistory = sequelize.define('TappingHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  id_box: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  rfid_uid: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  nama: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  event_type: {
    type: DataTypes.ENUM('IN', 'OUT', 'CHECK'),
    allowNull: false
  },
  event_text: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  lat: {
    type: DataTypes.DOUBLE,
    allowNull: true
  },
  lng: {
    type: DataTypes.DOUBLE,
    allowNull: true
  }
}, {
  tableName: 'tapping_history',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

export default TappingHistory;
