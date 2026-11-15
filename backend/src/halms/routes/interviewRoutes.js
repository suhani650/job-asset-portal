import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import {
  validateInterviewId, listInterviews, scheduleInterview, rescheduleInterview, cancelInterview,
  setInterviewStatus, verifyInterview, verifyInterviewManually,
} from '../controllers/interviewController.js';

const router = Router();
router.use(authenticate, authorize(ROLES.HR_MANAGER, ROLES.RECRUITER)); // the Owner passes wherever the HR Manager does
router.param('id', validateInterviewId);

// typing codes: 60 tries a minute per person, and every interview also locks after 5 wrong codes
const verifyLimit = rateLimit({
  windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, validate: false,
  keyGenerator: (req) => String(req.user?.id || 'anon'), message: { message: 'Too many tries. Please wait a minute.' },
});

router.get('/', listInterviews);
router.post('/', scheduleInterview);
router.post('/verify', verifyLimit, verifyInterview);
router.patch('/:id', rescheduleInterview);
router.post('/:id/cancel', cancelInterview);
router.post('/:id/status', setInterviewStatus);
router.post('/:id/verify-manual', verifyLimit, verifyInterviewManually);

export default router;
