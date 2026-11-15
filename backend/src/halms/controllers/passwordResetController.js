import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { User } from '../models/index.js';
import { UserSecurity } from '../models/userSecurity.js';
import { PasswordReset } from '../models/passwordReset.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';
import { sendEmail, emailHtml } from '../utils/mailer.js';

/* "Forgot password" for EVERY kind of account, with a 6-digit code sent by email (valid 10 minutes, 5 tries).
   Company accounts live in "users"; candidates, Admins, Trainers and the Super Admin also live in the candidate panel table "User".
   The answer to "forgot" is always the same, so nobody can find out which emails have an account. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
const MINUTES = 10;
const MAX_TRIES = 5;
const COOLDOWN_SEC = 45;
const SAME_ANSWER = { message: `If this email has an account, a 6-digit code has been sent to it. The code is valid for ${MINUTES} minutes.` };

const secret = () => process.env.HALMS_JWT_SECRET || 'dev-only-secret';
const hashCode = (email, code) => crypto.createHmac('sha256', secret()).update(`reset:${email}:${code}`).digest('hex').slice(0, 64);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function portalAccount(email) {
  try {
    const [rows] = await sequelize.query('SELECT id, name, role, isActive FROM `User` WHERE lower(email) = :e LIMIT 1', { replacements: { e: email } });
    return rows[0] || null;
  } catch (e) {
    if (/Table '[^']*User' doesn't exist/i.test(e.message)) return null; // candidate panel not installed
    throw e;
  }
}

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = str(req.body?.email, 150).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');

  const company = await User.findOne({ where: { email } });
  const portal = await portalAccount(email);
  const name = company?.name || portal?.name;
  const active = company ? company.status === 'active' : portal ? portal.isActive : false;
  if (!name || !active) return res.json(SAME_ANSWER); // unknown or switched-off account: same answer, nothing sent

  const recent = await PasswordReset.findOne({ where: { email, createdAt: { [Op.gt]: new Date(Date.now() - COOLDOWN_SEC * 1000) } } });
  if (recent) return res.json(SAME_ANSWER); // one code per 45 seconds

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await PasswordReset.destroy({ where: { email } }); // only the newest code works
  await PasswordReset.create({ email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + MINUTES * 60 * 1000) });

  await sendEmail({
    to: email,
    subject: `Your Asset Portal password reset code: ${code}`,
    text: `Hello ${name},\n\nYour password reset code is ${code}.\nIt is valid for ${MINUTES} minutes. If you did not ask for it, ignore this email: your password is safe.\n\nAsset Portal`,
    html: emailHtml({
      title: 'Reset your password',
      lines: [`Hello ${name},`, 'Use this code on the Reset password page.'],
      code, codeNote: `Valid for ${MINUTES} minutes`,
      footer: 'If you did not ask for this, ignore this email. Your password stays the same.',
    }),
  });
  res.json(SAME_ANSWER);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const email = str(req.body?.email, 150).toLowerCase();
  const code = str(req.body?.code, 12).replace(/\s/g, '');
  const newPassword = req.body?.newPassword;
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter your email and the 6-digit code.');
  if (typeof newPassword !== 'string' || !PASSWORD_RE.test(newPassword)) throw new HttpError(400, 'The new password needs 8+ characters with a capital letter, a small letter and a number.');

  const reset = await PasswordReset.findOne({ where: { email, usedAt: null }, order: [['createdAt', 'DESC']] });
  if (!reset || reset.expiresAt < new Date()) throw new HttpError(400, 'This code has expired or was not asked for. Ask for a new code.');
  if (reset.attempts >= MAX_TRIES) throw new HttpError(429, 'Too many wrong codes. Ask for a new code.');
  if (!sameHash(reset.codeHash, hashCode(email, code))) {
    await reset.update({ attempts: reset.attempts + 1 });
    const left = MAX_TRIES - reset.attempts - 1;
    throw new HttpError(400, left > 0 ? `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not correct. Ask for a new code.');
  }

  const company = await User.scope('withPassword').findOne({ where: { email } });
  const portal = await portalAccount(email);
  if (!company && !portal) throw new HttpError(400, 'This code has expired or was not asked for. Ask for a new code.');
  const admin = company?.role === ROLES.SUPER_ADMIN || portal?.role === 'SUPER_ADMIN';
  if (admin && newPassword.length < 12) throw new HttpError(400, 'A Super Admin password needs at least 12 characters.');

  const hash = await bcrypt.hash(newPassword, 12);
  await sequelize.transaction(async (t) => {
    if (company) {
      await User.update({ passwordHash: hash }, { where: { id: company.id }, transaction: t });
      await UserSecurity.upsert({ userId: company.id, passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000) }, { transaction: t });
    }
    if (portal) {
      await sequelize.query('UPDATE `User` SET passwordHash = :h, refreshTokenHash = NULL, updatedAt = NOW(3) WHERE lower(email) = :e', { replacements: { h: hash, e: email }, transaction: t });
    }
    await reset.update({ usedAt: new Date() }, { transaction: t });
  });
  await PasswordReset.destroy({ where: { email, id: { [Op.ne]: reset.id } } });
  await audit({ actor: company || undefined, action: 'PASSWORD_RESET_BY_CODE', entity: 'User', entityId: company?.id, meta: { email }, req });

  await sendEmail({
    to: email, subject: 'Your Asset Portal password was changed',
    text: 'Your password was just changed. If this was not you, contact your administrator immediately.',
    html: emailHtml({ title: 'Password changed', lines: [`Hello ${company?.name || portal?.name},`, 'Your password was just changed. You can sign in with the new password now.'], footer: 'If this was not you, contact your administrator immediately.' }),
  });
  res.json({ message: 'Password changed. You can sign in with the new password now.' });
});
