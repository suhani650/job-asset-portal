import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyAccess } from '../utils/jwt';
import { ApiError } from '../utils/http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

export const ADMINS: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];
export const STAFF: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.TRAINER];

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return next(new ApiError(401, 'Missing access token'));
  try {
    const p = verifyAccess(h.slice(7));
    req.user = { id: p.sub, role: p.role };
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new ApiError(403, 'Forbidden'));
    next();
  };

export const isAdmin = (req: Request) => !!req.user && ADMINS.includes(req.user.role);
export const isStaff = (req: Request) => !!req.user && STAFF.includes(req.user.role);
