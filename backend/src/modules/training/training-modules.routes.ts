import { Router } from 'express';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, uid } from '../../utils/http';
import { authenticate, isAdmin, isStaff } from '../../middleware/auth';

const r = Router();
r.use(authenticate);

const TYPES = ['VIDEO', 'PDF', 'LINK', 'NOTES'];

function staffOnly(req: Parameters<typeof isStaff>[0]) {
  if (!isStaff(req)) throw new ApiError(403, 'Staff only');
}

// Candidate: sirf apne track ke active modules (training me hone par)
r.get('/mine', asyncHandler(async (req, res) => {
  const apps = await prisma.application.findMany({
  where: { userId: uid(req), status: { in: ['FEE_PAID', 'IN_TRAINING', 'READY_FOR_PLACEMENT', 'PLACED'] } },
    select: { trackId: true },
  });
  const data = await prisma.trainingModule.findMany({
    where: { trackId: { in: apps.map((a) => a.trackId) }, isActive: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ data });
}));

// Staff: list
r.get('/', asyncHandler(async (req, res) => {
  staffOnly(req);
  const where: any = {};
  if (req.query.trackId) where.trackId = String(req.query.trackId);
  const data = await prisma.trainingModule.findMany({ where, orderBy: [{ position: 'asc' }] });
  res.json({ data });
}));

// Staff: create
r.post('/', asyncHandler(async (req, res) => {
  staffOnly(req);
  const { trackId, title, description, type, url, position } = req.body || {};
  if (!trackId || !title) throw new ApiError(400, 'trackId and title are required');
  if (type && !TYPES.includes(type)) throw new ApiError(400, 'Invalid type');
  const data = await prisma.trainingModule.create({
    data: { trackId, title, description, type: type || 'LINK', url, position: Number(position) || 0 },
  });
  res.status(201).json({ data });
}));

// Staff: update
r.patch('/:id', asyncHandler(async (req, res) => {
  staffOnly(req);
  const { title, description, type, url, position, isActive } = req.body || {};
  if (type && !TYPES.includes(type)) throw new ApiError(400, 'Invalid type');
  const data = await prisma.trainingModule.update({
    where: { id: String(req.params.id) },
    data: { title, description, type, url, position, isActive },
  });
  res.json({ data });
}));

// Admin: delete
r.delete('/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req)) throw new ApiError(403, 'Admin only');
  await prisma.trainingModule.delete({ where: { id: String(req.params.id) } });
  res.json({ data: { ok: true } });
}));

export default r;