import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  validateTicketId, listTickets, getTicket, createTicket, replyTicket, setTicketStatus, ticketCounts,
} from '../controllers/supportController.js';

const router = Router();
router.use(authenticate);
router.param('id', validateTicketId);

router.get('/counts', ticketCounts);
router.get('/tickets', listTickets);
router.post('/tickets', createTicket);
router.get('/tickets/:id', getTicket);
router.post('/tickets/:id/reply', replyTicket);
router.patch('/tickets/:id/status', setTicketStatus);

export default router;
