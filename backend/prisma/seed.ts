import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Same admin as the client portal: SUPER_ADMIN_* first, SEED_ADMIN_* as fallback.
  const email = (process.env.SUPER_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  // the email may have been changed later in Settings, so any existing Super Admin means "already seeded"
  const already = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!already) await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: process.env.SUPER_ADMIN_NAME || 'Super Admin', email, role: 'SUPER_ADMIN', applicantStatus: 'APPROVED', passwordHash: await bcrypt.hash(adminPassword, 10) },
  });

  const tracks = [
    { name: 'Full Stack Development', description: 'MERN / Next.js with Node.js', durationWeeks: 16, fee: 25000 },
    { name: 'Data Analytics', description: 'SQL, Python, Power BI', durationWeeks: 12, fee: 20000 },
    { name: 'Java Backend', description: 'Core Java, Spring Boot', durationWeeks: 14, fee: 22000 },
  ];
  for (const t of tracks) {
    const track = await prisma.track.upsert({ where: { name: t.name }, update: {}, create: t });
    if ((await prisma.test.count({ where: { trackId: track.id } })) === 0) {
      await prisma.test.create({
        data: {
          trackId: track.id, title: `${t.name} - Entrance Test`, durationMins: 20, passPercent: 40,
          questions: { create: [
            { text: 'Which HTTP method is idempotent?', options: ['POST', 'PUT', 'PATCH', 'CONNECT'], correctIndex: 1 },
            { text: 'What does SQL stand for?', options: ['Structured Query Language', 'Simple Query Logic', 'Standard Question Language', 'None'], correctIndex: 0 },
            { text: 'Which is NOT a programming paradigm?', options: ['Functional', 'Object-oriented', 'Procedural', 'Photographic'], correctIndex: 3 },
          ] },
        },
      });
    }
  }
  if ((await prisma.policy.count()) === 0) {
    await prisma.policy.create({ data: { title: 'Code of Conduct', content: 'Candidates must attend sessions regularly, submit assignments on time and follow institute rules.' } });
  }
  const first = await prisma.track.findFirst();
  if (first && (await prisma.feePlan.count()) === 0) {
    await prisma.feePlan.createMany({ data: [
      { trackId: first.id, planType: 'ONE_TIME', totalAmount: first.fee, installments: 1, discountPct: 5 },
      { trackId: first.id, planType: 'INSTALLMENTS', totalAmount: first.fee, installments: 3, perInstallment: Math.ceil(first.fee / 3) },
    ] });
  }
  console.log('Seed complete. Super admin:', email);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
