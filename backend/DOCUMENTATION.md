# Hiring, Training & Placement Portal — Backend Documentation

**Version 2.0** · Node.js + Express + TypeScript + Prisma + PostgreSQL

One backend that serves both the **web portal** and the **mobile app**. It handles the complete candidate journey:
apply with resume → admin shortlists the resume → candidate logs in → entrance test → interview → selection → bond e-sign → fee payment → training → certificate → placement.

---

## 1. Quick start

```bash
npm install
cp .env.example .env          # fill DATABASE_URL and the JWT secrets
npx prisma migrate dev --name init
npm run seed                  # creates Super Admin, sample tracks, tests, a policy and fee plans
npm run dev                   # http://localhost:4000/health
```

Seed login: `admin@example.com` / `Admin@12345` (change in `.env`: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`).

Useful scripts: `npm run typecheck` · `npm run build` · `npm start` · `npm run prisma:deploy` (production migrations).

> **Note:** This merged project was assembled and statically checked (imports/exports consistent) but could not be
> installed or compiled in the build environment (no network). Run `npm install && npm run typecheck` once after unzipping.

---

## 2. Environment variables

| Variable | Purpose | Default / note |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | **required** |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Token signing keys | **required**, use long random strings |
| `ACCESS_TTL`, `REFRESH_TTL` | Token lifetimes | `15m`, `7d` |
| `PORT` | Server port | `4000` |
| `CORS_ORIGIN` | Allowed browser origins, comma separated | `*` (set real domains in production) |
| `APP_URL` | Frontend URL used in password-reset and shortlist emails | `http://localhost:3000` |
| `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` | Email sending | If `SMTP_HOST` is empty, emails are printed in the console |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Payment gateway | Empty = MOCK mode (development only) |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies Razorpay webhooks | Required for webhook |
| `BOND_MONTHS` | Default bond duration | `12` |
| `UPLOAD_DIR` | Folder where uploaded resumes are stored (not public; served only via login-protected routes) | `uploads` |
| `MAX_RESUME_MB` | Max resume size | `5` |

---

## 3. Project structure

```
prisma/            schema.prisma, seed.ts
src/
  app.ts           middleware, rate limits, route mounting
  server.ts        start + graceful shutdown
  config/          env.ts, db.ts (Prisma client)
  middleware/      auth.ts (JWT + roles), validate.ts (zod), error.ts
  modules/         one folder per feature: *.routes.ts (+ *.service.ts where needed)
  services/        mail.ts (nodemailer), razorpay.ts, notify.ts (in-app + email)
  utils/           http.ts (ApiError, ok, paging), jwt.ts, crypto.ts
```

## 4. Roles

| Role | Can do |
|---|---|
| `CANDIDATE` | Apply, take tests, pay fee, sign bond, attend training, submit assignments, view own progress |
| `TRAINER` | Manage sessions, attendance, assignments, grading, trainer ratings for their batches |
| `ADMIN` | Everything operational: tracks, tests, interviews, selection, payments, batches, placements, policies |
| `SUPER_ADMIN` | Admin + create/modify users and roles |

## 5. Candidate journey

### 5a. Login gate (before anything else)
A person applies through the public form (`POST /auth/register`, multipart with the resume file). The account is created as **`PENDING`** and **no tokens are returned**; login is refused (`403`) until an Admin reviews the resume.

```
PENDING → APPROVED  (Admin shortlists: email "You are shortlisted, login now" is sent, candidate can log in)
PENDING → REJECTED  (no login; polite email)
```
Staff accounts (Admin / Super Admin / Trainer) are never blocked. Existing users were back-filled as `APPROVED` by the migration. The 403 response carries `errors.code` = `APPLICANT_PENDING` or `APPLICANT_REJECTED` so the frontend can show the right message.

### 5b. Application status flow (after login)

```
APPLIED → TEST_COMPLETED → INTERVIEW_SCHEDULED → INTERVIEWED → SELECTED
→ BOND_SIGNED → FEE_PAID → IN_TRAINING → READY_FOR_PLACEMENT → PLACED
```
(`SHORTLISTED` still exists as an optional step between `TEST_COMPLETED` and `INTERVIEW_SCHEDULED`; resume shortlisting now happens in 5a.)
`REJECTED` is possible from any non-final state. Invalid jumps return `409`. Every move sends the candidate a notification (in-app + email).

Key rules:
- **Bond (first):** the bond is generated automatically when the candidate is `SELECTED`. The candidate requests an OTP by email, then signs with it. Signing moves the application to `BOND_SIGNED`.
- **Fee (second):** payable only after the bond is signed. The first successful payment moves the application to `FEE_PAID`. Later installments do not re-trigger the flow.
- **Training:** the admin can add a candidate to a batch only at `FEE_PAID` (bond signed and fee paid).
- **Resume files:** stored in `UPLOAD_DIR`, never served statically. Candidate: `GET/POST /users/me/resume`. Admin: `GET /applicants/:id/resume`. Allowed: PDF, DOC, DOCX up to `MAX_RESUME_MB`; file content is checked, not just the extension.
- **Progress / certificate:** `overall = 25% attendance + 35% assignments + 20% entrance test + 20% trainer rating`. At **80%** a certificate number is issued and the candidate becomes `READY_FOR_PLACEMENT`.
- **Placement:** admin matches a ready candidate to a client (optionally to a requirement); confirming joining moves the candidate to `PLACED` and increments the requirement's `filled` count (auto-closing it when full).

## 6. API conventions

- Base URL: `/api/v1`. Auth header: `Authorization: Bearer <accessToken>`.
- Success: `{ "success": true, "message": "...", "data": ..., "meta": { page, limit, total } }`
- Error: `{ "success": false, "message": "...", "errors": [...] }`
- Status codes: `400` validation, `401` not logged in / bad token, `403` wrong role, `404` not found, `409` conflict / invalid state, `429` rate limited.
- Lists accept `?page=1&limit=20` (max 100).
- Access token is short-lived (15 min). Use `POST /auth/refresh` with the refresh token; refresh tokens are stored hashed and can be revoked (`/auth/logout`).

### Payments quick reference

1. `POST /payments/orders` `{ applicationId, feePlanId?, installmentNo? }` → returns `orderId`, `amount`, `keyId`.
2. Open Razorpay Checkout in the app with that order.
3. `POST /payments/verify` `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }`.
4. As a safety net, configure the Razorpay **webhook** → `POST /api/v1/payments/webhook` (event `payment.captured`). It confirms the payment even if the user closes the app before step 3. Both paths are idempotent.
5. Offline payments: admin uses `POST /payments/manual` (`CASH` / `BANK_TRANSFER`). Revenue totals: `GET /payments/revenue`.

---

## 7. Endpoint reference (100 endpoints)

### Auth

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Public (multipart/form-data: `name`, `email`, `password`, `phone`, `profile` as a JSON string, file `resume`). Returns no tokens; account is `PENDING` |
| `POST` | `/api/v1/auth/login` | Public |
| `POST` | `/api/v1/auth/refresh` | Public |
| `POST` | `/api/v1/auth/logout` | Any logged-in user |
| `POST` | `/api/v1/auth/forgot-password` | Public |
| `POST` | `/api/v1/auth/reset-password` | Public |
| `POST` | `/api/v1/auth/change-password` | Any logged-in user |

### Users

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/users/me` | Any logged-in user |
| `PATCH` | `/api/v1/users/me` | Any logged-in user |
| `GET` | `/api/v1/users/me/resume` | CANDIDATE (download own resume) |
| `POST` | `/api/v1/users/me/resume` | CANDIDATE (replace resume, multipart field `resume`) |

### Applicants (login gate review)
| Method | Path | Access |
|---|---|---|
| `GET` | `/api/v1/applicants?status=PENDING&search=&page=` | Admin / Super Admin |
| `GET` | `/api/v1/applicants/:id` | Admin / Super Admin |
| `GET` | `/api/v1/applicants/:id/resume` | Admin / Super Admin (file download) |
| `PATCH` | `/api/v1/applicants/:id/approve` | Admin / Super Admin (body: `remarks?`; sends the shortlist email) |
| `PATCH` | `/api/v1/applicants/:id/reject` | Admin / Super Admin (body: `remarks`) |
| `GET` | `/api/v1/users` | Admin / Super Admin |
| `POST` | `/api/v1/users` | SUPER_ADMIN only |
| `PATCH` | `/api/v1/users/:id` | SUPER_ADMIN only |

### Tracks (courses)

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/tracks` | Public |
| `GET` | `/api/v1/tracks/:id` | Public |
| `POST` | `/api/v1/tracks` | Admin / Super Admin |
| `PATCH` | `/api/v1/tracks/:id` | Admin / Super Admin |
| `DELETE` | `/api/v1/tracks/:id` | Admin / Super Admin |

### Applications

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/applications` | CANDIDATE only |
| `GET` | `/api/v1/applications` | Any logged-in user |
| `GET` | `/api/v1/applications/:id` | Any logged-in user |
| `PATCH` | `/api/v1/applications/:id/shortlist` | Admin / Super Admin |
| `PATCH` | `/api/v1/applications/:id/select` | Admin / Super Admin |
| `PATCH` | `/api/v1/applications/:id/reject` | Admin / Super Admin |

### Entrance Tests

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/tests` | Admin / Super Admin |
| `PATCH` | `/api/v1/tests/:id` | Admin / Super Admin |
| `POST` | `/api/v1/tests/:id/questions` | Admin / Super Admin |
| `DELETE` | `/api/v1/tests/questions/:qid` | Admin / Super Admin |
| `GET` | `/api/v1/tests/attempts/list` | Any logged-in user |
| `POST` | `/api/v1/tests/attempts/:attemptId/submit` | CANDIDATE only |
| `GET` | `/api/v1/tests` | Any logged-in user |
| `GET` | `/api/v1/tests/:id` | Admin / Super Admin |
| `POST` | `/api/v1/tests/:id/start` | CANDIDATE only |

### Interviews

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/interviews` | Admin / Super Admin |
| `PATCH` | `/api/v1/interviews/:id/complete` | Admin / Super Admin |
| `PATCH` | `/api/v1/interviews/:id/cancel` | Admin / Super Admin |
| `GET` | `/api/v1/interviews` | Any logged-in user |

### Payments & Fee Plans

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/payments/webhook` | Public |
| `POST` | `/api/v1/payments/orders` | CANDIDATE only |
| `POST` | `/api/v1/payments/verify` | CANDIDATE only |
| `GET` | `/api/v1/payments/plans` | Any logged-in user |
| `POST` | `/api/v1/payments/plans` | Admin / Super Admin |
| `PATCH` | `/api/v1/payments/plans/:id` | Admin / Super Admin |
| `POST` | `/api/v1/payments/manual` | Admin / Super Admin |
| `GET` | `/api/v1/payments/revenue` | Admin / Super Admin |
| `GET` | `/api/v1/payments` | Any logged-in user |
| `GET` | `/api/v1/payments/:id/receipt` | Any logged-in user |
| `POST` | `/api/v1/payments/reminders` | Admin / Super Admin |

### Bonds (e-sign)

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/bonds` | Any logged-in user |
| `GET` | `/api/v1/bonds/application/:applicationId` | Any logged-in user |
| `PATCH` | `/api/v1/bonds/:id` | Admin / Super Admin |
| `POST` | `/api/v1/bonds/:id/send-otp` | CANDIDATE only |
| `POST` | `/api/v1/bonds/:id/sign` | CANDIDATE only |

### Training (batches, sessions, attendance)

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/training/batches` | Admin / Super Admin |
| `PATCH` | `/api/v1/training/batches/:id` | Admin / Super Admin |
| `GET` | `/api/v1/training/batches` | Any logged-in user |
| `GET` | `/api/v1/training/batches/:id/members` | Trainer + Admin |
| `POST` | `/api/v1/training/batches/:id/members` | Admin / Super Admin |
| `POST` | `/api/v1/training/batches/:id/sessions` | Trainer + Admin |
| `GET` | `/api/v1/training/batches/:id/sessions` | Any logged-in user |
| `POST` | `/api/v1/training/sessions/:id/attendance` | Trainer + Admin |
| `GET` | `/api/v1/training/sessions/:id/attendance` | Trainer + Admin |
| `GET` | `/api/v1/training/my-attendance` | CANDIDATE only |

### Assignments

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/assignments` | Trainer + Admin |
| `GET` | `/api/v1/assignments` | Any logged-in user |
| `POST` | `/api/v1/assignments/:id/submit` | CANDIDATE only |
| `GET` | `/api/v1/assignments/:id/submissions` | Trainer + Admin |
| `PATCH` | `/api/v1/assignments/submissions/:submissionId/grade` | Trainer + Admin |

### Progress & Certificates

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/progress/mine` | Any logged-in user |
| `GET` | `/api/v1/progress/application/:applicationId` | Any logged-in user |
| `GET` | `/api/v1/progress/batch/:batchId` | Trainer + Admin |
| `POST` | `/api/v1/progress/application/:applicationId/rating` | Trainer + Admin |
| `POST` | `/api/v1/progress/application/:applicationId/recalculate` | Trainer + Admin |

### Placement (clients, requirements)

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/v1/placement/clients` | Admin / Super Admin |
| `GET` | `/api/v1/placement/clients` | Admin / Super Admin |
| `PATCH` | `/api/v1/placement/clients/:id` | Admin / Super Admin |
| `POST` | `/api/v1/placement/requirements` | Admin / Super Admin |
| `GET` | `/api/v1/placement/requirements` | Admin / Super Admin |
| `PATCH` | `/api/v1/placement/requirements/:id` | Admin / Super Admin |
| `GET` | `/api/v1/placement/ready` | Admin / Super Admin |
| `POST` | `/api/v1/placement` | Admin / Super Admin |
| `PATCH` | `/api/v1/placement/:id/confirm` | Admin / Super Admin |
| `GET` | `/api/v1/placement` | Any logged-in user |

### Dashboards

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/dashboard/admin` | Admin / Super Admin |
| `GET` | `/api/v1/dashboard/trainer` | TRAINER only |
| `GET` | `/api/v1/dashboard/me` | CANDIDATE only |

### Notifications

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/notifications` | Any logged-in user |
| `PATCH` | `/api/v1/notifications/read-all` | Any logged-in user |
| `PATCH` | `/api/v1/notifications/:id/read` | Any logged-in user |

### Policies

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/v1/policies` | Any logged-in user |
| `POST` | `/api/v1/policies` | Admin / Super Admin |
| `PATCH` | `/api/v1/policies/:id` | Admin / Super Admin |
| `POST` | `/api/v1/policies/:id/accept` | Any logged-in user |
| `GET` | `/api/v1/policies/:id/acceptances` | Admin / Super Admin |

---

## 8. Database (24 models)

`User, PasswordReset, Track, FeePlan, Application, Test, Question, TestAttempt, Interview, Payment, Bond, Batch, BatchMember, Session, Attendance, Assignment, Submission, Progress, Client, Requirement, Placement, Notification, Policy, PolicyAcceptance`

All IDs are `cuid` strings. Foreign keys, status columns and common list queries are indexed (29 indexes).

---

## 9. Performance & security

- gzip compression, `helmet`, `x-powered-by` disabled, `trust proxy` for correct client IPs.
- Rate limits: 600 requests / 15 min per IP overall; 20 / 15 min on login, register, forgot/reset password. The Razorpay webhook is exempt.
- CORS restricted via `CORS_ORIGIN`.
- Passwords hashed with bcrypt; refresh tokens and reset tokens stored only as hashes; bond OTP hashed with expiry; HMAC compared with constant-time `safeEqual`.
- Request bodies validated with zod; Prisma errors mapped to clean `404/409/400` responses; stack traces hidden in production.
- Payment gateway refuses to run unconfigured in production (mock mode only in development).

## 10. Production checklist

1. Set strong `JWT_*` secrets and a real `CORS_ORIGIN`.
2. Configure SMTP and Razorpay keys + webhook secret.
   Resumes are saved in `UPLOAD_DIR`: put it on a persistent disk (not an ephemeral container filesystem) and include it in backups.
3. `npx prisma migrate deploy`, then `npm run build && npm start` behind HTTPS (nginx / load balancer).
4. Run a process manager (PM2 / Docker) and DB backups.

## 11. What this merge contains

This project is the best of two earlier backends:

- **Base:** the module-based codebase (zod validation, hashed refresh tokens, password reset, Razorpay webhook + signature check, email, bond OTP, indexes).
- **Added from the larger design:** fee plans with installments and discounts, manual (cash / bank) payments, revenue summary, policies with acceptance tracking, client requirements with openings tracking.
- **Added for speed/security:** compression, rate limiting, CORS control, extra database indexes.

**Not included / ideas for later:** automated tests, file upload storage (S3), SMS notifications, late-fee auto-calculation.
