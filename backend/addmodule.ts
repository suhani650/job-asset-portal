import { prisma } from './src/config/db';

async function main() {
  const app = await prisma.application.findFirst({ where: { status: 'IN_TRAINING' } });
  if (!app) throw new Error('Koi IN_TRAINING application nahi mili');

  const m = await prisma.trainingModule.create({
    data: {
      trackId: app.trackId,
      title: 'Test Module',
      description: 'Pehla test module',
      type: 'LINK',
      url: 'https://www.google.com',
      position: 0,
    },
  });
  console.log('Module bana:', m.id, 'track:', m.trackId);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());