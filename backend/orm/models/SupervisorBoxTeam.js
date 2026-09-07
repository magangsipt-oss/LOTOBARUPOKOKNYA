import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const SupervisorBoxTeam = sequelize.define('SupervisorBoxTeam', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  supervisor_sid: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  id_box: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  mechanic_sid: {
    type: DataTypes.STRING(100),
    allowNull: false
  }
}, {
  tableName: 'supervisor_box_team',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

export default SupervisorBoxTeam;
