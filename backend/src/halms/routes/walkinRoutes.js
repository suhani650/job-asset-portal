import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { authenticateCandidate } from '../middleware/candidateAuth.js';
import { ROLES } from '../config/roles.js';
import {
  validateUuid, getJobDrive, saveJobDrive, removeJobDrive, listDrives, driveBookings, checkIn, markBooking,
  publicDriveList, publicJobDrive, myPasses, bookSlot, cancelBooking,
} from '../controllers/walkinController.js';

const router = Router();
router.param('id', validateUuid);
router.param('jobId', validateUuid);

const bookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

/* No login: the Candidate portal and the public job list use these */
router.get('/public/list', publicDriveList);
router.get('/public/jobs/:jobId', publicJobDrive);

/* Signed-in candidate (Candidate portal token) */
router.get('/candidate/passes', authenticateCandidate, myPasses);
router.post('/candidate/jobs/:jobId/book', bookLimiter, authenticateCandidate, bookSlot);
router.post('/candidate/bookings/:id/cancel', authenticateCandidate, cancelBooking);

/* HR Manager and Recruiter of the company that owns the drive */
const staff = [authenticate, authorize(ROLES.HR_MANAGER, ROLES.RECRUITER)];
router.get('/drives', ...staff, listDrives);
router.get('/drives/:id/bookings', ...staff, driveBookings);
router.get('/jobs/:jobId', ...staff, getJobDrive);
router.put('/jobs/:jobId', ...staff, saveJobDrive);
router.delete('/jobs/:jobId', ...staff, removeJobDrive);
router.post('/check-in', ...staff, checkIn);
router.post('/bookings/:id/mark', ...staff, markBooking);

export default router;
