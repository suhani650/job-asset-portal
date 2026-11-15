import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User, Registration } from '../models/index.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
const PHONE_RE = /^[0-9+\-\s]{7,15}$/;

// HR Manager can create these roles. The Owner can also create HR Managers. The Owner and Super Admin are never created here.
const BASE_ASSIGNABLE = [ROLES.RECRUITER, ROLES.TRAINER, ROLES.EMPLOYEE];
const assignableFor = (user) => (user.role === ROLES.OWNER ? [ROLES.HR_MANAGER, ...BASE_ASSIGNABLE] : BASE_ASSIGNABLE);
const bad = (msg) => new HttpError(400, msg);

export const validateMemberId = (req, res, next, id) =>
  UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Team member not found.' });

const orgOf = (req) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return req.user.registrationId;
};

const shape = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
  phone: u.phone || '', designation: u.designation || '', department: u.department || '',
  lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

// Finds a member of THIS company only. Other companies' users look like "not found".
async function findMember(req) {
  const m = await User.findOne({ where: { id: req.params.id, registrationId: orgOf(req) } });
  if (!m) throw new HttpError(404, 'Team member not found.');
  if (!assignableFor(req.user).includes(m.role)) throw new HttpError(403, 'This account cannot be changed here.');
  return m;
}

function cleanDetails(b, { partial }, actor) {
  const out = {};
  if (!partial || b.name !== undefined) {
    const name = str(b.name, 150);
    if (name.length < 2) throw bad('Name must be at least 2 characters.');
    out.name = name;
  }
  if (!partial || b.role !== undefined) {
    if (!assignableFor(actor).includes(b.role)) throw bad(`Choose a valid role: ${actor.role === ROLES.OWNER ? 'HR Manager, ' : ''}Recruiter, Trainer or Employee.`);
    out.role = b.role;
  }
  if (b.phone !== undefined) {
    const phone = str(b.phone, 20);
    if (phone && !PHONE_RE.test(phone)) throw bad('Enter a valid phone number.');
    out.phone = phone || null;
  }
  if (b.designation !== undefined) out.designation = str(b.designation, 80) || null;
  if (b.department !== undefined) out.department = str(b.department, 80) || null;
  return out;
}

const checkPassword = (p) => {
  if (typeof p !== 'string' || !PASSWORD_RE.test(p)) {
    throw bad('Password needs 8+ characters with uppercase, lowercase and a number.');
  }
  return p;
};

/* ---------- list ---------- */
export const listTeam = asyncHandler(async (req, res) => {
  const members = await User.findAll({
    where: { registrationId: orgOf(req), role: { [Op.in]: assignableFor(req.user) } },
    order: [['createdAt', 'DESC']],
  });
  res.json({ items: members.map(shape) });
});

/* ---------- create ---------- */
export const createMember = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const orgId = orgOf(req);
  const details = cleanDetails(b, { partial: false }, req.user);
  const email = str(b.email, 150).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('A valid email is required.');
  const password = checkPassword(b.password);

  const clash =
    (await User.count({ where: { email } })) > 0 ||
    (await Registration.count({
      where: {
        status: { [Op.ne]: 'rejected' },
        [Op.or]: [{ contact: { email } }, { company: { email } }],
      },
    })) > 0;
  if (clash) throw new HttpError(409, 'This email is already in use.');

  const member = await User.create({
    ...details, email, registrationId: orgId,
    passwordHash: await bcrypt.hash(password, 12),
  });
  await audit({
    actor: req.user, action: 'TEAM_MEMBER_CREATED', entity: 'User', entityId: member.id,
    meta: { email, role: member.role }, req,
  });
  res.status(201).json(shape(member));
});

/* ---------- edit details / role ---------- */
export const updateMember = asyncHandler(async (req, res) => {
  const member = await findMember(req);
  const changes = cleanDetails(req.body || {}, { partial: true }, req.user);
  const oldRole = member.role;
  await member.update(changes);
  await audit({
    actor: req.user, action: 'TEAM_MEMBER_UPDATED', entity: 'User', entityId: member.id,
    meta: { fields: Object.keys(changes), ...(changes.role && changes.role !== oldRole ? { from: oldRole, to: changes.role } : {}) },
    req,
  });
  res.json(shape(member));
});

/* ---------- enable / disable ---------- */
export const setMemberStatus = asyncHandler(async (req, res) => {
  const member = await findMember(req);
  const status = req.body?.status;
  if (!['active', 'disabled'].includes(status)) throw bad('Invalid status.');
  await member.update({ status });
  await audit({
    actor: req.user, action: status === 'active' ? 'TEAM_MEMBER_ENABLED' : 'TEAM_MEMBER_DISABLED',
    entity: 'User', entityId: member.id, meta: { email: member.email }, req,
  });
  res.json(shape(member));
});

/* ---------- reset password ---------- */
export const resetMemberPassword = asyncHandler(async (req, res) => {
  const member = await findMember(req);
  const password = checkPassword(req.body?.password);
  // update() on the table directly, because passwordHash is hidden by the default scope
  await User.update({ passwordHash: await bcrypt.hash(password, 12) }, { where: { id: member.id } });
  await audit({
    actor: req.user, action: 'TEAM_PASSWORD_RESET', entity: 'User', entityId: member.id,
    meta: { email: member.email }, req,
  });
  res.json({ message: 'Password updated. Share the new password with the team member.' });
});