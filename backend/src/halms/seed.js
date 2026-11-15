import bcrypt from 'bcryptjs';
import './config/env.js';
import { connectDb, sequelize } from './config/db.js';
import { User } from './models/index.js';
import { ROLES } from './config/roles.js';

// One admin account for both portals: SUPER_ADMIN_* is used, SEED_ADMIN_* is the fallback.
const name = process.env.SUPER_ADMIN_NAME || 'Super Admin';
const email = process.env.SUPER_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  console.error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in backend/.env first.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

await connectDb();
// any Super Admin counts: the email may have been changed later in Settings
const existing = await User.findOne({ where: { role: ROLES.SUPER_ADMIN } });
if (existing) {
  console.log(`Super Admin already exists (${existing.email}). Nothing changed.`);
} else {
  await User.create({
    name, email, role: ROLES.SUPER_ADMIN,
    passwordHash: await bcrypt.hash(password, 12),
  });
  console.log(`Super Admin created: ${email}`);
}
await sequelize.close();
