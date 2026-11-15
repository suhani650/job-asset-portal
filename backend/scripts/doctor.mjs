// npm run doctor  ->  checks everything the server needs and says in plain words what to fix.
import 'dotenv/config';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

let bad = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const fail = (m, fix) => { bad += 1; console.log(`  FIX   ${m}\n        -> ${fix}`); };

console.log('\nAsset Portal doctor\n');

const major = Number(process.versions.node.split('.')[0]);
major >= 18 ? ok(`Node.js ${process.versions.node}`) : fail(`Node.js ${process.versions.node} is too old`, 'install the LTS version from nodejs.org');

fs.existsSync('.env') ? ok('.env file found') : fail('.env file is missing', 'run:  npm run setup');

const need = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'HALMS_JWT_SECRET', 'SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_PASSWORD'];
for (const k of need) {
  if (!process.env[k]) fail(`${k} is empty`, 'open backend/.env, fill it and save (Ctrl + S). Secrets: run  npm run setup');
}
if ((process.env.HALMS_JWT_SECRET || '').length && process.env.HALMS_JWT_SECRET.length < 32) fail('HALMS_JWT_SECRET is shorter than 32 characters', 'run  npm run setup  after clearing that line');
if ((process.env.SUPER_ADMIN_PASSWORD || '').length && process.env.SUPER_ADMIN_PASSWORD.length < 12) fail('SUPER_ADMIN_PASSWORD is shorter than 12 characters', 'choose a longer password');
if (/YOUR_PASSWORD/.test(process.env.DATABASE_URL || '')) fail('DATABASE_URL still has YOUR_PASSWORD', 'put your real MySQL password there');

if (process.env.DATABASE_URL && !/DB_PASSWORD/.test(process.env.DATABASE_URL)) {
  let conn;
  try {
    conn = await mysql.createConnection({ uri: process.env.DATABASE_URL.split('?')[0], connectTimeout: 5000 });
    ok('connected to MySQL');
    const [rows] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
    const names = rows.map((r) => r.t);
    names.includes('User') ? ok('candidate-side tables exist') : fail('candidate-side tables are missing', 'run:  npm run prisma:deploy');
    names.includes('users') ? ok('client-side tables exist') : console.log('  NOTE  client-side tables are created automatically the first time the server starts');
  } catch (e) {
    const m = String(e.message);
    if (/Access denied/i.test(m)) fail('MySQL rejected the user/password', 'fix user and password inside DATABASE_URL (encode @ as %40)');
    else if (/Unknown database/i.test(m)) fail('the database does not exist', 'create it in hPanel -> Databases, or fix the name in DATABASE_URL');
    else if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) fail('cannot reach MySQL', 'host should be localhost on Hostinger; check the port');
    else fail(`database error: ${m}`, 'check DATABASE_URL');
  } finally {
    await conn?.end().catch(() => {});
  }
}

console.log(bad ? `\n${bad} thing(s) to fix. Fix them and run  npm run doctor  again.\n` : '\nAll good. Run:  npm run dev\n');
process.exit(bad ? 1 : 0);
