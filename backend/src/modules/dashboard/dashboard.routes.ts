import { Router } from 'express';
import { prisma } from '../../config/db';
import { asyncHandler, ok, uid } from '../../utils/http';
import { authenticate, authorize, ADMINS } from '../../middleware/auth';

const r = Router();
r.use(authenticate);

r.get('/admin', authorize(...ADMINS), asyncHandler(async (_req, res) => {
  const [byStatus, candidates, revenue, placed, tracks, recentPayments, pendingFees, pendingApplicants] = await Promise.all([
    prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.count({ where: { role: 'CANDIDATE' } }),
    prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.placement.count({ where: { status: 'PLACED' } }),
    prisma.track.findMany({ select: { id: true, name: true, _count: { select: { applications: true, batches: true } } } }),
    prisma.payment.findMany({ where: { status: 'PAID' }, take: 5, orderBy: { paidAt: 'desc' }, include: { user: { select: { name: true } } } }),
    prisma.application.count({ where: { status: 'BOND_SIGNED' } }),
    prisma.user.count({ where: { role: 'CANDIDATE', applicantStatus: 'PENDING' } }),
  ]);
  ok(res, {
    candidates,
    pendingApplicants,
    funnel: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    revenue: { total: revenue._sum.amount ?? 0, payments: revenue._count._all, pendingFees },
    placed,
    tracks,
    recentPayments,
  });
}));

r.get('/trainer', authorize('TRAINER'), asyncHandler(async (req, res) => {
  const batches = await prisma.batch.findMany({
    where: { trainerId: uid(req) },
    include: { track: { select: { name: true } }, _count: { select: { members: true, sessions: true, assignments: true } } },
  });
  ok(res, { batches });
}));

r.get('/me', authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const id = uid(req);
  const [applications, progress, payments, unread, batches] = await Promise.all([
    prisma.application.findMany({ where: { userId: id }, include: { track: { select: { name: true, fee: true } } } }),
    prisma.progress.findMany({ where: { userId: id } }),
    prisma.payment.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.notification.count({ where: { userId: id, read: false } }),
    prisma.batch.findMany({ where: { members: { some: { userId: id } } }, select: { id: true, name: true, startDate: true } }),
  ]);
  ok(res, { applications, progress, payments, unreadNotifications: unread, batches });
}));

export default r;
