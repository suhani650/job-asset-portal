import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Remembers when a user last changed their password, so older login tokens stop working.
// A separate table, so the existing "users" table is not touched.
export const UserSecurity = sequelize.define(
  'UserSecurity',
  {
    userId: { type: DataTypes.UUID, primaryKey: true },
    passwordChangedAt: { type: DataTypes.DATE, allowNull: false },
  },
  { tableName: 'user_security', timestamps: false }
);
