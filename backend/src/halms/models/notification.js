import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// In-app notification (the bell). One row per user per event.
export const AppNotification = sequelize.define(
  'AppNotification',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.STRING(30), defaultValue: 'info' }, // applicant | support | profile | registration | info
    title: { type: DataTypes.STRING(150), allowNull: false },
    body: DataTypes.STRING(400),
    link: DataTypes.STRING(200), // page to open when clicked, e.g. /applicants
    readAt: DataTypes.DATE,
  },
  { tableName: 'app_notifications', indexes: [{ fields: ['userId', 'readAt'] }, { fields: ['userId', 'createdAt'] }] }
);
