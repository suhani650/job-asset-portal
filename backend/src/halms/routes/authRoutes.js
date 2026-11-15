import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, me } from '../controllers/authController.js';
import { forgotPassword, resetPassword } from '../controllers/passwordResetController.js';
import { registrationUpload } from '../middleware/upload.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

// asking for a code: 6 per 15 minutes per address; typing a code: 20 per 15 minutes (the code itself also locks after 5 wrong tries)
const forgotLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many requests. Please try again in a few minutes.' } });
const resetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Please try again in a few minutes.' } });

router.post('/login', limiter, login);
router.post('/forgot-password', forgotLimit, forgotPassword);
router.post('/reset-password', resetLimit, resetPassword);
router.post('/register', limiter, registrationUpload, register);
router.get('/me', authenticate, me);

export default router;
