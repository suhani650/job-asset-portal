import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import { validateApplicantId, listApplicants, getApplicant, setStage, addNote, downloadResume } from '../controllers/applicantsController.js';

const router = Router();
router.use(authenticate, authorize(ROLES.HR_MANAGER, ROLES.RECRUITER));
router.param('id', validateApplicantId);

router.get('/', listApplicants);
router.get('/:id', getApplicant);
router.patch('/:id/stage', setStage);
router.post('/:id/notes', addNote);
router.get('/:id/resume', downloadResume);

export default router;
