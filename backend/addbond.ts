import { prisma } from './src/config/db';

const SIGNED = false; // true karo to "signed" wala view dikhega

async function main() {
  const app = await prisma.application.findFirst({ where: { status: 'IN_TRAINING' }, include: { track: true } });
  if (!app) throw new Error('Koi IN_TRAINING application nahi mili');

  const data = {
    userId: app.userId,
    months: 12,
    amount: app.track.fee || 50000,
    terms: '1. Candidate 12 mahine tak company ke saath kaam karega.\n2. Beech me chhodne par bond amount dena hoga.\n3. Training poori karna zaroori hai.',
    status: SIGNED ? ('SIGNED' as const) : ('PENDING' as const),
    signedAt: SIGNED ? new Date() : null,
  };
  const b = await prisma.bond.upsert({ where: { applicationId: app.id }, update: data, create: { applicationId: app.id, ...data } });
  console.log('Bond ready:', b.id, b.status);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());