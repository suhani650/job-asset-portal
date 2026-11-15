import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { asyncHandler, ApiError, ok, paging } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS } from '../../middleware/auth';
import { sendMail } from '../../services/mail';
import { sendResume } from '../../utils/upload';

/**
 * Admin review of new sign-ups ("applicants") BEFORE they can log in.
 * PENDING -> APPROVED (shortlisted, email sent, can log in)  or  PENDING -> REJECTED.
 */
const r = Router();
r.use(authenticate, authorize(...ADMINS));

const select = {
  id: true, name: true, email: true, phone: true, isActive: true, createdAt: true,
  applicantStatus: true, resumeName: true, reviewRemarks: true, reviewedAt: true, profile: true,
} satisfies Prisma.UserSelect;

const shape = <T extends { resumeName: string | null }>(u: T) => ({ ...u, hasResume: !!u.resumeName });

async function getApplicant(id: string) {
  const u = await prisma.user.findFirst({ where: { id, role: 'CANDIDATE' } });
  if (!u) throw new ApiError(404, 'Applicant not found');
  return u;
}

// List: ?status=PENDING|APPROVED|REJECTED &search= &page= &limit=
r.get('/', asyncHandler(async (req, res) => {
  const q = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), search: z.string().optional() }).parse(req.query);
  const { page, limit, skip, take } = paging(req.query);
  const where: Prisma.UserWhereInput = {
    role: 'CANDIDATE',
    ...(q.status ? { applicantStatus: q.status } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ]);
  ok(res, items.map(shape), 'OK', 200, { page, limit, total });
}));

r.get('/:id', asyncHandler(async (req, res) => {
  await getApplicant(req.params.id);
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    select: { ...select, applications: { select: { id: true, status: true, track: { select: { name: true } } } } },
  });
  ok(res, shape(u));
}));

// Download the resume file
r.get('/:id/resume', asyncHandler(async (req, res) => {
  const u = await getApplicant(req.params.id);
  await sendResume(res, u.resumePath, u.resumeName);
}));

// Shortlist: the candidate can log in from now on, and gets an email
r.patch('/:id/approve', validate(z.object({ remarks: z.string().max(1000).optional() })),
  asyncHandler(async (req, res) => {
    const u = await getApplicant(req.params.id);
    if (u.applicantStatus === 'APPROVED') throw new ApiError(409, 'Already shortlisted');
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: { applicantStatus: 'APPROVED', reviewRemarks: req.body.remarks ?? null, reviewedAt: new Date() },
      select,
    });
    await prisma.notification.create({ data: { userId: u.id, title: 'You are shortlisted', message: 'Your resume was shortlisted. Complete the next steps from your dashboard.' } });
    await sendMail(u.email, 'You are shortlisted - login now',
      `Hello ${u.name},\n\nCongratulations! Your resume has been shortlisted.\nYou can now log in to the candidate portal with the email and password you registered with:\n${env.APP_URL}\n\nAll the best!`);
    ok(res, shape(updated), 'Applicant shortlisted and notified by email');
  }));

// Reject: no login. Any active session is revoked.
r.patch('/:id/reject', validate(z.object({ remarks: z.string().min(2).max(1000) })),
  asyncHandler(async (req, res) => {
    const u = await getApplicant(req.params.id);
    if (u.applicantStatus === 'REJECTED') throw new ApiError(409, 'Already rejected');
    if (u.applicantStatus === 'APPROVED') throw new ApiError(409, 'Already shortlisted - reject the application from the Applications screen instead');
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: { applicantStatus: 'REJECTED', reviewRemarks: req.body.remarks, reviewedAt: new Date(), refreshTokenHash: null },
      select,
    });
    await sendMail(u.email, 'Update on your application',
      `Hello ${u.name},\n\nThank you for your interest. After reviewing your resume we are unable to shortlist you at this time. We wish you the very best.`);
    ok(res, shape(updated), 'Applicant rejected');
  }));

export default r;
