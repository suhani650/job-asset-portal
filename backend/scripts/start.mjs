// npm start  ->  applies database migrations (safe to repeat), then starts the server.
// Works on Hostinger Node.js hosting, a VPS, or locally.
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const run = (cmd, args) => spawnSync(process.execPath, [require.resolve(cmd), ...args], { stdio: 'inherit' });

const prismaCli = 'prisma/build/index.js';
if (process.env.SKIP_MIGRATE !== 'true') {
  console.log('> prisma migrate deploy');
  const m = run(prismaCli, ['migrate', 'deploy']);
  if (m.status !== 0) { console.error('Migration failed - check DATABASE_URL and that the database is empty or already migrated.'); process.exit(1); }
}
const tsx = require.resolve('tsx/cli');
// First run: create the Super Admin + starter data. Both seeds are safe to repeat (they skip what already exists).
if (process.env.SKIP_SEED !== 'true') {
  for (const f of ['prisma/seed.ts', 'src/halms/seed.js']) {
    console.log('> seed ' + f);
    const r = spawnSync(process.execPath, [tsx, f], { stdio: 'inherit' });
    if (r.status !== 0) console.error('Seed step failed (' + f + ') - continuing; check the log above.');
  }
}
const child = spawn(process.execPath, [tsx, 'src/server.ts'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
