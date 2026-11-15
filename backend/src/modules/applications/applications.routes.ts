import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, paging, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isStaff } from '../../middleware/auth';
import { moveStatus } from './applications.service';

const r = Router();
r.use(authenticate);

const include = { track: true, user: { select: { id: true, name: true, email: true, phone: true } } };

r.post('/', authorize('CANDIDATE'),
  validate(z.object({ trackId: z.string(), statement: z.string().max(2000).optional(), resumeUrl: z.string().url().optional() })),
  asyncHandler(async (req, res) => {
    const track = await prisma.track.findUnique({ where: { id: req.body.trackId } });
    if (!track || !track.isActive) throw new ApiError(404, 'Track not available');
    const app = await prisma.application.create({ data: { ...req.body, userId: uid(req) }, include });
    ok(res, app, 'Application submitted', 201);
  }));

r.get('/', asyncHandler(async (req, res) => {
  const { status, trackId, search } = req.query as Record<string, string | undefined>;
  const { page, limit, skip, take } = paging(req.query);
  const where: Prisma.ApplicationWhereInput = {
    ...(isStaff(req) ? {} : { userId: uid(req) }),
    ...(status ? { status: status as ApplicationStatus } : {}),
    ...(trackId ? { trackId } : {}),
    ...(search && isStaff(req) ? { user: { OR: [{ name: { contains: search } }, { email: { contains: search } }] } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.application.findMany({ where, include, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.application.count({ where }),
  ]);
  ok(res, items, 'OK', 200, { page, limit, total });
}));

r.get('/:id', asyncHandler(async (req, res) => {
  const app = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { ...include, attempts: true, interviews: true, payments: true, bond: true, progress: true, placement: true },
  });
  if (!app) throw new ApiError(404, 'Application not found');
  if (!isStaff(req) && app.userId !== uid(req)) throw new ApiError(403, 'Forbidden');
  ok(res, app);
}));

r.patch('/:id/shortlist', authorize(...ADMINS), validate(z.object({ remarks: z.string().optional() })),
  asyncHandler(async (req, res) => {
    ok(res, await moveStatus(req.params.id, 'SHORTLISTED', req.body.remarks), 'Candidate shortlisted');
  }));

r.patch('/:id/select', authorize(...ADMINS), validate(z.object({ remarks: z.string().optional() })),
  asyncHandler(async (req, res) => {
    ok(res, await moveStatus(req.params.id, 'SELECTED', req.body.remarks), 'Candidate selected');
  }));

r.patch('/:id/reject', authorize(...ADMINS), validate(z.object({ remarks: z.string().min(2) })),
  asyncHandler(async (req, res) => {
    ok(res, await moveStatus(req.params.id, 'REJECTED', req.body.remarks), 'Candidate rejected');
  }));

export default r;
