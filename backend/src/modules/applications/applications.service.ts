import { ApplicationStatus } from '@prisma/client';
import { prisma } from '../../config/db';
import { ApiError } from '../../utils/http';
import { notify } from '../../services/notify';
import { ensureBond } from '../bonds/bonds.service';

/**
 * The only allowed forward moves. REJECTED is allowed from any non-final state.
 * Resume shortlisting now happens on the applicant (User.applicantStatus) before login,
 * so SHORTLISTED is optional here: an interview can be scheduled right after the test.
 * Order after selection: bond is signed FIRST, then the fee is paid.
 */
export const FLOW: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ['TEST_COMPLETED'],
  TEST_COMPLETED: ['SHORTLISTED', 'INTERVIEW_SCHEDULED'],
  SHORTLISTED: ['INTERVIEW_SCHEDULED'],
  INTERVIEW_SCHEDULED: ['INTERVIEWED'],
  INTERVIEWED: ['SELECTED'],
  SELECTED: ['BOND_SIGNED'],
  BOND_SIGNED: ['FEE_PAID'],
  FEE_PAID: ['IN_TRAINING'],
  IN_TRAINING: ['READY_FOR_PLACEMENT'],
  READY_FOR_PLACEMENT: ['PLACED'],
  PLACED: [],
  REJECTED: [],
};

export async function moveStatus(id: string, to: ApplicationStatus, remarks?: string) {
  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, 'Application not found');
  const final = app.status === 'PLACED' || app.status === 'REJECTED';
  const allowed = to === 'REJECTED' ? !final : FLOW[app.status].includes(to);
  if (!allowed) throw new ApiError(409, `Cannot move application from ${app.status} to ${to}`);
  const updated = await prisma.application.update({
    where: { id },
    data: { status: to, ...(remarks ? { remarks } : {}) },
  });
  if (to === 'SELECTED') await ensureBond(id); // bond is generated on selection; candidate signs it, then pays the fee
  await notify(app.userId, 'Application update', `Your application status is now: ${to.replace(/_/g, ' ')}.`);
  return updated;
}
