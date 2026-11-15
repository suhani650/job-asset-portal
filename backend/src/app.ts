import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { env, isProd } from './config/env';
import { errorHandler, notFound } from './middleware/error';

import auth from './modules/auth/auth.routes';
import users from './modules/users/users.routes';
import applicants from './modules/applicants/applicants.routes';
import tracks from './modules/tracks/tracks.routes';
import applications from './modules/applications/applications.routes';
import policies from './modules/policies/policies.routes';
import tests from './modules/tests/tests.routes';
import interviews from './modules/interviews/interviews.routes';
import payments from './modules/payments/payments.routes';
import bonds from './modules/bonds/bonds.routes';
import training from './modules/training/training.routes';
import assignments from './modules/assignments/assignments.routes';
import progress from './modules/progress/progress.routes';
import placement from './modules/placement/placement.routes';
import dashboard from './modules/dashboard/dashboard.routes';
import notifications from './modules/notifications/notifications.routes';
import trainingModulesRoutes from './modules/training/training-modules.routes';
import documentsRoutes from './modules/documents/documents.routes';

export const app = express();

app.set('trust proxy', 1); // correct client IPs behind nginx / a load balancer (needed for rate limiting)
app.disable('x-powered-by');
app.use(helmet());
app.use(compression()); // gzip responses: smaller payloads, faster for mobile networks
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  credentials: true,
}));
app.use(morgan(isProd ? 'tiny' : 'dev'));

const limit = (windowMs: number, max: number) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests, please try again later' } });
// keep the raw body: needed to verify the Razorpay webhook signature
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get('/health', (_req, res) => res.json({ success: true, message: 'ok' }));

const api = express.Router();
// brute-force protection only on credential endpoints (created ONCE, not per request)
api.use(['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'], limit(15 * 60 * 1000, 20));
// general limiter; the Razorpay webhook is skipped so retries are never blocked
const general = limit(15 * 60 * 1000, 600);
api.use((req, res, next) => (req.path === '/payments/webhook' ? next() : general(req, res, next)));
api.use('/auth', auth);
api.use('/users', users);
api.use('/applicants', applicants);
api.use('/tracks', tracks);
api.use('/applications', applications);
api.use('/tests', tests);
api.use('/interviews', interviews);
api.use('/payments', payments);
api.use('/bonds', bonds);
api.use('/training/modules', trainingModulesRoutes);
api.use('/documents', documentsRoutes);
api.use('/training', training);
api.use('/assignments', assignments);
api.use('/progress', progress);
api.use('/placement', placement);
api.use('/dashboard', dashboard);
api.use('/notifications', notifications);
api.use('/policies', policies);
app.use('/api/v1', api);

// HALMS (client / HR) API lives under /api/* (everything except /api/v1). It is attached
// from server.ts after its database is ready; the slot keeps it ahead of the 404 handler.
const halmsSlot = express.Router();
app.use('/api', halmsSlot);
export const attachHalms = (sub: express.Express) => halmsSlot.use(sub);

app.get('/', (_req, res) => res.json({ status: 'ok' }));

app.use(notFound);
app.use(errorHandler);
