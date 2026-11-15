import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };

export const STAGES = ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected'];

/* ---------------- A candidate's application to one company job ---------------- */
// The candidate lives in the Candidate portal database (Prisma "User"). When they apply, their details are
// copied here ("snapshot") together with their consent, so the company sees what the candidate agreed to share.
export const JobApplication = sequelize.define(
  'JobApplication',
  {
    id: uuid,
    jobId: { type: DataTypes.UUID, allowNull: false },
    orgId: { type: DataTypes.UUID, allowNull: false },
    candidateUserId: { type: DataTypes.STRING(40), allowNull: false }, // Prisma User.id (text id, not a UUID)
    candidateName: { type: DataTypes.STRING(120), allowNull: false },
    candidateEmail: { type: DataTypes.STRING(150), allowNull: false },
    candidatePhone: DataTypes.STRING(30),
    city: DataTypes.STRING(80),
    state: DataTypes.STRING(80),
    qualification: DataTypes.STRING(120),
    college: DataTypes.STRING(160),
    skills: DataTypes.TEXT,
    expYears: DataTypes.FLOAT,
    currentCompany: DataTypes.STRING(160),
    expectedSalary: DataTypes.INTEGER,
    linkedin: DataTypes.STRING(250),
    resumePath: DataTypes.STRING(120), // stored file name (never sent to the browser)
    resumeName: DataTypes.STRING(200),
    coverNote: DataTypes.TEXT,
    status: {
      type: DataTypes.ENUM('applied', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn'),
      defaultValue: 'applied',
    },
    history: { type: DataTypes.JSON, defaultValue: [] }, // [{ stage, at, by, message }]  (message is shown to the candidate)
    notes: { type: DataTypes.JSON, defaultValue: [] },   // [{ id, by, text, at }]       (private to the company)
  },
  {
    tableName: 'job_applications',
    indexes: [
      { unique: true, fields: ['jobId', 'candidateUserId'] },
      { fields: ['orgId'] },
      { fields: ['status'] },
    ],
  }
);
