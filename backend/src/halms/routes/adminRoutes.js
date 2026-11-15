import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import {
  listRegistrations, decideRegistration, downloadDocument, resetClientPassword, validateId,
} from '../controllers/adminController.js';
import { listEditRequests, decideEditRequest } from '../controllers/profileController.js';

const router = Router();

router.use(authenticate, authorize(ROLES.SUPER_ADMIN));
router.param('id', validateId);

router.get('/registrations', listRegistrations);
router.get('/registrations/:id/documents/:key', downloadDocument);
router.patch('/registrations/:id', decideRegistration);
router.post('/registrations/:id/password', resetClientPassword);

router.get('/profile-requests', listEditRequests);
router.patch('/profile-requests/:id', decideEditRequest);

export default router;
