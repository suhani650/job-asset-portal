import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// The company's employee registry. Every person gets an automatic ID (EMP-2026-0001 ...), unique inside the company.
// A candidate who is moved to "Hired" is added automatically; other people can be added by hand.
export const Employee = sequelize.define(
  'Employee',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false },
    seq: { type: DataTypes.INTEGER, allowNull: false }, // 1, 2, 3 ... inside the company
    empCode: { type: DataTypes.STRING(20), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: DataTypes.STRING(150),
    phone: DataTypes.STRING(30),
    department: DataTypes.STRING(80),
    designation: DataTypes.STRING(100),
    joiningDate: DataTypes.DATEONLY,
    probationMonths: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('probation', 'active', 'notice', 'exited'), defaultValue: 'active' },
    source: { type: DataTypes.ENUM('hired', 'manual'), defaultValue: 'manual' },
    applicationId: { type: DataTypes.UUID, unique: true }, // the job application this person came from (if hired through the portal)
    jobId: DataTypes.UUID,
    candidateUserId: DataTypes.STRING(40),
    notes: DataTypes.TEXT,
    exitDate: DataTypes.DATEONLY,
    exitReason: DataTypes.STRING(300),
    createdById: DataTypes.UUID,
    createdByName: DataTypes.STRING(120),
  },
  { tableName: 'employees', indexes: [{ unique: true, fields: ['orgId', 'seq'] }, { fields: ['orgId', 'status'] }] }
);
