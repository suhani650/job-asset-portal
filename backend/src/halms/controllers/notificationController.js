import { AppNotification } from '../models/notification.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { unreadWhere } from '../utils/notify.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validateNotificationId = (req, res, next, id) => (UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Not found.' }));

const shape = (n) => ({ id: n.id, type: n.type, title: n.title, body: n.body || '', link: n.link || '', read: !!n.readAt, createdAt: n.createdAt });

export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const [rows, unread] = await Promise.all([
    AppNotification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit }),
    AppNotification.count({ where: unreadWhere(req.user.id) }),
  ]);
  res.json({ items: rows.map(shape), unread });
});

export const markRead = asyncHandler(async (req, res) => {
  const [n] = await AppNotification.update({ readAt: new Date() }, { where: { id: req.params.id, userId: req.user.id } });
  if (!n) throw new HttpError(404, 'Notification not found.');
  res.json({ ok: true });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await AppNotification.update({ readAt: new Date() }, { where: unreadWhere(req.user.id) });
  res.json({ ok: true });
});
