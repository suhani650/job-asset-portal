import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import { chat, chatLimiter, status } from '../controllers/assistantController.js';

const router = Router();
// The assistant is for company users (not the Super Admin).
router.use(authenticate, authorize(ROLES.HR_MANAGER, ROLES.RECRUITER, ROLES.TRAINER, ROLES.EMPLOYEE));
router.get('/status', status);
router.post('/chat', chatLimiter, chat);

export default router;
