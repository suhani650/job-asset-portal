import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { ROLES } from '../config/roles.js';
import { nowLocal } from '../utils/walkinPass.js';

const uuid = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };

/* ---------------- User ---------------- */
export const User = sequelize.define(
  'User',
  {
    id: uuid,
    name: { type: DataTypes.STRING(150), allowNull: false },
    email: {
      type: DataTypes.STRING(150), allowNull: false, unique: true,
      set(v) { this.setDataValue('email', String(v).trim().toLowerCase()); },
    },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM(...Object.values(ROLES)), allowNull: false },
    status: { type: DataTypes.ENUM('active', 'disabled'), defaultValue: 'active' },
    registrationId: DataTypes.UUID,
    lastLoginAt: DataTypes.DATE,
    phone: DataTypes.STRING(20),
    designation: DataTypes.STRING(80),
    department: DataTypes.STRING(80),
    avatarFile: DataTypes.STRING(80), // stored file name only
  },
  {
    tableName: 'users',
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withPassword: { attributes: { include: ['passwordHash'] } } },
  }
);
User.prototype.toClient = function () {
  return {
    id: this.id, name: this.name, email: this.email, role: this.role,
    phone: this.phone || '', designation: this.designation || '', department: this.department || '',
    hasPhoto: !!this.avatarFile,
  };
};

/* ---------------- Registration ---------------- */
export const Registration = sequelize.define(
  'Registration',
  {
    id: uuid,
    company: { type: DataTypes.JSON, allowNull: false },
    address: { type: DataTypes.JSON, defaultValue: {} },
    branches: { type: DataTypes.JSON, defaultValue: [] },
    contact: { type: DataTypes.JSON, allowNull: false },
    hiring: { type: DataTypes.JSON, defaultValue: {} },
    billing: { type: DataTypes.JSON, defaultValue: {} },
    account: { type: DataTypes.JSON, defaultValue: {} },
    agreements: { type: DataTypes.JSON, defaultValue: {} },
    documents: { type: DataTypes.JSON, defaultValue: {} },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    status: {
      type: DataTypes.ENUM('pending_verification', 'approved', 'rejected', 'more_docs'),
      defaultValue: 'pending_verification',
    },
    history: { type: DataTypes.JSON, defaultValue: [] },
    userId: DataTypes.UUID,
    submittedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'registrations',
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withPassword: { attributes: { include: ['passwordHash'] } } },
    indexes: [{ fields: ['status'] }],
  }
);
// Same shape the React frontend already expects. Never exposes passwordHash or stored file names.
Registration.prototype.toClient = function () {
  const o = this.get({ plain: true });
  return {
    id: o.id, company: o.company, address: o.address, branches: o.branches, contact: o.contact,
    hiring: o.hiring, billing: o.billing, account: o.account, agreements: o.agreements,
    documents: Object.fromEntries(Object.entries(o.documents || {}).map(([k, d]) => [k, d.originalName])),
    status: o.status,
    history: (o.history || []).map((h) => ({ action: h.action, reason: h.reason, by: h.by, at: h.at })),
    submittedAt: o.submittedAt,
  };
};

/* ---------------- AuditLog ---------------- */
export const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: uuid,
    actorId: DataTypes.UUID,
    actorName: DataTypes.STRING,
    actorRole: DataTypes.STRING,
    action: { type: DataTypes.STRING, allowNull: false },
    entity: DataTypes.STRING,
    entityId: DataTypes.STRING,
    meta: DataTypes.JSON,
    ip: DataTypes.STRING,
  },
  { tableName: 'audit_logs', createdAt: 'at', updatedAt: false, indexes: [{ fields: ['action'] }] }
);

/* ---------------- Profile edit requests ---------------- */
// Flow: pending -> approved/rejected (Super Admin) -> used (after the user saves) or expired (24h)
export const ProfileEditRequest = sequelize.define(
  'ProfileEditRequest',
  {
    id: uuid,
    userId: { type: DataTypes.UUID, allowNull: false },
    reason: { type: DataTypes.STRING(300), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'used'), defaultValue: 'pending' },
    decidedById: DataTypes.UUID,
    decisionNote: DataTypes.STRING(300),
    decidedAt: DataTypes.DATE,
    expiresAt: DataTypes.DATE,
    usedAt: DataTypes.DATE,
  },
  { tableName: 'profile_edit_requests', indexes: [{ fields: ['userId'] }, { fields: ['status'] }] }
);
ProfileEditRequest.belongsTo(User, { as: 'user', foreignKey: 'userId' });
ProfileEditRequest.belongsTo(User, { as: 'decider', foreignKey: 'decidedById' });

// "approved" but past expiry is shown to the client as "expired"
ProfileEditRequest.prototype.toClient = function (withUser = false) {
  const o = this;
  const expired = o.status === 'approved' && o.expiresAt && new Date(o.expiresAt) < new Date();
  const out = {
    id: o.id, reason: o.reason, status: expired ? 'expired' : o.status,
    decisionNote: o.decisionNote || '', decidedAt: o.decidedAt, expiresAt: o.expiresAt,
    usedAt: o.usedAt, requestedAt: o.createdAt, decidedBy: o.decider?.name || null,
  };
  if (withUser && o.user) out.user = { id: o.user.id, name: o.user.name, email: o.user.email, role: o.user.role };
  return out;
};

/* ---------------- Job postings ---------------- */
// Status flow: draft -> published -> closed (-> reopen -> published) ; any -> archived -> restore -> draft
export const Job = sequelize.define(
  'Job',
  {
    id: uuid,
    jobCode: { type: DataTypes.STRING(20), unique: true },
    orgId: DataTypes.UUID, // company (registration) that owns the job
    createdById: DataTypes.UUID,
    title: { type: DataTypes.STRING(120), allowNull: false },
    department: { type: DataTypes.STRING(80), allowNull: false },
    location: { type: DataTypes.STRING(80), allowNull: false },
    workMode: { type: DataTypes.ENUM('onsite', 'hybrid', 'remote'), defaultValue: 'onsite' },
    employmentType: { type: DataTypes.ENUM('full_time', 'part_time', 'internship', 'contract'), defaultValue: 'full_time' },
    openings: { type: DataTypes.INTEGER, defaultValue: 1 },
    experienceMin: { type: DataTypes.INTEGER, defaultValue: 0 },
    experienceMax: DataTypes.INTEGER,
    salaryMin: DataTypes.INTEGER, // INR per year
    salaryMax: DataTypes.INTEGER,
    salaryVisible: { type: DataTypes.BOOLEAN, defaultValue: false },
    skills: { type: DataTypes.JSON, defaultValue: [] },
    education: DataTypes.STRING(120),
    description: DataTypes.TEXT,
    responsibilities: DataTypes.TEXT,
    requirements: DataTypes.TEXT,
    probationMonths: { type: DataTypes.INTEGER, defaultValue: 1 },
    trainingProvided: { type: DataTypes.BOOLEAN, defaultValue: false },
    serviceAgreement: { type: DataTypes.BOOLEAN, defaultValue: false },
    lastDate: DataTypes.DATEONLY,
    status: { type: DataTypes.ENUM('draft', 'published', 'closed', 'archived'), defaultValue: 'draft' },
    publishedAt: DataTypes.DATE,
    closedAt: DataTypes.DATE,
    jdFile: DataTypes.STRING(80), // stored file name only
    jdName: DataTypes.STRING(200),
  },
  { tableName: 'jobs', indexes: [{ fields: ['orgId'] }, { fields: ['status'] }] }
);
Job.belongsTo(User, { as: 'creator', foreignKey: 'createdById' });

export const todayStr = () => nowLocal().date; // India time (WALKIN_TZ), not the server's UTC date

// A published job whose last date has passed is shown as "expired".
Job.prototype.toClient = function () {
  const o = this.get({ plain: true });
  const expired = o.status === 'published' && o.lastDate && o.lastDate < todayStr();
  return {
    id: o.id, jobCode: o.jobCode, title: o.title, department: o.department, location: o.location,
    workMode: o.workMode, employmentType: o.employmentType, openings: o.openings,
    experienceMin: o.experienceMin, experienceMax: o.experienceMax,
    salaryMin: o.salaryMin, salaryMax: o.salaryMax, salaryVisible: o.salaryVisible,
    skills: o.skills || [], education: o.education || '',
    description: o.description || '', responsibilities: o.responsibilities || '', requirements: o.requirements || '',
    probationMonths: o.probationMonths, trainingProvided: o.trainingProvided, serviceAgreement: o.serviceAgreement,
    lastDate: o.lastDate, status: expired ? 'expired' : o.status,
    publishedAt: o.publishedAt, closedAt: o.closedAt,
    hasJd: !!o.jdFile, jdName: o.jdName || '',
    createdAt: o.createdAt, updatedAt: o.updatedAt,
    createdBy: this.creator?.name || null,
  };
};
