import { prisma } from '../../config/db';
import { ApiError } from '../../utils/http';
import { moveStatus } from '../applications/applications.service';
import { notify } from '../../services/notify';

const round2 = (n: number) => Math.round(n * 100) / 100;
export const CERTIFICATE_THRESHOLD = 80;

/**
 * overall = 25% attendance + 35% assignments + 20% entrance test + 20% trainer rating.
 * At >= 80% a certificate is issued and the candidate becomes READY_FOR_PLACEMENT.
 */
export async function recalcProgress(applicationId: string) {
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw new ApiError(404, 'Application not found');
  const member = await prisma.batchMember.findFirst({ where: { applicationId } });
  if (!member) throw new ApiError(409, 'Candidate is not in any batch');

  const sessions = await prisma.session.findMany({ where: { batchId: member.batchId }, select: { id: true } });
  const present = await prisma.attendance.count({
    where: { userId: app.userId, present: true, sessionId: { in: sessions.map((s) => s.id) } },
  });
  const attendancePct = sessions.length ? (present / sessions.length) * 100 : 0;

  const assignments = await prisma.assignment.findMany({
    where: { batchId: member.batchId },
    include: { submissions: { where: { userId: app.userId } } },
  });
  const maxTotal = assignments.reduce((s, a) => s + a.maxMarks, 0);
  const got = assignments.reduce((s, a) => s + (a.submissions[0]?.marks ?? 0), 0);
  const assignmentPct = maxTotal ? (got / maxTotal) * 100 : 0;

  const attempt = await prisma.testAttempt.findFirst({ where: { applicationId, submittedAt: { not: null } } });
  const testPct = attempt?.percent ?? 0;

  const existing = await prisma.progress.findUnique({ where: { applicationId } });
  const rating = existing?.trainerRating ?? 0;
  const overallPct = round2(0.25 * attendancePct + 0.35 * assignmentPct + 0.2 * testPct + 0.2 * rating);

  const certify = overallPct >= CERTIFICATE_THRESHOLD && !existing?.certificateNo;
  const data = {
    attendancePct: round2(attendancePct), assignmentPct: round2(assignmentPct), testPct: round2(testPct), overallPct,
    ...(certify ? { certificateNo: `CERT-${new Date().getFullYear()}-${applicationId.slice(-6).toUpperCase()}`, certifiedAt: new Date() } : {}),
  };
  const progress = await prisma.progress.upsert({
    where: { applicationId },
    update: data,
    create: { applicationId, userId: app.userId, trainerRating: rating, ...data },
  });

  if (certify && app.status === 'IN_TRAINING') {
    await moveStatus(applicationId, 'READY_FOR_PLACEMENT');
    await notify(app.userId, 'Certificate issued', `Congratulations! You completed training with ${overallPct}%. Certificate: ${progress.certificateNo}`);
  }
  return progress;
}

/** Never let a progress failure break the main request. */
export async function safeRecalc(applicationId: string) {
  try { await recalcProgress(applicationId); } catch (e) { console.error('recalc failed:', (e as Error).message); }
}
