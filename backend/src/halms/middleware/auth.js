import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { UserSecurity } from '../models/userSecurity.js';
import { asyncHandler } from './errors.js';
import { ROLES } from '../config/roles.js';

export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ message: 'Session expired. Please sign in again.' });
  }

  const user = await User.findByPk(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ message: 'Account not available.' });
  }
  // a token issued before the last password change is no longer valid
  const sec = await UserSecurity.findByPk(user.id);
  if (sec && payload.iat < Math.floor(new Date(sec.passwordChangedAt).getTime() / 1000)) {
    return res.status(401).json({ message: 'Your password was changed. Please sign in again.' });
  }
  req.user = user;
  return next();
});

export const authorize = (...roles) => (req, res, next) => {
  // the Owner can do everything an HR Manager can do
  const effective = req.user.role === ROLES.OWNER ? [ROLES.OWNER, ROLES.HR_MANAGER] : [req.user.role];
  return roles.some((r) => effective.includes(r))
    ? next()
    : res.status(403).json({ message: 'You do not have permission to perform this action.' });
};
