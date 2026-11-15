import { Sequelize } from 'sequelize';
import { env } from './env.js';

// MySQL / MariaDB (Hostinger). The password may contain symbols such as @ - write them URL-encoded in DATABASE_URL (@ -> %40).
export const sequelize = new Sequelize(env.databaseUrl, {
  dialect: 'mysql',
  logging: false,
  dialectOptions: {
    charset: 'utf8mb4',
    dateStrings: false,
    ...(env.databaseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  },
  define: { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
});

export async function connectDb() {
  await sequelize.authenticate();
  // Creates missing tables on start (safe to repeat: existing tables are not touched).
  await import('../models/index.js');
  await sequelize.sync();
  await ensureIndexes();
  console.log('MySQL connected');
}

// Extra indexes for the questions the app asks most often (team list, activity feed, my applications, walk-in sync).
// Each one is created only if it does not exist yet, so this is safe on every start.
const INDEXES = [
  ['users', 'users_registration_id_idx', 'registrationId'],
  ['audit_logs', 'audit_logs_actor_at_idx', 'actorId, `at`'],
  ['jobs', 'jobs_org_status_idx', 'orgId, status'],
  ['job_applications', 'job_applications_candidate_idx', 'candidateUserId'],
  ['walkin_bookings', 'walkin_bookings_application_idx', 'applicationId'],
];

async function ensureIndexes() {
  for (const [table, name, cols] of INDEXES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const [tbl] = await sequelize.query('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t LIMIT 1', { replacements: { t: table } });
      if (!tbl.length) continue; // table is created later, the index is added on the next start
      // eslint-disable-next-line no-await-in-loop
      const [rows] = await sequelize.query(
        'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :i LIMIT 1',
        { replacements: { t: table, i: name } }
      );
      if (!rows.length) await sequelize.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${cols})`); // eslint-disable-line no-await-in-loop
    } catch (e) {
      console.error('Index skipped:', e.message);
    }
  }
}
