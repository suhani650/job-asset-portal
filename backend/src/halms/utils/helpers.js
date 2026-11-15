import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuditLog } from '../models/index.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user.id), role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

export const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function audit({ actor, action, entity, entityId, meta, req }) {
  try {
    await AuditLog.create({
      actorId: actor?.id,
      actorName: actor?.name,
      actorRole: actor?.role,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      meta,
      ip: req?.ip,
    });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}
