import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import {
  validateCandidateId, searchCandidates, getCandidate, shortlist, removeShortlist, downloadResume,
} from '../controllers/candidateController.js';

const router = Router();

// HR Manager and Recruiter search their own view of the talent pool.
router.use(authenticate, authorize(ROLES.HR_MANAGER, ROLES.RECRUITER));
router.param('id', validateCandidateId);

router.get('/', searchCandidates);
router.get('/:id', getCandidate);
router.post('/:id/shortlist', shortlist);
router.delete('/:id/shortlist', removeShortlist);
router.get('/:id/resume', downloadResume);

export default router;