// npm run reset-admin
// Sets the Super Admin password to SUPER_ADMIN_PASSWORD from backend/.env, in BOTH portals' tables.
// Use it when you forgot the Super Admin password.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD || '';
if (!email || password.length < 12) {
  console.error('First fill SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (12+ characters) in backend/.env and save it.');
  process.exit(1);
}

const conn = await mysql.createConnection({ uri: (process.env.DATABASE_URL || '').split('?')[0] });
const hash = await bcrypt.hash(password, 12);
const [a] = await conn.query('UPDATE `User` SET passwordHash = ? WHERE lower(email) = ?', [hash, email]);
const [b] = await conn.query('UPDATE users SET passwordHash = ? WHERE lower(email) = ?', [hash, email]);
console.log(`Candidate / Admin portal accounts updated: ${a.affectedRows}`);
console.log(`Client portal accounts updated:            ${b.affectedRows}`);
if (!a.affectedRows || !b.affectedRows) {
  console.log('A 0 means no account with that email exists there. Check SUPER_ADMIN_EMAIL, or run:  npm run seed');
} else {
  console.log(`Done. Sign in as Super Admin with ${email} and the new password.`);
}
await conn.end();
