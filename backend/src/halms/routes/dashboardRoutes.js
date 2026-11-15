import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import { clientOverview } from '../controllers/dashboardController.js';

const router = Router();
router.use(authenticate, authorize(ROLES.HR_MANAGER, ROLES.RECRUITER, ROLES.TRAINER, ROLES.EMPLOYEE)); // each role gets its own numbers
router.get('/overview', clientOverview);

export default router;
