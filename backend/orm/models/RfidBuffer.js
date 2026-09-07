import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const RfidBuffer = sequelize.define('RfidBuffer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  id_box: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  rfid_uid: {
    type: DataTypes.STRING(50),
    allowNull: false
  }
}, {
  tableName: 'rfid_buffer',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

export default RfidBuffer;
