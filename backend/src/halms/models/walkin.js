import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };

/* ---------------- Walk-in drive: one per job (new tables, nothing existing is altered) ---------------- */
export const WalkInDrive = sequelize.define(
  'WalkInDrive',
  {
    id: uuid,
    jobId: { type: DataTypes.UUID, allowNull: false, unique: true },
    orgId: { type: DataTypes.UUID, allowNull: false },
    createdById: DataTypes.UUID,
    driveDate: { type: DataTypes.DATEONLY, allowNull: false },
    venueName: { type: DataTypes.STRING(160), allowNull: false },
    address: { type: DataTypes.STRING(400), allowNull: false },
    mapLink: DataTypes.STRING(300),
    contactName: DataTypes.STRING(100),
    contactPhone: DataTypes.STRING(20),
    instructions: DataTypes.TEXT, // documents to carry, dress code ...
    status: { type: DataTypes.ENUM('open', 'cancelled'), defaultValue: 'open' },
  },
  { tableName: 'walkin_drives', indexes: [{ fields: ['orgId'] }, { fields: ['driveDate'] }] }
);

export const WalkInSlot = sequelize.define(
  'WalkInSlot',
  {
    id: uuid,
    driveId: { type: DataTypes.UUID, allowNull: false },
    startTime: { type: DataTypes.STRING(5), allowNull: false }, // "HH:MM" 24h
    endTime: { type: DataTypes.STRING(5), allowNull: false },
    capacity: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: 'walkin_slots', indexes: [{ fields: ['driveId'] }] }
);

/* ---------------- A candidate's seat + QR pass ---------------- */
// passVersion goes up every time the seat is (re)booked. Only the newest QR works.
export const WalkInBooking = sequelize.define(
  'WalkInBooking',
  {
    id: uuid,
    driveId: { type: DataTypes.UUID, allowNull: false },
    slotId: { type: DataTypes.UUID, allowNull: false },
    jobId: { type: DataTypes.UUID, allowNull: false },
    orgId: { type: DataTypes.UUID, allowNull: false },
    applicationId: DataTypes.UUID,
    candidateUserId: { type: DataTypes.STRING(40), allowNull: false },
    candidateName: { type: DataTypes.STRING(120), allowNull: false },
    candidateEmail: { type: DataTypes.STRING(150), allowNull: false },
    candidatePhone: DataTypes.STRING(30),
    passVersion: { type: DataTypes.INTEGER, defaultValue: 1 },
    status: { type: DataTypes.ENUM('booked', 'checked_in', 'cancelled', 'no_show'), defaultValue: 'booked' },
    checkedInAt: DataTypes.DATE,
    checkedInById: DataTypes.UUID,
    checkInMethod: DataTypes.STRING(10), // qr | manual | override
    cancelledAt: DataTypes.DATE,
  },
  {
    tableName: 'walkin_bookings',
    indexes: [
      { unique: true, fields: ['driveId', 'candidateUserId'] },
      { fields: ['slotId'] },
      { fields: ['orgId'] },
      { fields: ['candidateUserId'] },
    ],
  }
);
