import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler, ok } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isAdmin } from '../../middleware/auth';

const r = Router();
const body = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  durationWeeks: z.number().int().positive().optional(),
  fee: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// Public: list active tracks (admins see all)
r.get('/', asyncHandler(async (req, res) => {
  let all = false;
  if (req.headers.authorization) {
    try { authenticate(req, res, () => { all = isAdmin(req); }); } catch { /* ignore */ }
  }
  ok(res, await prisma.track.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: 'asc' } }));
}));

r.get('/:id', asyncHandler(async (req, res) => {
  ok(res, await prisma.track.findUniqueOrThrow({ where: { id: req.params.id } }));
}));

r.post('/', authenticate, authorize(...ADMINS), validate(body), asyncHandler(async (req, res) => {
  ok(res, await prisma.track.create({ data: req.body }), 'Track created', 201);
}));

r.patch('/:id', authenticate, authorize(...ADMINS), validate(body.partial()), asyncHandler(async (req, res) => {
  ok(res, await prisma.track.update({ where: { id: req.params.id }, data: req.body }), 'Track updated');
}));

r.delete('/:id', authenticate, authorize(...ADMINS), asyncHandler(async (req, res) => {
  // soft delete: keep history of applications
  await prisma.track.update({ where: { id: req.params.id }, data: { isActive: false } });
  ok(res, null, 'Track deactivated');
}));

export default r;
