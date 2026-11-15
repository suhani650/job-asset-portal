import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isStaff } from '../../middleware/auth';
import { moveStatus } from '../applications/applications.service';

const r = Router();
r.use(authenticate);

const GRACE_MS = 30 * 1000;

// ---------- Admin: manage tests ----------
r.post('/', authorize(...ADMINS),
  validate(z.object({
    trackId: z.string(), title: z.string().min(2),
    durationMins: z.number().int().positive().default(30),
    passPercent: z.number().int().min(0).max(100).default(50),
  })),
  asyncHandler(async (req, res) => ok(res, await prisma.test.create({ data: req.body }), 'Test created', 201)));

r.patch('/:id', authorize(...ADMINS),
  validate(z.object({
    title: z.string().min(2).optional(), durationMins: z.number().int().positive().optional(),
    passPercent: z.number().int().min(0).max(100).optional(), isActive: z.boolean().optional(),
  })),
  asyncHandler(async (req, res) => ok(res, await prisma.test.update({ where: { id: req.params.id }, data: req.body }), 'Test updated')));

r.post('/:id/questions', authorize(...ADMINS),
  validate(z.object({
    text: z.string().min(3), options: z.array(z.string().min(1)).min(2).max(6),
    correctIndex: z.number().int().min(0), marks: z.number().int().positive().default(1),
  }).refine((q) => q.correctIndex < q.options.length, { message: 'correctIndex out of range' })),
  asyncHandler(async (req, res) => {
    ok(res, await prisma.question.create({ data: { ...req.body, testId: req.params.id } }), 'Question added', 201);
  }));

r.delete('/questions/:qid', authorize(...ADMINS), asyncHandler(async (req, res) => {
  await prisma.question.delete({ where: { id: req.params.qid } });
  ok(res, null, 'Question deleted');
}));

// Delete a whole test, only while nobody has attempted it (so no candidate's result is ever lost).
// Its questions go with it (onDelete: Cascade in the schema).
r.delete('/:id', authorize(...ADMINS), asyncHandler(async (req, res) => {
  const test = await prisma.test.findUnique({ where: { id: req.params.id } });
  if (!test) throw new ApiError(404, 'Test not found');
  const attempts = await prisma.testAttempt.count({ where: { testId: test.id } });
  if (attempts > 0) throw new ApiError(409, 'This test already has attempts, so it cannot be deleted.');
  await prisma.test.delete({ where: { id: test.id } });
  ok(res, null, 'Test deleted');
}));

// ---------- Attempts (declared before /:id) ----------
r.get('/attempts/list', asyncHandler(async (req, res) => {
  const { applicationId, testId } = req.query as Record<string, string | undefined>;
  ok(res, await prisma.testAttempt.findMany({
    where: { ...(isStaff(req) ? {} : { userId: uid(req) }), ...(applicationId ? { applicationId } : {}), ...(testId ? { testId } : {}) },
    include: { test: { select: { title: true } }, user: { select: { id: true, name: true, email: true } } },
    orderBy: { startedAt: 'desc' },
  }));
}));

r.post('/attempts/:attemptId/submit',
  authorize('CANDIDATE'),
  validate(z.object({ answers: z.record(z.string(), z.number().int()) })),
  asyncHandler(async (req, res) => {
    const attempt = await prisma.testAttempt.findUnique({
      where: { id: req.params.attemptId }, include: { test: { include: { questions: true } } },
    });
    if (!attempt || attempt.userId !== uid(req)) throw new ApiError(404, 'Attempt not found');
    if (attempt.submittedAt) throw new ApiError(409, 'Already submitted');

    const deadline = attempt.startedAt.getTime() + attempt.test.durationMins * 60 * 1000 + GRACE_MS;
    const late = Date.now() > deadline;
    const answers = req.body.answers as Record<string, number>;

    let score = 0;
    let total = 0;
    for (const q of attempt.test.questions) {
      total += q.marks;
      if (!late && answers[q.id] === q.correctIndex) score += q.marks;
    }
    const percent = total ? Math.round((score / total) * 10000) / 100 : 0;
    const passed = percent >= attempt.test.passPercent;

    const saved = await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: { submittedAt: new Date(), answers, score, total, percent, passed },
    });
    await moveStatus(attempt.applicationId, 'TEST_COMPLETED');
    ok(res, { ...saved, late }, late ? 'Time over - submitted with 0 score' : 'Test submitted');
  }));

// ---------- Read ----------
r.get('/', asyncHandler(async (req, res) => {
  const { trackId } = req.query as Record<string, string | undefined>;
  ok(res, await prisma.test.findMany({
    where: { ...(trackId ? { trackId } : {}), ...(isStaff(req) ? {} : { isActive: true }) },
    include: { _count: { select: { questions: true } } },
  }));
}));

r.get('/:id', authorize(...ADMINS), asyncHandler(async (req, res) => {
  ok(res, await prisma.test.findUniqueOrThrow({ where: { id: req.params.id }, include: { questions: true } }));
}));

// ---------- Candidate: start ----------
r.post('/:id/start', authorize('CANDIDATE'), validate(z.object({ applicationId: z.string() })),
  asyncHandler(async (req, res) => {
    const app = await prisma.application.findUnique({ where: { id: req.body.applicationId } });
    if (!app || app.userId !== uid(req)) throw new ApiError(404, 'Application not found');
    if (app.status !== 'APPLIED') throw new ApiError(409, 'Test can only be taken right after applying');
    const test = await prisma.test.findUnique({ where: { id: req.params.id }, include: { questions: true } });
    if (!test || !test.isActive) throw new ApiError(404, 'Test not available');
    if (test.trackId !== app.trackId) throw new ApiError(400, 'This test is for a different track');

    let attempt = await prisma.testAttempt.findUnique({
      where: { testId_applicationId: { testId: test.id, applicationId: app.id } },
    });
    if (attempt?.submittedAt) throw new ApiError(409, 'Test already submitted');
    if (!attempt) attempt = await prisma.testAttempt.create({ data: { testId: test.id, applicationId: app.id, userId: uid(req) } });

    ok(res, {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      endsAt: new Date(attempt.startedAt.getTime() + test.durationMins * 60 * 1000),
      questions: test.questions.map((q) => ({ id: q.id, text: q.text, options: q.options, marks: q.marks })),
    }, 'Test started');
  }));

export default r;
