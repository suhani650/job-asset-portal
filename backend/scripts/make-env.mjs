// npm run setup  ->  creates backend/.env from .env.example and fills the 3 secrets with strong random values.
// Safe to run again: it never overwrites anything you already filled in.
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENV = '.env';
if (!fs.existsSync(ENV)) {
  fs.copyFileSync('.env.example', ENV);
  console.log('Created .env from .env.example');
}
let text = fs.readFileSync(ENV, 'utf8');
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'HALMS_JWT_SECRET']) {
  const re = new RegExp(`^${key}=\\s*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${crypto.randomBytes(48).toString('hex')}`);
    console.log(`Generated ${key}`);
  }
}
fs.writeFileSync(ENV, text);

const missing = [];
if (/YOUR_PASSWORD/.test(text)) missing.push('DATABASE_URL  -> replace YOUR_PASSWORD with your PostgreSQL password');
if (/^SUPER_ADMIN_EMAIL=\s*$/m.test(text)) missing.push('SUPER_ADMIN_EMAIL  -> the email you will sign in with');
if (/^SUPER_ADMIN_PASSWORD=\s*$/m.test(text)) missing.push('SUPER_ADMIN_PASSWORD  -> at least 12 characters');
if (missing.length) {
  console.log('\nNow open backend/.env and fill these 3 lines, then save (Ctrl + S):');
  missing.forEach((m) => console.log('  - ' + m));
} else {
  console.log('\n.env is ready. Next:  npm run db:init   then   npm run dev');
}
