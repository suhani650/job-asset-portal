import { Router } from 'express';
import { prisma } from '../../config/db';
import { asyncHandler, ok, paging, uid } from '../../utils/http';
import { authenticate } from '../../middleware/auth';

const r = Router();
r.use(authenticate);

r.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = paging(req.query);
  const where = { userId: uid(req), ...(req.query.unread === 'true' ? { read: false } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: uid(req), read: false } }),
  ]);
  ok(res, items, 'OK', 200, { page, limit, total, unread });
}));

r.patch('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: uid(req), read: false }, data: { read: true } });
  ok(res, null, 'All marked as read');
}));

r.patch('/:id/read', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id, userId: uid(req) }, data: { read: true } });
  ok(res, null, 'Marked as read');
}));

export default r;
