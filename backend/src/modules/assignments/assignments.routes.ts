import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, STAFF, isAdmin, isStaff } from '../../middleware/auth';
import { safeRecalc } from '../progress/progress.service';
import { notify } from '../../services/notify';

const r = Router();
r.use(authenticate);

async function trainerOwnsBatch(req: Parameters<typeof isStaff>[0], batchId: string) {
  if (isAdmin(req)) return;
  const b = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!b || b.trainerId !== uid(req)) throw new ApiError(403, 'Not your batch');
}

r.post('/', authorize(...STAFF),
  validate(z.object({ batchId: z.string(), title: z.string().min(2), description: z.string().optional(), dueDate: z.coerce.date(), maxMarks: z.number().int().positive().default(100) })),
  asyncHandler(async (req, res) => {
    await trainerOwnsBatch(req, req.body.batchId);
    const a = await prisma.assignment.create({ data: req.body });
    const members = await prisma.batchMember.findMany({ where: { batchId: a.batchId } });
    await Promise.all(members.map((m) => notify(m.userId, 'New assignment', `${a.title} - due ${a.dueDate.toDateString()}`)));
    ok(res, a, 'Assignment created', 201);
  }));

r.get('/', asyncHandler(async (req, res) => {
  const { batchId } = req.query as Record<string, string | undefined>;
  const where = isStaff(req)
    ? { ...(batchId ? { batchId } : {}), ...(isAdmin(req) ? {} : { batch: { trainerId: uid(req) } }) }
    : { ...(batchId ? { batchId } : {}), batch: { members: { some: { userId: uid(req) } } } };
  ok(res, await prisma.assignment.findMany({
    where, include: { submissions: isStaff(req) ? false : { where: { userId: uid(req) } } }, orderBy: { dueDate: 'asc' },
  }));
}));

// Candidate: my assignments in one flat list, with my submission status/marks
r.get('/mine', authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const list = await prisma.assignment.findMany({
    where: { batch: { members: { some: { userId: uid(req) } } } },
    include: { submissions: { where: { userId: uid(req) } } },
    orderBy: { dueDate: 'asc' },
  });
  ok(res, list.map((a) => {
    const sub = a.submissions[0];
    const status = !sub ? 'PENDING' : sub.marks !== null ? 'GRADED' : 'SUBMITTED';
    return {
      id: a.id, batchId: a.batchId, title: a.title, description: a.description,
      dueDate: a.dueDate, dueAt: a.dueDate, maxMarks: a.maxMarks,
      status, marks: sub?.marks ?? null, feedback: sub?.feedback ?? null, submittedAt: sub?.submittedAt ?? null,
    };
  }));
}));

r.post('/:id/submit', authorize('CANDIDATE'),
  validate(z.object({ text: z.string().optional(), fileUrl: z.string().url().optional(), note: z.string().optional(), link: z.string().url().optional() })
    .refine((v) => v.text || v.fileUrl || v.note || v.link, { message: 'Provide text or fileUrl' })),
  asyncHandler(async (req, res) => {
    const a = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!a) throw new ApiError(404, 'Assignment not found');
    const member = await prisma.batchMember.findFirst({ where: { batchId: a.batchId, userId: uid(req) } });
    if (!member) throw new ApiError(403, 'Training is locked or you are not in this batch');
    const existing = await prisma.submission.findUnique({ where: { assignmentId_userId: { assignmentId: a.id, userId: uid(req) } } });
    if (existing?.marks !== null && existing?.marks !== undefined) throw new ApiError(409, 'Already graded, cannot resubmit');
    // the web/app form sends note + link; the original API uses text + fileUrl. Accept both.
    const data = { text: req.body.text ?? req.body.note, fileUrl: req.body.fileUrl ?? req.body.link };
    const s = await prisma.submission.upsert({
      where: { assignmentId_userId: { assignmentId: a.id, userId: uid(req) } },
      update: { ...data, submittedAt: new Date() },
      create: { ...data, assignmentId: a.id, userId: uid(req) },
    });
    ok(res, { ...s, late: new Date() > a.dueDate }, 'Submitted', 201);
  }));

r.get('/:id/submissions', authorize(...STAFF), asyncHandler(async (req, res) => {
  const a = await prisma.assignment.findUnique({ where: { id: req.params.id } });
  if (!a) throw new ApiError(404, 'Assignment not found');
  await trainerOwnsBatch(req, a.batchId);
  ok(res, await prisma.submission.findMany({ where: { assignmentId: a.id }, include: { user: { select: { id: true, name: true, email: true } } } }));
}));

r.patch('/submissions/:submissionId/grade', authorize(...STAFF),
  validate(z.object({ marks: z.number().int().min(0), feedback: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const s = await prisma.submission.findUnique({ where: { id: req.params.submissionId }, include: { assignment: true } });
    if (!s) throw new ApiError(404, 'Submission not found');
    await trainerOwnsBatch(req, s.assignment.batchId);
    if (req.body.marks > s.assignment.maxMarks) throw new ApiError(400, `Marks cannot exceed ${s.assignment.maxMarks}`);
    const graded = await prisma.submission.update({ where: { id: s.id }, data: req.body });
    const m = await prisma.batchMember.findFirst({ where: { batchId: s.assignment.batchId, userId: s.userId } });
    if (m) await safeRecalc(m.applicationId);
    await notify(s.userId, 'Assignment graded', `${s.assignment.title}: ${req.body.marks}/${s.assignment.maxMarks}`);
    ok(res, graded, 'Graded');
  }));

export default r;