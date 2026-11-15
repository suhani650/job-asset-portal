import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS } from '../../middleware/auth';

const r = Router();
r.use(authenticate);

const body = z.object({ title: z.string().min(3), content: z.string().min(10) });

// Active policies; each one is flagged with `accepted` for the current user
r.get('/', asyncHandler(async (req, res) => {
  const items = await prisma.policy.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    include: { acceptances: { where: { userId: uid(req) }, select: { acceptedAt: true } } },
  });
  ok(res, items.map(({ acceptances, ...p }) => ({ ...p, accepted: acceptances.length > 0, acceptedAt: acceptances[0]?.acceptedAt ?? null })));
}));

r.post('/', authorize(...ADMINS), validate(body),
  asyncHandler(async (req, res) => ok(res, await prisma.policy.create({ data: req.body }), 'Policy created', 201)));

r.patch('/:id', authorize(...ADMINS), validate(body.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => ok(res, await prisma.policy.update({ where: { id: req.params.id }, data: req.body }), 'Policy updated')));

// Any user accepts a policy (idempotent)
r.post('/:id/accept', asyncHandler(async (req, res) => {
  const policy = await prisma.policy.findUnique({ where: { id: req.params.id } });
  if (!policy || !policy.isActive) throw new ApiError(404, 'Policy not found');
  const a = await prisma.policyAcceptance.upsert({
    where: { policyId_userId: { policyId: policy.id, userId: uid(req) } },
    update: {},
    create: { policyId: policy.id, userId: uid(req) },
  });
  ok(res, a, 'Policy accepted');
}));

r.get('/:id/acceptances', authorize(...ADMINS), asyncHandler(async (req, res) => {
  ok(res, await prisma.policyAcceptance.findMany({
    where: { policyId: req.params.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { acceptedAt: 'desc' },
  }));
}));

export default r;
