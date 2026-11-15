import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { User, Registration, AuditLog } from '../models/index.js';
import { UserSecurity } from '../models/userSecurity.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { signToken, str, audit } from '../utils/helpers.js';
import { ROLES } from '../config/roles.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const TABLE_MISSING = /Table '[^']*User' doesn't exist/i; // candidate panel not installed
const ACTIONS = ['LOGIN', 'PASSWORD_CHANGED', 'EMAIL_CHANGED'];

// The Super Admin exists in TWO places: this panel ("users") and the Candidate/Admin panel (Prisma table "User").
// The "Super Admin" sign-in tab needs both to match, so every Super Admin change is written to both, in one transaction.
async function prismaUpdate(sql, replacements, transaction) {
  try {
    const [, meta] = await sequelize.query(sql, { replacements, transaction });
    return meta?.affectedRows ?? meta?.rowCount ?? 0;
  } catch (e) {
    if (TABLE_MISSING.test(e.message)) return 0; // candidate panel not installed
    throw e;
  }
}

// The signed-in user's own account settings. Every change needs the current password.
async function checkCurrentPassword(userId, password) {
  const full = await User.scope('withPassword').findByPk(userId);
  if (!full || typeof password !== 'string' || !(await bcrypt.compare(password, full.passwordHash))) {
    throw new HttpError(400, 'Your current password is not correct.');
  }
  return full;
}

export const getSettings = asyncHandler(async (req, res) => {
  const [sec, activity] = await Promise.all([
    UserSecurity.findByPk(req.user.id),
    AuditLog.findAll({ where: { actorId: req.user.id, action: { [Op.in]: ACTIONS } }, order: [['at', 'DESC']], limit: 8, attributes: ['id', 'action', 'at', 'ip'] }),
  ]);
  res.json({
    user: req.user.toClient(),
    canChangeEmail: req.user.role === ROLES.SUPER_ADMIN,
    lastLoginAt: req.user.lastLoginAt,
    passwordChangedAt: sec?.passwordChangedAt || null,
    activity: activity.map((a) => ({ id: a.id, action: a.action, at: a.at, ip: a.ip || '' })),
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || !PASSWORD_RE.test(newPassword)) throw new HttpError(400, 'New password needs 8+ characters with uppercase, lowercase and a number.');
  if (newPassword.length > 72) throw new HttpError(400, 'New password can be at most 72 characters.');
  const user = await checkCurrentPassword(req.user.id, currentPassword);
  if (await bcrypt.compare(newPassword, user.passwordHash)) throw new HttpError(400, 'Choose a password that is different from your current one.');

  const isAdmin = user.role === ROLES.SUPER_ADMIN;
  if (isAdmin && newPassword.length < 12) throw new HttpError(400, 'A Super Admin password needs at least 12 characters.');

  const hash = await bcrypt.hash(newPassword, 12);
  const stamp = new Date(Math.floor(Date.now() / 1000) * 1000); // whole seconds, same precision as a token's "iat"
  await sequelize.transaction(async (t) => {
    user.passwordHash = hash;
    await user.save({ transaction: t });
    await UserSecurity.upsert({ userId: user.id, passwordChangedAt: stamp }, { transaction: t });
    // same password for the Candidate/Admin panel, and its other sessions are closed
    if (isAdmin) await prismaUpdate('UPDATE `User` SET passwordHash = :h, refreshTokenHash = NULL, updatedAt = NOW(3) WHERE lower(email) = :e AND role = \'SUPER_ADMIN\'', { h: hash, e: user.email.toLowerCase() }, t);
  });
  await audit({ actor: user, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user.id, req });
  // every other signed-in device is logged out; a company user continues here with a fresh token,
  // the Super Admin signs in again (both panels at once)
  res.json({ message: isAdmin ? 'Password changed in both panels. Please sign in again.' : 'Password changed. Other devices have been signed out.', ...(isAdmin ? { signOut: true } : { token: signToken(user) }) });
});

export const changeEmail = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.SUPER_ADMIN) throw new HttpError(403, 'Only the Super Admin can change the login email here.');
  const email = str(req.body?.newEmail, 150).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const user = await checkCurrentPassword(req.user.id, req.body?.currentPassword);
  if (email === user.email) throw new HttpError(400, 'This is already your login email.');

  const taken = (await User.count({ where: { email, id: { [Op.ne]: user.id } } })) > 0
    || (await Registration.count({ where: { status: { [Op.ne]: 'rejected' }, [Op.or]: [{ contact: { email } }, { company: { email } }] } })) > 0;
  if (taken) throw new HttpError(409, 'This email is already used by another account.');

  // the candidate/admin panel must not already use it either
  try {
    const [rows] = await sequelize.query('SELECT 1 FROM `User` WHERE lower(email) = :e AND NOT (role = \'SUPER_ADMIN\' AND lower(email) = :old) LIMIT 1', { replacements: { e: email, old: user.email.toLowerCase() } });
    if (rows.length) throw new HttpError(409, 'This email is already used by a candidate account.');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (!TABLE_MISSING.test(e.message)) throw e;
  }

  const old = user.email;
  await sequelize.transaction(async (t) => {
    user.email = email;
    await user.save({ transaction: t });
    await prismaUpdate('UPDATE `User` SET email = :n, refreshTokenHash = NULL, updatedAt = NOW(3) WHERE lower(email) = :o AND role = \'SUPER_ADMIN\'', { n: email, o: old.toLowerCase() }, t);
  });
  await audit({ actor: user, action: 'EMAIL_CHANGED', entity: 'User', entityId: user.id, meta: { from: old, to: email }, req });
  res.json({ message: 'Login email changed in both panels. Please sign in again with the new email.', user: user.toClient(), signOut: true, envReminder: true, email });
});
