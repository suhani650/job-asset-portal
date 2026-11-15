# Hiring, Training & Placement Portal — Backend

Express + TypeScript + Prisma + PostgreSQL. One API for the web portal and the mobile app.

```bash
npm install
cp .env.example .env
npx prisma migrate dev     # applies all migrations, including the applicant login gate
npm run seed
npm run dev        # http://localhost:4000/health
```

Seed login: `admin@example.com` / `Admin@12345`

New candidates register with a resume file and stay `PENDING` until an Admin approves them (`/api/v1/applicants`).

Full documentation (setup, env vars, status flow, payments, all 100 endpoints): **[DOCUMENTATION.md](./DOCUMENTATION.md)**
