import jwt, { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';

export interface TokenPayload { sub: string; role: Role }

export const signAccess = (id: string, role: Role) =>
  jwt.sign({ sub: id, role }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TTL } as SignOptions);
export const signRefresh = (id: string, role: Role) =>
  jwt.sign({ sub: id, role }, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TTL } as SignOptions);
export const verifyAccess = (t: string) => jwt.verify(t, env.JWT_ACCESS_SECRET) as unknown as TokenPayload;
export const verifyRefresh = (t: string) => jwt.verify(t, env.JWT_REFRESH_SECRET) as unknown as TokenPayload;
