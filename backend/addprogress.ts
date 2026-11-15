import { prisma } from './src/config/db';

async function main() {
  const app = await prisma.application.findFirst({ where: { status: 'IN_TRAINING' } });
  if (!app) throw new Error('Koi IN_TRAINING application nahi mili');

  const data = {
    userId: app.userId,
    attendancePct: 70,
    assignmentPct: 60,
    testPct: 80,
    trainerRating: 75,
    overallPct: 70,
  };
  const p = await prisma.progress.upsert({
    where: { applicationId: app.id },
    update: data,
    create: { applicationId: app.id, ...data },
  });
  console.log('Progress ready:', p.id, 'overall:', p.overallPct);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());