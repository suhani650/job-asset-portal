import crypto from 'node:crypto';
import { Op } from 'sequelize';
import { User, Registration } from '../models/index.js';
import { SupportTicket } from '../models/support.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';
import { notifySuperAdmins, notifyUsers } from '../utils/notify.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['account', 'jobs', 'candidates', 'team', 'billing', 'technical', 'other'];
const PRIORITIES = ['low', 'normal', 'high'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const bad = (m) => new HttpError(400, m);

export const validateTicketId = (req, res, next, id) =>
  UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Ticket not found.' });

/* Who can see what:
   Super Admin -> every ticket | HR Manager -> every ticket of their company | others -> only their own */
function visibleWhere(user) {
  if (user.role === ROLES.SUPER_ADMIN) return {};
  if (!user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  if (user.role === ROLES.HR_MANAGER || user.role === ROLES.OWNER) return { orgId: user.registrationId };
  return { userId: user.id };
}

async function shape(tickets) {
  const orgIds = [...new Set(tickets.map((t) => t.orgId).filter(Boolean))];
  const userIds = [...new Set(tickets.map((t) => t.userId))];
  const [regs, users] = await Promise.all([
    orgIds.length ? Registration.findAll({ where: { id: orgIds }, attributes: ['id', 'company'] }) : [],
    User.findAll({ where: { id: userIds }, attributes: ['id', 'name', 'email'] }),
  ]);
  const company = Object.fromEntries(regs.map((r) => [r.id, r.company?.name]));
  const who = Object.fromEntries(users.map((u) => [u.id, u]));
  return tickets.map((t) => ({
    id: t.id, ticketNo: t.ticketNo, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
    company: company[t.orgId] || '', createdBy: who[t.userId]?.name || '', createdByEmail: who[t.userId]?.email || '',
    messages: t.messages || [], lastMessageAt: t.messages?.length ? t.messages[t.messages.length - 1].at : t.createdAt,
    createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt,
  }));
}

async function loadVisible(req) {
  const t = await SupportTicket.findOne({ where: { id: req.params.id, ...visibleWhere(req.user) } });
  if (!t) throw new HttpError(404, 'Ticket not found.');
  return t;
}

const msg = (user, text) => ({
  id: crypto.randomUUID(), by: user.name, role: user.role === ROLES.SUPER_ADMIN ? 'admin' : 'client', text, at: new Date().toISOString(),
});

async function nextNo() {
  const year = new Date().getFullYear();
  const n = await SupportTicket.count({ where: { ticketNo: { [Op.like]: `TKT-${year}-%` } } });
  return `TKT-${year}-${String(n + 1).padStart(4, '0')}`;
}

/* ---------- handlers ---------- */

export const listTickets = asyncHandler(async (req, res) => {
  const where = visibleWhere(req.user);
  if (STATUSES.includes(req.query.status)) where.status = req.query.status;
  const rows = await SupportTicket.findAll({ where, order: [['updatedAt', 'DESC']], limit: 200 });
  res.json({ items: await shape(rows) });
});

export const getTicket = asyncHandler(async (req, res) => {
  const [item] = await shape([await loadVisible(req)]);
  res.json(item);
});

export const createTicket = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.SUPER_ADMIN) throw new HttpError(403, 'Super Admin answers tickets, it does not raise them.');
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  const b = req.body || {};
  const subject = str(b.subject, 150);
  const text = str(b.message, 2000);
  if (subject.length < 5) throw bad('Subject must be at least 5 characters.');
  if (text.length < 10) throw bad('Please describe the problem (min 10 characters).');
  const category = CATEGORIES.includes(b.category) ? b.category : 'other';
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';

  let ticket;
  for (let i = 0; i < 4; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      ticket = await SupportTicket.create({
        ticketNo: await nextNo(), orgId: req.user.registrationId, userId: req.user.id,
        subject, category, priority, messages: [msg(req.user, text)],
      });
      break;
    } catch (e) {
      if (e.name !== 'SequelizeUniqueConstraintError' || i === 3) throw e;
    }
  }
  await audit({ actor: req.user, action: 'SUPPORT_TICKET_CREATED', entity: 'SupportTicket', entityId: ticket.id, meta: { ticketNo: ticket.ticketNo, category }, req });
  await notifySuperAdmins({ type: 'support', title: `New ticket ${ticket.ticketNo}`, body: subject, link: '/support' });
  const [item] = await shape([ticket]);
  res.status(201).json(item);
});

export const replyTicket = asyncHandler(async (req, res) => {
  const t = await loadVisible(req);
  const text = str(req.body?.message, 2000);
  if (text.length < 2) throw bad('Write your reply first.');
  if (t.status === 'closed') throw new HttpError(409, 'This ticket is closed. Please raise a new ticket.');
  if ((t.messages || []).length >= 200) throw new HttpError(409, 'This conversation is too long. Please raise a new ticket.');

  const isAdmin = req.user.role === ROLES.SUPER_ADMIN;
  const patch = { messages: [...(t.messages || []), msg(req.user, text)] };
  if (isAdmin && t.status === 'open') patch.status = 'in_progress';
  if (!isAdmin && t.status === 'resolved') { patch.status = 'open'; patch.resolvedAt = null; } // client answered: reopen
  await t.update(patch);
  await audit({ actor: req.user, action: 'SUPPORT_TICKET_REPLY', entity: 'SupportTicket', entityId: t.id, meta: { ticketNo: t.ticketNo }, req });
  if (isAdmin) await notifyUsers([t.userId], { type: 'support', title: `Reply on ${t.ticketNo}`, body: text.slice(0, 120), link: '/support' });
  else await notifySuperAdmins({ type: 'support', title: `Client reply on ${t.ticketNo}`, body: text.slice(0, 120), link: '/support' });
  const [item] = await shape([t]);
  res.json(item);
});

export const setTicketStatus = asyncHandler(async (req, res) => {
  const t = await loadVisible(req);
  const status = req.body?.status;
  if (!STATUSES.includes(status)) throw bad('Invalid status.');
  const isAdmin = req.user.role === ROLES.SUPER_ADMIN;
  if (!isAdmin && status !== 'resolved') throw new HttpError(403, 'You can only mark your own ticket as resolved.');
  if (t.status === 'closed' && !isAdmin) throw new HttpError(409, 'This ticket is closed.');
  await t.update({ status, resolvedAt: status === 'resolved' || status === 'closed' ? new Date() : null });
  await audit({ actor: req.user, action: `SUPPORT_TICKET_${status.toUpperCase()}`, entity: 'SupportTicket', entityId: t.id, meta: { ticketNo: t.ticketNo }, req });
  if (isAdmin && t.userId !== req.user.id) await notifyUsers([t.userId], { type: 'support', title: `${t.ticketNo} is now ${status.replace('_', ' ')}`, body: t.subject, link: '/support' });
  const [item] = await shape([t]);
  res.json(item);
});

// Small numbers for the Super Admin dashboard badge
export const ticketCounts = asyncHandler(async (req, res) => {
  const where = visibleWhere(req.user);
  const [open, inProgress] = await Promise.all([
    SupportTicket.count({ where: { ...where, status: 'open' } }),
    SupportTicket.count({ where: { ...where, status: 'in_progress' } }),
  ]);
  res.json({ open, inProgress });
});
