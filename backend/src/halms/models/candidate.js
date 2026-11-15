import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };

/* ---------------- Candidate (talent pool, filled by the Candidate portal) ---------------- */
export const Candidate = sequelize.define(
  'Candidate',
  {
    id: uuid,
    name: { type: DataTypes.STRING(100), allowNull: false },
    email: {
      type: DataTypes.STRING(150), allowNull: false, unique: true,
      set(v) { this.setDataValue('email', String(v).trim().toLowerCase()); },
    },
    phone: DataTypes.STRING(20),
    city: DataTypes.STRING(80),
    state: DataTypes.STRING(80),
    currentTitle: DataTypes.STRING(100),
    experienceYears: { type: DataTypes.INTEGER, defaultValue: 0 },
    education: DataTypes.STRING(40),
    skills: { type: DataTypes.JSON, defaultValue: [] },     // as typed, for display
    skillsKey: { type: DataTypes.JSON, defaultValue: [] },  // lowercase copy, used for searching
    expectedSalary: DataTypes.INTEGER,                       // INR per year
    noticeDays: { type: DataTypes.INTEGER, defaultValue: 0 },
    preferredLocations: { type: DataTypes.JSON, defaultValue: [] },
    workMode: { type: DataTypes.ENUM('onsite', 'hybrid', 'remote', 'any'), defaultValue: 'any' },
    languages: { type: DataTypes.JSON, defaultValue: [] },
    summary: DataTypes.TEXT,
    resumeFile: DataTypes.STRING(80), // stored file name only
    resumeName: DataTypes.STRING(200),
    consentAt: DataTypes.DATE,        // candidate agreed that companies can find them
    status: { type: DataTypes.ENUM('active', 'hidden'), defaultValue: 'active' },
    source: { type: DataTypes.STRING(30), defaultValue: 'portal' }, // 'demo' for test data
  },
  { tableName: 'candidates', indexes: [{ fields: ['status'] }, { fields: ['experienceYears'] }, { fields: ['city'] }] }
);

/* ---------------- Shortlist: one row per (company, candidate) ---------------- */
// Contact details and resume are visible to a company only after it shortlists the candidate.
export const CandidateShortlist = sequelize.define(
  'CandidateShortlist',
  {
    id: uuid,
    orgId: { type: DataTypes.UUID, allowNull: false },
    candidateId: { type: DataTypes.UUID, allowNull: false },
    shortlistedById: DataTypes.UUID,
  },
  { tableName: 'candidate_shortlists', indexes: [{ unique: true, fields: ['orgId', 'candidateId'] }] }
);