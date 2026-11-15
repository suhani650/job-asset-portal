import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// One "forgot password" request: a 6-digit code (stored only as a keyed hash) that expires in 10 minutes.
export const PasswordReset = sequelize.define(
  'PasswordReset',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email: { type: DataTypes.STRING(150), allowNull: false },
    codeHash: { type: DataTypes.STRING(80), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    usedAt: DataTypes.DATE,
  },
  { tableName: 'password_resets', indexes: [{ fields: ['email'] }] }
);
