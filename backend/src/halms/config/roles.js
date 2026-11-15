export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  OWNER: 'owner', // the person who registered the company: above the HR Manager
  HR_MANAGER: 'hr_manager',
  TRAINER: 'trainer',
  EMPLOYEE: 'employee',
  RECRUITER: 'recruiter',
};

// The Owner can do everything an HR Manager can do, plus manage the HR Managers.
export const COMPANY_ADMINS = [ROLES.OWNER, ROLES.HR_MANAGER];
