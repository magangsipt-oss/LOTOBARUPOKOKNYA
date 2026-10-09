import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const User = sequelize.define('User', {
  sid: {
    type: DataTypes.STRING(50),
    primaryKey: true,
    allowNull: false
  },
  nama: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  role: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  rfid_uid: {
    type: DataTypes.STRING(50),
    unique: true,
    allowNull: true
  },
  fp_id: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  foto: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

export default User;
