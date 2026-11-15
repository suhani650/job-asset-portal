import { Router } from 'express';
import { authenticateCandidate } from '../middleware/candidateAuth.js';
import { validateAppId, myApplications, applyToJob, withdrawApplication } from '../controllers/careersController.js';

// Candidate-facing. The browser sends the Candidate portal login token.
const router = Router();
router.use(authenticateCandidate);
router.param('id', validateAppId);

router.get('/my-applications', myApplications);
router.post('/jobs/:jobId/apply', applyToJob);
router.post('/applications/:id/withdraw', withdrawApplication);

export default router;
