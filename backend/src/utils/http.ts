import { Request, Response, NextFunction, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const ok = (res: Response, data: unknown = null, message = 'OK', status = 200, meta?: unknown) =>
  res.status(status).json({ success: true, message, data, ...(meta ? { meta } : {}) });

export function paging(q: Record<string, unknown>) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export const uid = (req: Request): string => {
  if (!req.user) throw new ApiError(401, 'Unauthorized');
  return req.user.id;
};
