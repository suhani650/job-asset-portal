import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, STAFF, isAdmin, isStaff } from '../../middleware/auth';
import { moveStatus } from '../applications/applications.service';
import { safeRecalc } from '../progress/progress.service';

const r = Router();
r.use(authenticate);

/** LOCK RULE: candidates reach batch content only if they are batch members,
 *  and they become members only after fee paid + bond signed. */
async function assertBatchAccess(req: Parameters<typeof isStaff>[0], batchId: string) {
  if (isStaff(req)) {
    if (!isAdmin(req)) {
      const b = await prisma.batch.findUnique({ where: { id: batchId } });
      if (!b || b.trainerId !== uid(req)) throw new ApiError(403, 'Not your batch');
    }
    return;
  }
  const m = await prisma.batchMember.findFirst({ where: { batchId, userId: uid(req) } });
  if (!m) throw new ApiError(403, 'Training is locked. Complete fee payment and bond signing first.');
}

// ---- Batches ----
r.post('/batches', authorize(...ADMINS),
  validate(z.object({ trackId: z.string(), name: z.string().min(2), trainerId: z.string().optional(), startDate: z.coerce.date(), endDate: z.coerce.date().optional() })),
  asyncHandler(async (req, res) => ok(res, await prisma.batch.create({ data: req.body }), 'Batch created', 201)));

r.patch('/batches/:id', authorize(...ADMINS),
  validate(z.object({ name: z.string().min(2).optional(), trainerId: z.string().nullable().optional(), startDate: z.coerce.date().optional(), endDate: z.coerce.date().nullable().optional() })),
  asyncHandler(async (req, res) => ok(res, await prisma.batch.update({ where: { id: req.params.id }, data: req.body }), 'Batch updated')));

r.get('/batches', asyncHandler(async (req, res) => {
  const where = isAdmin(req) ? {} : isStaff(req) ? { trainerId: uid(req) } : { members: { some: { userId: uid(req) } } };
  ok(res, await prisma.batch.findMany({
    where, include: { track: { select: { name: true } }, trainer: { select: { id: true, name: true } }, _count: { select: { members: true, sessions: true } } },
    orderBy: { startDate: 'desc' },
  }));
}));

r.get('/batches/:id/members', authorize(...STAFF), asyncHandler(async (req, res) => {
  await assertBatchAccess(req, req.params.id);
  ok(res, await prisma.batchMember.findMany({ where: { batchId: req.params.id }, include: { user: { select: { id: true, name: true, email: true } } } }));
}));

// Add a candidate: allowed only when the bond is signed AND the fee is paid (status FEE_PAID)
r.post('/batches/:id/members', authorize(...ADMINS), validate(z.object({ applicationId: z.string() })),
  asyncHandler(async (req, res) => {
    const batch = await prisma.batch.findUnique({ where: { id: req.params.id } });
    const app = await prisma.application.findUnique({ where: { id: req.body.applicationId } });
    if (!batch || !app) throw new ApiError(404, 'Batch or application not found');
    if (app.trackId !== batch.trackId) throw new ApiError(400, 'Application belongs to a different track');
    if (app.status !== 'FEE_PAID') throw new ApiError(409, 'Training is locked until the bond is signed and the fee is paid');
    const member = await prisma.batchMember.create({ data: { batchId: batch.id, applicationId: app.id, userId: app.userId } });
    await moveStatus(app.id, 'IN_TRAINING');
    await prisma.progress.upsert({ where: { applicationId: app.id }, update: {}, create: { applicationId: app.id, userId: app.userId } });
    ok(res, member, 'Candidate added to batch', 201);
  }));

// Remove a candidate from a batch (the application and its data are kept)
r.delete('/batches/:id/members/:applicationId', authorize(...ADMINS), asyncHandler(async (req, res) => {
  const member = await prisma.batchMember.findUnique({ where: { batchId_applicationId: { batchId: req.params.id, applicationId: req.params.applicationId } } });
  if (!member) throw new ApiError(404, 'This candidate is not in the batch');
  await prisma.batchMember.delete({ where: { id: member.id } });
  ok(res, null, 'Candidate removed from the batch');
}));

// ---- Sessions ----
r.post('/batches/:id/sessions', authorize(...STAFF),
  validate(z.object({ title: z.string().min(2), date: z.coerce.date(), contentUrl: z.string().optional() })),
  asyncHandler(async (req, res) => {
    await assertBatchAccess(req, req.params.id);
    ok(res, await prisma.session.create({ data: { ...req.body, batchId: req.params.id } }), 'Session created', 201);
  }));

r.get('/batches/:id/sessions', asyncHandler(async (req, res) => {
  await assertBatchAccess(req, req.params.id);
  ok(res, await prisma.session.findMany({ where: { batchId: req.params.id }, orderBy: { date: 'asc' } }));
}));

// ---- Attendance ----
r.post('/sessions/:id/attendance', authorize(...STAFF),
  validate(z.object({ records: z.array(z.object({ userId: z.string(), present: z.boolean() })).min(1) })),
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session) throw new ApiError(404, 'Session not found');
    await assertBatchAccess(req, session.batchId);
    const members = await prisma.batchMember.findMany({ where: { batchId: session.batchId } });
    const byUser = new Map(members.map((m) => [m.userId, m.applicationId]));
    const valid = (req.body.records as { userId: string; present: boolean }[]).filter((x) => byUser.has(x.userId));

    await prisma.$transaction(valid.map((x) => prisma.attendance.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: x.userId } },
      update: { present: x.present }, create: { sessionId: session.id, userId: x.userId, present: x.present },
    })));
    await Promise.all(valid.map((x) => safeRecalc(byUser.get(x.userId) as string)));
    ok(res, { saved: valid.length }, 'Attendance saved');
  }));

r.get('/sessions/:id/attendance', authorize(...STAFF), asyncHandler(async (req, res) => {
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session) throw new ApiError(404, 'Session not found');
  await assertBatchAccess(req, session.batchId);
  ok(res, await prisma.attendance.findMany({ where: { sessionId: session.id }, include: { user: { select: { id: true, name: true } } } }));
}));

// Candidate: all sessions of my batch(es), flattened for the app/web (empty until added to a batch)
r.get('/sessions/mine', authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const members = await prisma.batchMember.findMany({ where: { userId: uid(req) }, select: { batchId: true } });
  const sessions = await prisma.session.findMany({
    where: { batchId: { in: members.map((m) => m.batchId) } },
    include: { batch: { select: { name: true, trainer: { select: { name: true } } } } },
    orderBy: { date: 'asc' },
  });
  ok(res, sessions.map((s) => ({
    id: s.id, batchId: s.batchId, title: s.title,
    date: s.date, startsAt: s.date, link: s.contentUrl,
    batch: s.batch.name, trainer: s.batch.trainer?.name ?? null,
  })));
}));

r.get('/my-attendance', authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  ok(res, await prisma.attendance.findMany({ where: { userId: uid(req) }, include: { session: { select: { title: true, date: true } } }, orderBy: { session: { date: 'desc' } } }));
}));

export default r;