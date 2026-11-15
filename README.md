# Job Asset Portal — Hiring, Training & Placement Platform

**Live Portal:** https://jobassets.recruweb.com/

A web-based hiring, training and placement platform for managing the candidate journey from application and resume review through assessments, interviews, selection, onboarding, training and placement. The supplied project also contains a client/HR (HALMS) API alongside the candidate and training portal API.

---

## Live Application

Open the production portal:

**https://jobassets.recruweb.com/**

The URL above is the live application link supplied for this project. This README does not imply that the production deployment or every feature has been independently tested.

## Main Capabilities

The following capabilities are represented by the backend modules and route files included in this project:

### Candidate and application management
- Candidate registration and login
- Resume upload and protected resume access
- Admin review of pending applicants, including approval and rejection
- Application status and progress tracking
- Candidate profile management

### Recruitment and assessment
- Job tracks / training tracks
- Application shortlisting, selection and rejection
- Entrance tests, questions and test attempts
- Interview scheduling, completion and cancellation
- Candidate and recruitment dashboards

### Fees, bonds and documents
- Fee plans and payment records
- Razorpay order creation and payment verification
- Razorpay webhook support
- Manual payment recording by authorized staff
- Candidate bond generation and OTP-based e-sign flow
- Document and certificate-related routes

### Training and placement
- Training batches and batch membership
- Training modules and sessions
- Attendance and assignment management
- Candidate progress calculationQ
- Placement management and joining confirmation
- Notifications and policy management

### Client / HR (HALMS) API
The backend also includes a separate HALMS API mounted under `/api`. Its included modules cover authentication, jobs, applicants, candidates, employees, interviews, walk-in drives, teams, profiles, notifications, support, settings, dashboards and an assistant endpoint.

> Exact screens and permissions depend on the deployed frontend and configured user roles. Refer to the route files and backend documentation for implementation details.

## Technology Stack

### Backend
- Node.js (18 or later)
- Express.js
- TypeScript
- Prisma ORM
- MySQL database (asset portal configuration)
- Sequelize ORM (HALMS/client API)
- JWT authentication
- Zod request validation
- Multer file uploads
- Nodemailer email integration
- Razorpay payment integration
- Helmet, CORS, compression and Express rate limiting

### Frontend
The supplied `frontend/` directory is a **production build (`dist` output)**, not the editable frontend source project. It contains the compiled JavaScript/CSS assets, `index.html`, favicon, logo and static media.

The production HTML references a React application bundle and bundled frontend dependencies including Axios and Lucide icon components. The original frontend source files and frontend package manifest are not included in this ZIP.

## Repository Structure

```text
job-asset-portal/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── modules/          # Asset portal API modules
│   │   ├── services/
│   │   ├── utils/
│   │   └── halms/            # Client / HR API (Sequelize)
│   ├── scripts/
│   ├── .env.example
│   ├── package.json
│   ├── README.md
│   └── DOCUMENTATION.md
└── frontend/
    ├── index.html
    ├── assets/               # Compiled production bundles
    ├── logo.png
    ├── favicon.png
    └── DEPLOYMENT_BUILD_README.txt
```

## Backend API

The backend exposes two API groups:

| API group | Base path | Purpose |
|---|---|---|
| Asset / candidate portal | `/api/v1` | Candidate lifecycle, tests, interviews, payments, bonds, training, assignments, progress and placement |
| HALMS client / HR API | `/api` | Client/HR-related workflows |

Health check:

```http
GET /health
```

Expected successful response:

```json
{
  "success": true,
  "message": "ok"
}
```

The asset portal API uses bearer-token authentication for protected endpoints:

```http
Authorization: Bearer <accessToken>
```

For the detailed endpoint list, request formats, access roles and workflow rules, see [`backend/DOCUMENTATION.md`](backend/DOCUMENTATION.md).

## Local Backend Setup

### Requirements
- Node.js 18+
- npm
- MySQL database
- Database user with permission to create/use tables

### 1. Open the backend directory

```bash
cd backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create `.env` from the supplied example:

```bash
cp .env.example .env
```

On Windows Command Prompt:

```bat
copy .env.example .env
```

Update the values in `.env`, especially:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL="mysql://DB_USER:DB_PASSWORD@localhost:3306/DB_NAME"

JWT_ACCESS_SECRET=replace_with_a_long_random_secret
JWT_REFRESH_SECRET=replace_with_another_long_random_secret
HALMS_JWT_SECRET=replace_with_another_long_random_secret

SUPER_ADMIN_NAME=Super Admin
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=replace_with_a_strong_password

CORS_ORIGIN=http://localhost:5173
APP_URL=http://localhost:5173
CLIENT_URL=http://localhost:5173
```

Also configure SMTP, Razorpay and the AI assistant only if those integrations are required. Use real production secrets in the hosting environment; do not commit `.env` files or credentials to Git.

### 4. Initialize the database

```bash
npm run db:init
```

This script generates the Prisma client, applies Prisma migrations and runs the configured seed steps. Review the seed scripts and database configuration before running against an existing or production database.

### 5. Start the backend in development

```bash
npm run dev
```

The default local health endpoint is:

```text
http://localhost:4000/health
```

### 6. Useful backend commands

```bash
npm run typecheck
npm run build
npm start
npm run doctor
npm run seed
npm run prisma:generate
npm run prisma:migrate
```

Run `npm run typecheck` and `npm run build` before deployment.

## Environment Variables

The full variable template is in [`backend/.env.example`](backend/.env.example). Important settings include:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `JWT_ACCESS_SECRET` | Asset portal access-token signing secret |
| `JWT_REFRESH_SECRET` | Asset portal refresh-token signing secret |
| `HALMS_JWT_SECRET` | HALMS authentication secret |
| `PORT` | Backend listening port (default `4000`) |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma-separated if multiple |
| `APP_URL` | Main frontend URL used in links and emails |
| `CLIENT_URL` | Client portal URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Outgoing email configuration |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay payment credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature verification |
| `ANTHROPIC_API_KEY` | Optional AI assistant API key |
| `ASSISTANT_MODEL` | AI assistant model setting |
| `BOND_MONTHS` | Default bond duration |

Never publish actual secret values. Configure production variables in the hosting provider's environment-variable settings.

## Deployment Notes

- The supplied frontend folder is already a compiled production build; it is not the source project for making frontend code changes.
- Deploy the contents of `frontend/` to the configured static web hosting/document root for the portal.
- Deploy `backend/` as the Node.js service using the provided build/start scripts.
- Configure the production MySQL connection, JWT secrets, CORS allowed origins, frontend URLs, SMTP and payment credentials in the backend environment.
- Apply database migrations using the production migration command (`npm run prisma:deploy`) after confirming the target database and backup.
- Configure the Razorpay webhook to the production API endpoint documented in `backend/DOCUMENTATION.md`.
- Ensure uploaded files are stored persistently and are not exposed through a public static directory.
- Configure the hosting platform's Node.js version to 18 or newer.

The ZIP does not include hosting-provider credentials or live environment values. Confirm the actual server paths, domains, database settings and deployment commands with the hosting configuration before making production changes.

## Security and Operations

- Keep `.env` private and out of version control.
- Use unique, strong JWT secrets in production.
- Change any sample or seed administrator credentials immediately.
- Restrict `CORS_ORIGIN` to the actual trusted frontend origins.
- Use HTTPS for the frontend, API and payment callbacks.
- Keep database and uploaded-resume backups.
- Do not expose candidate resumes or private documents through public static URLs.
- Verify payment signatures and webhook configuration before accepting live payments.

## Additional Documentation

- [Backend quick-start README](backend/README.md)
- [Backend full documentation and API endpoint reference](backend/DOCUMENTATION.md)
- [Backend environment template](backend/.env.example)

---

**Project:** Job Asset Portal  
**Live URL:** https://jobassets.recruweb.com/  
**Backend package:** `asset-portal-backend`  
**Backend version:** `2.0.0`
