import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { getSettings, changePassword, changeEmail } from '../controllers/settingsController.js';

const router = Router();
router.use(authenticate);

// Guessing the current password is the only abuse here, so keep it tight.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

router.get('/', getSettings);
router.post('/password', limiter, changePassword);
router.post('/email', limiter, changeEmail);

export default router;
