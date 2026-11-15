import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, ok, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isStaff } from '../../middleware/auth';
import { moveStatus } from '../applications/applications.service';

const r = Router();
r.use(authenticate);

// ---- Clients (hiring companies) ----
const clientBody = z.object({ name: z.string().min(2), contactName: z.string().optional(), contactEmail: z.string().email().optional(), contactPhone: z.string().optional() });
r.post('/clients', authorize(...ADMINS), validate(clientBody), asyncHandler(async (req, res) => ok(res, await prisma.client.create({ data: req.body }), 'Client created', 201)));
r.get('/clients', authorize(...ADMINS), asyncHandler(async (_req, res) => ok(res, await prisma.client.findMany({ orderBy: { name: 'asc' } }))));
r.patch('/clients/:id', authorize(...ADMINS), validate(clientBody.partial()), asyncHandler(async (req, res) => ok(res, await prisma.client.update({ where: { id: req.params.id }, data: req.body }), 'Client updated')));

// ---- Requirements (open positions at a client) ----
const reqBody = z.object({
  clientId: z.string(), title: z.string().min(2), description: z.string().optional(),
  skills: z.array(z.string()).default([]), positions: z.number().int().min(1).default(1),
  deadline: z.coerce.date().optional(),
});
r.post('/requirements', authorize(...ADMINS), validate(reqBody),
  asyncHandler(async (req, res) => ok(res, await prisma.requirement.create({ data: req.body }), 'Requirement created', 201)));
r.get('/requirements', authorize(...ADMINS), asyncHandler(async (req, res) => {
  const { clientId, active } = req.query as Record<string, string | undefined>;
  ok(res, await prisma.requirement.findMany({
    where: { ...(clientId ? { clientId } : {}), ...(active === 'true' ? { isActive: true } : {}) },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }));
}));
r.patch('/requirements/:id', authorize(...ADMINS), validate(reqBody.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => ok(res, await prisma.requirement.update({ where: { id: req.params.id }, data: req.body }), 'Requirement updated')));

// ---- Ready candidates (progress >= 80%) ----
r.get('/ready', authorize(...ADMINS), asyncHandler(async (_req, res) => {
  ok(res, await prisma.application.findMany({
    where: { status: 'READY_FOR_PLACEMENT' },
    include: { user: { select: { id: true, name: true, email: true, phone: true } }, track: { select: { name: true } }, progress: true },
  }));
}));

// ---- Match candidate with client (creates an OFFER) ----
r.post('/', authorize(...ADMINS),
  validate(z.object({ applicationId: z.string(), clientId: z.string(), roleTitle: z.string().min(2), packageLpa: z.number().positive().optional(), requirementId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const app = await prisma.application.findUnique({ where: { id: req.body.applicationId } });
    if (!app) throw new ApiError(404, 'Application not found');
    if (app.status !== 'READY_FOR_PLACEMENT') throw new ApiError(409, 'Candidate is not ready for placement');
    ok(res, await prisma.placement.create({ data: { ...req.body, userId: app.userId } }), 'Candidate matched', 201);
  }));

// ---- Confirm joining -> PLACED ----
r.patch('/:id/confirm', authorize(...ADMINS), asyncHandler(async (req, res) => {
  const p = await prisma.placement.findUnique({ where: { id: req.params.id } });
  if (!p) throw new ApiError(404, 'Placement not found');
  await moveStatus(p.applicationId, 'PLACED');
  const placed = await prisma.placement.update({ where: { id: p.id }, data: { status: 'PLACED', placedAt: new Date() } });
  if (p.requirementId) {
    const rq = await prisma.requirement.update({ where: { id: p.requirementId }, data: { filled: { increment: 1 } } });
    if (rq.filled >= rq.positions) await prisma.requirement.update({ where: { id: rq.id }, data: { isActive: false } });
  }
  ok(res, placed, 'Candidate placed');
}));

r.get('/', asyncHandler(async (req, res) => {
  ok(res, await prisma.placement.findMany({
    where: isStaff(req) ? {} : { userId: uid(req) },
    include: { client: true, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' },
  }));
}));

export default r;
