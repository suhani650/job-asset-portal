import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validateNotificationId, listNotifications, markRead, markAllRead } from '../controllers/notificationController.js';

const router = Router();
router.use(authenticate);
router.param('id', validateNotificationId);

router.get('/', listNotifications);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);

export default router;
