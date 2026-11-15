import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isStaff } from '../../middleware/auth';
import { moveStatus } from '../applications/applications.service';
import { notify } from '../../services/notify';

const r = Router();
r.use(authenticate);

const include = {
  application: { include: { user: { select: { id: true, name: true, email: true } }, track: { select: { name: true } } } },
  interviewer: { select: { id: true, name: true } },
};

// Schedule (or reschedule) an interview
r.post('/', authorize(...ADMINS),
  validate(z.object({
    applicationId: z.string(), scheduledAt: z.coerce.date(),
    mode: z.enum(['ONLINE', 'OFFLINE']).default('ONLINE'), link: z.string().optional(), interviewerId: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const { applicationId, ...rest } = req.body;
    const app = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new ApiError(404, 'Application not found');
    if (app.status !== 'TEST_COMPLETED' && app.status !== 'SHORTLISTED' && app.status !== 'INTERVIEW_SCHEDULED')
      throw new ApiError(409, `Cannot schedule interview while status is ${app.status}`);

    await prisma.interview.updateMany({ where: { applicationId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    const interview = await prisma.interview.create({
      data: { applicationId, interviewerId: rest.interviewerId ?? uid(req), scheduledAt: rest.scheduledAt, mode: rest.mode, link: rest.link },
      include,
    });
    if (app.status === 'TEST_COMPLETED' || app.status === 'SHORTLISTED') await moveStatus(applicationId, 'INTERVIEW_SCHEDULED');
    else await notify(app.userId, 'Interview rescheduled', `Your interview is now on ${rest.scheduledAt.toISOString()}.`);
    ok(res, interview, 'Interview scheduled', 201);
  }));

// Complete with notes + rating. PASS -> INTERVIEWED, FAIL -> REJECTED
r.patch('/:id/complete', authorize(...ADMINS),
  validate(z.object({ rating: z.number().int().min(1).max(10), notes: z.string().optional(), result: z.enum(['PASS', 'FAIL']) })),
  asyncHandler(async (req, res) => {
    const iv = await prisma.interview.findUnique({ where: { id: req.params.id } });
    if (!iv) throw new ApiError(404, 'Interview not found');
    if (iv.status !== 'SCHEDULED') throw new ApiError(409, 'Interview is not in scheduled state');
    const updated = await prisma.interview.update({ where: { id: iv.id }, data: { ...req.body, status: 'COMPLETED' } });
    if (req.body.result === 'PASS') await moveStatus(iv.applicationId, 'INTERVIEWED');
    else await moveStatus(iv.applicationId, 'REJECTED', 'Did not clear the interview');
    ok(res, updated, 'Interview completed');
  }));

r.patch('/:id/cancel', authorize(...ADMINS), asyncHandler(async (req, res) => {
  ok(res, await prisma.interview.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } }), 'Interview cancelled');
}));

r.get('/', asyncHandler(async (req, res) => {
  const { status, applicationId } = req.query as Record<string, string | undefined>;
  ok(res, await prisma.interview.findMany({
    where: {
      ...(isStaff(req) ? {} : { application: { userId: uid(req) } }),
      ...(status ? { status: status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' } : {}),
      ...(applicationId ? { applicationId } : {}),
    },
    include, orderBy: { scheduledAt: 'desc' },
  }));
}));

export default r;
