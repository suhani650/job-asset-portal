import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { env } from '../../config/env';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { signAccess, signRefresh, verifyRefresh } from '../../utils/jwt';
import { sha256, randomToken } from '../../utils/crypto';
import { sendMail } from '../../services/mail';
import { resumeUpload } from '../../utils/upload';

const r = Router();

// Extra details collected on the registration form (all optional; unknown keys are dropped by zod)
const str = (max: number) => z.string().trim().max(max).optional();
const profileSchema = z.object({
  dob: z.coerce.date().optional(),
  gender: str(40), altMobile: str(20), address: str(1000), city: str(100), state: str(100), pincode: str(10),
  qualification: str(100), course: str(200), college: str(200),
  passingYear: z.coerce.number().int().min(1950).max(2100).optional(),
  score: str(50), skills: str(1000), experienceType: str(30),
  expYears: z.coerce.number().min(0).max(60).optional(),
  currentCompany: str(200), noticePeriod: str(50), interest: str(100), jobRole: str(200), prefLocation: str(200),
  expectedSalary: z.coerce.number().int().min(0).optional(),
  relocate: str(10), linkedin: str(300), source: str(100),
});

const publicUser = (u: { id: string; name: string; email: string; phone: string | null; role: string; applicantStatus?: string }) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, applicantStatus: u.applicantStatus,
});

/**
 * Login gate: a candidate can sign in only after an Admin has shortlisted the resume.
 * Staff (admin / super admin / trainer) are never blocked by this.
 */
function assertCanLogin(u: { role: string; applicantStatus: string }) {
  if (u.role !== 'CANDIDATE') return;
  if (u.applicantStatus === 'PENDING')
    throw new ApiError(403, 'Your resume is under review. You can log in after you are shortlisted - we will email you.', { code: 'APPLICANT_PENDING' });
  if (u.applicantStatus === 'REJECTED')
    throw new ApiError(403, 'Your application was not shortlisted.', { code: 'APPLICANT_REJECTED' });
}

// With multipart/form-data every field is text, so the nested "profile" object arrives as a JSON string.
function parseProfileField(req: Request, _res: Response, next: NextFunction) {
  if (typeof req.body?.profile === 'string') {
    if (req.body.profile.trim() === '') delete req.body.profile;
    else {
      try { req.body.profile = JSON.parse(req.body.profile); }
      catch { return next(new ApiError(400, 'profile must be valid JSON')); }
    }
  }
  next();
}

async function issueTokens(user: { id: string; role: any }) {
  const accessToken = signAccess(user.id, user.role);
  const refreshToken = signRefresh(user.id, user.role);
  await prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: sha256(refreshToken) } });
  return { accessToken, refreshToken };
}

// Public application form: multipart/form-data with fields name, email, password, phone, profile (JSON string)
// and the file field "resume" (PDF / DOC / DOCX). NO login tokens are issued: the account stays PENDING
// until an Admin shortlists the resume (see /applicants).
r.post(
  '/register',
  resumeUpload,
  parseProfileField,
  validate(z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    phone: z.string().optional(),
    profile: profileSchema.optional(),
  })),
  asyncHandler(async (req, res) => {
    const { name, email, password, phone, profile } = req.body;
    if (!req.file) throw new ApiError(400, 'Please upload your resume (PDF, DOC or DOCX)');
    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) throw new ApiError(409, 'Email already registered');
    const user = await prisma.user.create({
      data: {
        name, email: email.toLowerCase(), phone, passwordHash: await bcrypt.hash(password, 10), role: 'CANDIDATE',
        applicantStatus: 'PENDING', resumePath: req.file.filename, resumeName: req.file.originalname.slice(0, 200),
        ...(profile ? { profile: { create: profile } } : {}),
      },
    });
    // in-app alert for every active admin (no email, so spam sign-ups cannot flood inboxes)
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true }, select: { id: true } });
    if (admins.length)
      await prisma.notification.createMany({
        data: admins.map((a) => ({ userId: a.id, title: 'New applicant', message: `${user.name} applied. Please review the resume.` })),
      });
    await sendMail(user.email, 'Application received',
      `Hello ${user.name},\n\nThank you for applying. Our team will review your resume. If you are shortlisted we will email you, and you can then log in to the candidate portal.`);
    ok(res, { user: publicUser(user) }, 'Application received. You can log in after the Admin shortlists your resume - we will email you.', 201);
  }),
);

r.post(
  '/login',
  validate(z.object({ email: z.string().email(), password: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash)))
      throw new ApiError(401, 'Invalid email or password');
    if (!user.isActive) throw new ApiError(403, 'Account disabled');
    assertCanLogin(user); // checked only AFTER the password is correct, so it never reveals who has applied
    const tokens = await issueTokens(user);
    ok(res, { user: publicUser(user), ...tokens }, 'Logged in');
  }),
);

r.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    let payload;
    try { payload = verifyRefresh(req.body.refreshToken); } catch { throw new ApiError(401, 'Invalid refresh token'); }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.refreshTokenHash !== sha256(req.body.refreshToken))
      throw new ApiError(401, 'Refresh token revoked');
    assertCanLogin(user);
    ok(res, await issueTokens(user), 'Token refreshed');
  }),
);

r.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await prisma.user.update({ where: { id: uid(req) }, data: { refreshTokenHash: null } });
  ok(res, null, 'Logged out');
}));

r.post(
  '/forgot-password',
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
    if (user) {
      const token = randomToken();
      await prisma.passwordReset.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
      });
      await sendMail(user.email, 'Reset your password',
        `Use this link within 30 minutes: ${env.APP_URL}/reset-password?token=${token}`);
    }
    ok(res, null, 'If the email exists, a reset link has been sent');
  }),
);

r.post(
  '/reset-password',
  validate(z.object({ token: z.string().min(10), password: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const rec = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(req.body.token) } });
    if (!rec || rec.used || rec.expiresAt < new Date()) throw new ApiError(400, 'Invalid or expired token');
    await prisma.$transaction([
      prisma.user.update({ where: { id: rec.userId }, data: { passwordHash: await bcrypt.hash(req.body.password, 10), refreshTokenHash: null } }),
      prisma.passwordReset.update({ where: { id: rec.id }, data: { used: true } }),
    ]);
    ok(res, null, 'Password updated');
  }),
);

r.post(
  '/change-password',
  authenticate,
  validate(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: uid(req) } });
    if (!user || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash)))
      throw new ApiError(400, 'Current password is incorrect');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(req.body.newPassword, 10) } });
    ok(res, null, 'Password changed');
  }),
);

export default r;