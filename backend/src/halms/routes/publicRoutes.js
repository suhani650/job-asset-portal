import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { publicList, publicOne } from '../controllers/jobController.js';
import { registerCandidate } from '../controllers/candidateController.js';
import { resumeUpload } from '../middleware/uploadResume.js';

// No login needed. Used by the Candidate portal.
const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

router.get('/jobs', publicList);
router.get('/jobs/:id', publicOne);
router.post('/candidates', limiter, resumeUpload, registerCandidate);

export default router;