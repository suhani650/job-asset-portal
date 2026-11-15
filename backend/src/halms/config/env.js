import 'dotenv/config';

// HALMS runs inside the same server as the asset API and shares its MySQL database
// (its tables are lowercase: users, registrations, jobs ... so they never clash with Prisma's).
const rawDb = process.env.HALMS_DATABASE_URL || process.env.DATABASE_URL;
for (const [key, val] of [['DATABASE_URL', rawDb], ['HALMS_JWT_SECRET', process.env.HALMS_JWT_SECRET]]) {
  if (!val) {
    console.error(`Missing environment variable: ${key}. Check your .env file.`);
    process.exit(1);
  }
}
if (process.env.HALMS_JWT_SECRET.length < 32) {
  console.error('HALMS_JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

export const env = {
  isProd: process.env.NODE_ENV === 'production',
  databaseUrl: rawDb.split('?')[0], // drop Prisma-only params such as ?schema=public
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: process.env.HALMS_JWT_SECRET,
  jwtExpiresIn: process.env.HALMS_JWT_EXPIRES_IN || '8h',
  clientUrl: process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:5173',
};
