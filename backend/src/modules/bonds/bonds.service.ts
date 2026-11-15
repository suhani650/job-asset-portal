import { prisma } from '../../config/db';
import { env } from '../../config/env';

export const DEFAULT_BOND_TERMS =
  'The candidate agrees to complete the full training programme and to serve the placement partner / company ' +
  'for the bond period stated above. Early exit may require repayment of the bond amount as per company policy.';

/** Creates the bond once, when a candidate is SELECTED (bond is signed first, fee is paid after). Idempotent. */
export async function ensureBond(applicationId: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { track: true } });
  if (!app) return null;
  return prisma.bond.upsert({
    where: { applicationId },
    update: {},
    create: { applicationId, userId: app.userId, months: env.BOND_MONTHS, amount: app.track.fee, terms: DEFAULT_BOND_TERMS },
  });
}
