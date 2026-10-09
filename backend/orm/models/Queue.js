import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const Queue = sequelize.define('Queue', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  id_box: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  session_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  rfid_uid: {
    type: DataTypes.STRING(50),
    allowNull: false
  }
}, {
  tableName: 'queue',
  timestamps: true,
  createdAt: 'joined_at',
  updatedAt: false
});

export default Queue;
