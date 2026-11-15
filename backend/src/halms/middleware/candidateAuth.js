import jwt from 'jsonwebtoken';
import { sequelize } from '../config/db.js';
import { asyncHandler, HttpError } from './errors.js';

/**
 * Lets a signed-in CANDIDATE (Candidate portal login) use the careers endpoints.
 * The candidate's token is signed by the Candidate portal with JWT_ACCESS_SECRET, so we verify it with the same secret,
 * then read the candidate's profile from the Candidate portal tables of the same database.
 */
export const authenticateCandidate = asyncHandler(async (req, _res, next) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new HttpError(503, 'Candidate sign-in is not configured on the server.');
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null;
  if (!token) throw new HttpError(401, 'Please sign in as a candidate.');
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    throw new HttpError(401, 'Please sign in again as a candidate.');
  }
  if (payload.role !== 'CANDIDATE') throw new HttpError(403, 'Only candidates can do this.');

  let rows;
  try {
    [rows] = await sequelize.query(
      `SELECT u.id, u.name, u.email, u.phone, u.isActive, u.applicantStatus, u.resumePath, u.resumeName,
              p.city, p.state, p.qualification, p.college, p.skills, p.expYears, p.currentCompany, p.expectedSalary, p.linkedin
         FROM \`User\` u LEFT JOIN \`CandidateProfile\` p ON p.userId = u.id
        WHERE u.id = :id AND u.role = 'CANDIDATE' LIMIT 1`,
      { replacements: { id: String(payload.sub) } }
    );
  } catch (e) {
    console.error('candidate lookup failed:', e.message);
    throw new HttpError(503, 'Candidate data is not available. Run  npm run db:init  in the backend.');
  }
  const c = rows?.[0];
  if (!c || !c.isActive) throw new HttpError(401, 'Candidate account not found.');
  req.candidate = c;
  next();
});
