import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { avatarUpload } from '../middleware/uploadAvatar.js';
import {
  getProfile, requestEdit, updateProfile, uploadPhoto, removePhoto, getPhoto,
} from '../controllers/profileController.js';

const router = Router();
router.use(authenticate);

router.get('/', getProfile);
router.patch('/', updateProfile);
router.post('/edit-requests', requestEdit);
router.get('/photo', getPhoto);
router.post('/photo', avatarUpload, uploadPhoto);
router.delete('/photo', removePhoto);

export default router;
