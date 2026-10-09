import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const PeopleCounting = sequelize.define('PeopleCounting', {
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
  detected_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  registered_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'people_counting',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

export default PeopleCounting;
