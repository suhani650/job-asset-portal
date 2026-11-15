import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isStaff } from '../../middleware/auth';
import { sha256, safeEqual } from '../../utils/crypto';
import { sendMail } from '../../services/mail';
import { moveStatus } from '../applications/applications.service';
import { ensureBond } from './bonds.service';

const r = Router();
r.use(authenticate);

const publicBond = <T extends { otpHash?: string | null }>(b: T) => {
  const { otpHash: _o, ...rest } = b as T & { otpHash?: string | null };
  return rest;
};

r.get('/', asyncHandler(async (req, res) => {
  const items = await prisma.bond.findMany({
    where: isStaff(req) ? {} : { userId: uid(req) },
    include: { user: { select: { id: true, name: true, email: true } }, application: { select: { track: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, items.map(publicBond));
}));

r.get('/application/:applicationId', asyncHandler(async (req, res) => {
  let b = await prisma.bond.findUnique({ where: { applicationId: req.params.applicationId } });
  if (!b) {
    // candidates selected before the "bond first" change have no bond yet: create it now
    const a = await prisma.application.findUnique({ where: { id: req.params.applicationId }, select: { status: true, userId: true } });
    if (a?.status === 'SELECTED' && (isStaff(req) || a.userId === uid(req))) b = await ensureBond(req.params.applicationId);
  }
  if (!b) throw new ApiError(404, 'Bond not generated yet (it is created when you are selected)');
  if (!isStaff(req) && b.userId !== uid(req)) throw new ApiError(403, 'Forbidden');
  ok(res, publicBond(b));
}));

// Admin can edit the bond terms before it is signed
r.patch('/:id', authorize(...ADMINS),
  validate(z.object({ months: z.number().int().positive().optional(), amount: z.number().int().min(0).optional(), terms: z.string().min(10).optional() })),
  asyncHandler(async (req, res) => {
    const b = await prisma.bond.findUnique({ where: { id: req.params.id } });
    if (!b) throw new ApiError(404, 'Bond not found');
    if (b.status === 'SIGNED') throw new ApiError(409, 'Signed bond cannot be edited');
    ok(res, publicBond(await prisma.bond.update({ where: { id: b.id }, data: req.body })), 'Bond updated');
  }));

// Step 1: send OTP to the candidate's email
r.post('/:id/send-otp', authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const b = await prisma.bond.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!b || b.userId !== uid(req)) throw new ApiError(404, 'Bond not found');
  if (b.status === 'SIGNED') throw new ApiError(409, 'Bond already signed');
  const otp = String(crypto.randomInt(100000, 1000000));
  await prisma.bond.update({ where: { id: b.id }, data: { otpHash: sha256(`${b.id}:${otp}`), otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  await sendMail(b.user.email, 'Bond e-sign OTP', `Your OTP to sign the training bond is ${otp}. It is valid for 10 minutes.`);
  ok(res, null, 'OTP sent to your email');
}));

// Step 2: sign with OTP
r.post('/:id/sign', authorize('CANDIDATE'), validate(z.object({ otp: z.string().length(6) })),
  asyncHandler(async (req, res) => {
    const b = await prisma.bond.findUnique({ where: { id: req.params.id } });
    if (!b || b.userId !== uid(req)) throw new ApiError(404, 'Bond not found');
    if (b.status === 'SIGNED') throw new ApiError(409, 'Bond already signed');
    if (!b.otpHash || !b.otpExpiresAt || b.otpExpiresAt < new Date()) throw new ApiError(400, 'OTP expired. Request a new one');
    if (!safeEqual(b.otpHash, sha256(`${b.id}:${req.body.otp}`))) throw new ApiError(400, 'Invalid OTP');

    const signed = await prisma.bond.update({
      where: { id: b.id },
      data: { status: 'SIGNED', signedAt: new Date(), signedIp: req.ip, otpHash: null, otpExpiresAt: null },
    });
    const a = await prisma.application.findUnique({ where: { id: b.applicationId }, select: { status: true } });
    if (a?.status === 'SELECTED') {
      await moveStatus(b.applicationId, 'BOND_SIGNED');
      // legacy case: fee was already paid before this change -> nothing left to pay, go straight to FEE_PAID
      if (await prisma.payment.count({ where: { applicationId: b.applicationId, status: 'PAID' } }))
        await moveStatus(b.applicationId, 'FEE_PAID');
    }
    ok(res, publicBond(signed), 'Bond signed successfully');
  }));

export default r;
