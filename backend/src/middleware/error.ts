import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/http';
import { isProd } from '../config/env';

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, 'Route not found'));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ success: false, message: err.message, errors: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Already exists' });
    if (err.code === 'P2025') return res.status(404).json({ success: false, message: 'Record not found' });
    if (err.code === 'P2003') return res.status(400).json({ success: false, message: 'Invalid reference' });
  }
  console.error(err);
  res.status(500).json({
    success: false,
    message: isProd ? 'Internal server error' : String((err as Error)?.message || err),
  });
}
