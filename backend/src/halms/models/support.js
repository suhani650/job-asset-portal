import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Help-desk ticket raised by a client user (or escalated from the assistant). Super Admin answers.
export const SupportTicket = sequelize.define(
  'SupportTicket',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    ticketNo: { type: DataTypes.STRING(20), unique: true },
    orgId: DataTypes.UUID,          // company (registration) of the user who raised it
    userId: { type: DataTypes.UUID, allowNull: false },
    subject: { type: DataTypes.STRING(150), allowNull: false },
    category: {
      type: DataTypes.ENUM('account', 'jobs', 'candidates', 'team', 'billing', 'technical', 'other'),
      defaultValue: 'other',
    },
    priority: { type: DataTypes.ENUM('low', 'normal', 'high'), defaultValue: 'normal' },
    status: { type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'), defaultValue: 'open' },
    messages: { type: DataTypes.JSON, defaultValue: [] }, // [{ id, by, role: client|admin, text, at }]
    resolvedAt: DataTypes.DATE,
  },
  { tableName: 'support_tickets', indexes: [{ fields: ['orgId'] }, { fields: ['userId'] }, { fields: ['status'] }] }
);
