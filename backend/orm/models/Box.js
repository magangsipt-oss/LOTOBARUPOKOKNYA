import { DataTypes } from 'sequelize';
import sequelize from '../sequelize.js';

const Box = sequelize.define('Box', {
  id_box: {
    type: DataTypes.STRING(50),
    primaryKey: true,
    allowNull: false
  },
  unit: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  ip: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: '0.0.0.0'
  },
  rtsp_url: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  ssid: {
    type: DataTypes.STRING(100),
    allowNull: true
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
  },
  state: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'STATE_IDLE'
  },
  lcd0: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: ''
  },
  lcd1: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: ''
  },
  relay_open: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0
  },
  supervisor_uid: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: ''
  },
  active_fuelman: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  last_event: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'HEARTBEAT_SYNC'
  },
  last_uid: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'SYSTEM'
  },
  uptime_ms: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0
  },
  hw_data: {
    type: DataTypes.TEXT('long'),
    allowNull: true
  },
  is_online: {
    type: DataTypes.TINYINT,
    allowNull: false,
    defaultValue: 0
  },
  last_ping: {
    type: DataTypes.DATE,
    allowNull: true
  },
  pending_cmd: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  cmd_param: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  device_token: {
    type: DataTypes.STRING(64),
    allowNull: true
  }
}, {
  tableName: 'boxes',
  timestamps: true,
  createdAt: false,
  updatedAt: 'updated_at'
});

export default Box;
