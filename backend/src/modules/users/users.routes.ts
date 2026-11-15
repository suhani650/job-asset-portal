import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, paging, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS } from '../../middleware/auth';
import { resumeUpload, removeUpload, sendResume } from '../../utils/upload';

const r = Router();
r.use(authenticate);

const safe = { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true, applicantStatus: true, resumeName: true } as const;

// Candidate profile fields (same keys as registration form). All optional.
const str = (max: number) => z.string().trim().max(max).optional();
const profileFields = {
  dob: z.coerce.date().optional(),
  gender: str(40), altMobile: str(20), address: str(1000), city: str(100), state: str(100), pincode: str(10),
  qualification: str(100), course: str(200), college: str(200),
  passingYear: z.coerce.number().int().min(1950).max(2100).optional(),
  score: str(50), skills: str(1000), experienceType: str(30),
  expYears: z.coerce.number().min(0).max(60).optional(),
  currentCompany: str(200), noticePeriod: str(50), interest: str(100), jobRole: str(200), prefLocation: str(200),
  expectedSalary: z.coerce.number().int().min(0).optional(),
  relocate: str(10), linkedin: str(300), source: str(100),
};

const profileSchema = z.object(profileFields);

// user + profile; college/city are also copied to the top level for simple UIs
async function meWithProfile(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { ...safe, profile: true } });
  if (!u) throw new ApiError(404, 'User not found');
  return { ...u, college: u.profile?.college ?? null, city: u.profile?.city ?? null };
}

r.get('/me', asyncHandler(async (req, res) => {
  ok(res, await meWithProfile(uid(req)));
}));

r.patch('/me',
  validate(z.object({ name: z.string().min(2).optional(), phone: z.string().optional(), ...profileFields })),
  asyncHandler(async (req, res) => {
    const { name, phone, ...profile } = req.body as { name?: string; phone?: string } & z.infer<typeof profileSchema>;
    const userData = { ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}) };
    if (Object.keys(userData).length) await prisma.user.update({ where: { id: uid(req) }, data: userData });
    if (Object.keys(profile).length) {
      await prisma.candidateProfile.upsert({
        where: { userId: uid(req) },
        update: profile,
        create: { ...profile, userId: uid(req) },
      });
    }
    ok(res, await meWithProfile(uid(req)), 'Profile updated');
  }));

r.get('/', authorize(...ADMINS), asyncHandler(async (req, res) => {
  const { role, search, isActive } = req.query as Record<string, string | undefined>;
  const { page, limit, skip, take } = paging(req.query);
  const where: Prisma.UserWhereInput = {
    ...(role ? { role: role as Role } : {}),
    ...(isActive ? { isActive: isActive === 'true' } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: safe, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ]);
  ok(res, items, 'OK', 200, { page, limit, total });
}));

// Candidate: download my own resume / replace it with a new file (multipart field "resume")
r.get('/me/resume', authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: uid(req) }, select: { resumePath: true, resumeName: true } });
  await sendResume(res, u?.resumePath ?? null, u?.resumeName ?? null);
}));

r.post('/me/resume', authorize('CANDIDATE'), resumeUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Please choose a PDF, DOC or DOCX file (field name: resume)');
  const old = await prisma.user.findUnique({ where: { id: uid(req) }, select: { resumePath: true } });
  await prisma.user.update({ where: { id: uid(req) }, data: { resumePath: req.file.filename, resumeName: req.file.originalname.slice(0, 200) } });
  removeUpload(old?.resumePath);
  ok(res, await meWithProfile(uid(req)), 'Resume updated');
}));

// SUPER_ADMIN creates staff (admin / trainer) accounts
r.post('/', authorize(Role.SUPER_ADMIN),
  validate(z.object({
    name: z.string().min(2), email: z.string().email(), password: z.string().min(8),
    phone: z.string().optional(), role: z.enum(['ADMIN', 'TRAINER']),
  })),
  asyncHandler(async (req, res) => {
    const { password, email, ...rest } = req.body;
    const u = await prisma.user.create({
      data: { ...rest, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), applicantStatus: 'APPROVED' }, select: safe,
    });
    ok(res, u, 'User created', 201);
  }));

r.patch('/:id', authorize(Role.SUPER_ADMIN),
  validate(z.object({ role: z.enum(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'CANDIDATE']).optional(), isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    if (req.params.id === uid(req)) throw new ApiError(400, 'You cannot change your own role/status');
    ok(res, await prisma.user.update({ where: { id: req.params.id }, data: req.body, select: safe }), 'User updated');
  }));

export default r;