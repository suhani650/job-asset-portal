import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { jdUpload } from '../middleware/uploadJd.js';
import { ROLES } from '../config/roles.js';
import {
  validateJobId, listJobs, getJob, createJob, updateJob, setJobStatus, uploadJd, removeJd, downloadJd,
} from '../controllers/jobController.js';

const router = Router();
const viewers = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.RECRUITER);
const managers = authorize(ROLES.HR_MANAGER, ROLES.RECRUITER);

router.use(authenticate);
router.param('id', validateJobId);

router.get('/', viewers, listJobs);
router.post('/', managers, createJob);
router.get('/:id', viewers, getJob);
router.patch('/:id', managers, updateJob);
router.patch('/:id/status', managers, setJobStatus);
router.get('/:id/jd', viewers, downloadJd);
router.post('/:id/jd', managers, jdUpload, uploadJd);
router.delete('/:id/jd', managers, removeJd);

export default router;
