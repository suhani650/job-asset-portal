import { app, attachHalms } from './app';
import { env } from './config/env';
import { prisma } from './config/db';

// Turns the common start-up failures into one clear sentence (the raw error is printed below it).
function explain(err: any): string {
  const code = err?.original?.code || err?.parent?.code || err?.code;
  const msg = String(err?.message || '');
  if (code === 'ER_ACCESS_DENIED_ERROR' || /Access denied|Authentication failed/i.test(msg)) return 'The MySQL user or password in .env (DATABASE_URL) is wrong. Remember to write @ as %40 inside the password.';
  if (code === 'ECONNREFUSED') return 'MySQL is not reachable. On Hostinger the host must be localhost and the port 3306.';
  if (code === 'ER_BAD_DB_ERROR' || /Unknown database/i.test(msg)) return 'The database named in DATABASE_URL does not exist. Create it in hPanel -> Databases, then start again.';
  if (/did not initialize yet|prisma generate/i.test(msg)) return 'The database layer is not prepared yet. In the backend folder run:  npx prisma generate   and then start again. (On a brand new empty database run:  npm run prisma:deploy)';
  if (/Missing environment variable/i.test(msg)) return `${msg} Run  npm run doctor  in the backend folder to see exactly what is missing.`;
  return '';
}

async function main() {
  // HALMS (Sequelize) shares this process and database; it creates its own lowercase tables on start.
  const { halmsApp, connectHalmsDb } = await import('./halms/app.js');
  await connectHalmsDb();
  attachHalms(halmsApp);

  const server = app.listen(env.PORT, () => console.log(`API running on http://localhost:${env.PORT}  (asset: /api/v1, client: /api)`));
  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`\nSTARTUP FAILED: port ${env.PORT} is already used by another program (usually an old backend window).\nClose the old backend window, or run:  taskkill /IM node.exe /F   and start again.\n`);
    } else {
      console.error('\nSTARTUP FAILED:', err?.message || err);
    }
    process.exit(1);
  });
  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  const hint = explain(err);
  console.error(`\nSTARTUP FAILED${hint ? ': ' + hint : ''}\n`);
  console.error('Technical detail:', err?.message || err);
  process.exit(1);
});
