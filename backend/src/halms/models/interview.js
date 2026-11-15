import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// A scheduled interview of one applicant. The candidate gets an email and a 6-digit verification code;
// the interviewer types that code in the "Verify candidate" corner when the candidate arrives.
// (The code is not stored: it is calculated from the interview id and codeVersion with a server secret.)
export const Interview = sequelize.define(
  'Interview',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orgId: { type: DataTypes.UUID, allowNull: false },
    jobId: { type: DataTypes.UUID, allowNull: false },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    candidateUserId: { type: DataTypes.STRING(40), allowNull: false },
    candidateName: { type: DataTypes.STRING(120), allowNull: false },
    candidateEmail: { type: DataTypes.STRING(150), allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    startTime: { type: DataTypes.STRING(5), allowNull: false }, // "HH:MM" 24-hour, company time zone
    durationMin: { type: DataTypes.INTEGER, defaultValue: 30 },
    mode: { type: DataTypes.ENUM('in_person', 'online', 'phone'), defaultValue: 'in_person' },
    location: { type: DataTypes.STRING(300), allowNull: false }, // address, meeting link or phone number
    instructions: DataTypes.TEXT,
    interviewerName: DataTypes.STRING(120),
    status: { type: DataTypes.ENUM('scheduled', 'completed', 'cancelled', 'no_show'), defaultValue: 'scheduled' },
    codeVersion: { type: DataTypes.INTEGER, defaultValue: 1 },
    attempts: { type: DataTypes.INTEGER, defaultValue: 0 }, // wrong codes typed so far
    verifiedAt: DataTypes.DATE,
    verifiedBy: DataTypes.STRING(120),
    verifyMethod: DataTypes.STRING(10), // otp | manual
    cancelReason: DataTypes.STRING(300),
    createdById: DataTypes.UUID,
    createdByName: DataTypes.STRING(120),
  },
  { tableName: 'interviews', indexes: [{ fields: ['orgId', 'date'] }, { fields: ['applicationId'] }, { fields: ['candidateUserId'] }] }
);
