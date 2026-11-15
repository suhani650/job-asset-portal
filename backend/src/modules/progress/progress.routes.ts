import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, STAFF, isStaff } from '../../middleware/auth';
import { recalcProgress } from './progress.service';

const r = Router();
r.use(authenticate);

r.get('/mine', asyncHandler(async (req, res) => {
  ok(res, await prisma.progress.findMany({ where: { userId: uid(req) }, include: { application: { select: { id: true, status: true, track: { select: { name: true } } } } } }));
}));

r.get('/application/:applicationId', asyncHandler(async (req, res) => {
  const p = await prisma.progress.findUnique({ where: { applicationId: req.params.applicationId } });
  if (!p) throw new ApiError(404, 'No progress yet');
  if (!isStaff(req) && p.userId !== uid(req)) throw new ApiError(403, 'Forbidden');
  ok(res, p);
}));

// Skill-wise breakdown per track/batch (staff)
r.get('/batch/:batchId', authorize(...STAFF), asyncHandler(async (req, res) => {
  const members = await prisma.batchMember.findMany({ where: { batchId: req.params.batchId }, select: { applicationId: true } });
  ok(res, await prisma.progress.findMany({
    where: { applicationId: { in: members.map((m) => m.applicationId) } },
    include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { overallPct: 'desc' },
  }));
}));

r.post('/application/:applicationId/rating', authorize(...STAFF),
  validate(z.object({ rating: z.number().int().min(0).max(100) })),
  asyncHandler(async (req, res) => {
    const app = await prisma.application.findUnique({ where: { id: req.params.applicationId } });
    if (!app) throw new ApiError(404, 'Application not found');
    await prisma.progress.upsert({
      where: { applicationId: app.id }, update: { trainerRating: req.body.rating },
      create: { applicationId: app.id, userId: app.userId, trainerRating: req.body.rating },
    });
    ok(res, await recalcProgress(app.id), 'Rating saved');
  }));

r.post('/application/:applicationId/recalculate', authorize(...STAFF), asyncHandler(async (req, res) => {
  ok(res, await recalcProgress(req.params.applicationId), 'Progress recalculated');
}));

export default r;
