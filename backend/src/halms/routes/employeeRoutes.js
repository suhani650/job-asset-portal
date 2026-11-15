import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/roles.js';
import { validateEmployeeId, listEmployees, createEmployee, updateEmployee } from '../controllers/employeeController.js';

const router = Router();
router.use(authenticate, authorize(ROLES.HR_MANAGER)); // HR Manager and Owner
router.param('id', validateEmployeeId);

router.get('/', listEmployees);
router.post('/', createEmployee);
router.patch('/:id', updateEmployee);

export default router;
