import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import {
  validateMemberId, listTeam, createMember, updateMember, setMemberStatus, resetMemberPassword,
} from '../controllers/teamController.js';

const router = Router();

// Only the company's HR Manager manages the team.
router.use(authenticate, authorize(ROLES.HR_MANAGER));
router.param('id', validateMemberId);

router.get('/', listTeam);
router.post('/', createMember);
router.patch('/:id', updateMember);
router.patch('/:id/status', setMemberStatus);
router.post('/:id/password', resetMemberPassword);

export default router;