import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { User } from '../models/index.js';
import { AppNotification } from '../models/notification.js';
import { ROLES, COMPANY_ADMINS } from '../config/roles.js';

/* Notifications must never break the action that caused them, so every helper swallows its own errors. */

const clip = (s, n) => (s == null ? s : String(s).slice(0, n));

export async function notifyUsers(userIds, { type = 'info', title, body, link }) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return;
    await AppNotification.bulkCreate(ids.map((userId) => ({ userId, type, title: clip(title, 150), body: clip(body, 400), link: clip(link, 200) })));
  } catch (e) {
    console.error('notify failed:', e.message);
  }
}

export async function notifySuperAdmins(payload) {
  try {
    const admins = await User.findAll({ where: { role: ROLES.SUPER_ADMIN, status: 'active' }, attributes: ['id'] });
    await notifyUsers(admins.map((a) => a.id), payload);
  } catch (e) {
    console.error('notify failed:', e.message);
  }
}

// HR Managers of one company, plus anybody else you name (for example the recruiter who owns the job)
export async function notifyOrgHR(orgId, payload, extraUserIds = []) {
  try {
    const hrs = await User.findAll({ where: { registrationId: orgId, role: { [Op.in]: COMPANY_ADMINS }, status: 'active' }, attributes: ['id'] });
    await notifyUsers([...hrs.map((h) => h.id), ...extraUserIds], payload);
  } catch (e) {
    console.error('notify failed:', e.message);
  }
}

// Writes into the Candidate portal's own notification table, so it shows in the candidate's bell.
export async function notifyCandidate(candidateUserId, title, message) {
  try {
    await sequelize.query(
      'INSERT INTO `Notification` (id, userId, title, message, `read`, createdAt) VALUES (:id,:userId,:title,:message,false,NOW(3))',
      { replacements: { id: `ap${crypto.randomBytes(12).toString('hex')}`, userId: candidateUserId, title: clip(title, 150), message: clip(message, 400) } }
    );
  } catch (e) {
    console.error('candidate notify failed:', e.message);
  }
}

export const unreadWhere = (userId) => ({ userId, readAt: { [Op.is]: null } });
