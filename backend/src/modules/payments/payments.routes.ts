import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { env, isProd } from '../../config/env';
import { asyncHandler, ApiError, ok, paging, uid } from '../../utils/http';
import { validate } from '../../middleware/validate';
import { authenticate, authorize, ADMINS, isStaff } from '../../middleware/auth';
import { createRazorpayOrder, razorpayConfigured } from '../../services/razorpay';
import { hmacSha256, safeEqual } from '../../utils/crypto';
import { markPaid, planTotal, finalizePaid } from './payments.service';
import { notify } from '../../services/notify';

const r = Router();

// ---- Razorpay webhook (no auth, signature protected). Configure event: payment.captured ----
r.post('/webhook', asyncHandler(async (req, res) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const sig = req.headers['x-razorpay-signature'];
  if (!env.RAZORPAY_WEBHOOK_SECRET || !raw || typeof sig !== 'string') throw new ApiError(400, 'Webhook not configured');
  if (!safeEqual(hmacSha256(raw, env.RAZORPAY_WEBHOOK_SECRET), sig)) throw new ApiError(400, 'Invalid signature');
  const entity = req.body?.payload?.payment?.entity;
  if (req.body?.event === 'payment.captured' && entity?.order_id) await markPaid(entity.order_id, entity.id);
  res.json({ success: true });
}));

r.use(authenticate);

// Candidate creates an order for the fee (bond must be signed first, i.e. application BOND_SIGNED or later).
// Optional feePlanId + installmentNo => pays one installment of that plan.
r.post('/orders', authorize('CANDIDATE'),
  validate(z.object({ applicationId: z.string(), feePlanId: z.string().optional(), installmentNo: z.number().int().min(1).optional() })),
  asyncHandler(async (req, res) => {
    const { feePlanId, installmentNo = 1 } = req.body as { feePlanId?: string; installmentNo?: number };
    const app = await prisma.application.findUnique({ where: { id: req.body.applicationId }, include: { track: true } });
    if (!app || app.userId !== uid(req)) throw new ApiError(404, 'Application not found');

    let amount = app.track.fee;
    if (feePlanId) {
      const plan = await prisma.feePlan.findUnique({ where: { id: feePlanId } });
      if (!plan || !plan.isActive || plan.trackId !== app.trackId) throw new ApiError(404, 'Fee plan not found for this track');
      if (installmentNo > plan.installments) throw new ApiError(400, 'Invalid installment number');
      amount = plan.planType === 'ONE_TIME'
        ? planTotal(plan)
        : (plan.perInstallment ?? Math.ceil(planTotal(plan) / plan.installments));
      const dup = await prisma.payment.findFirst({ where: { applicationId: app.id, feePlanId, installmentNo, status: 'PAID' } });
      if (dup) throw new ApiError(409, 'This installment is already paid');
      if (installmentNo === 1 && app.status !== 'BOND_SIGNED' && !(await prisma.payment.count({ where: { applicationId: app.id, status: 'PAID' } })))
        throw new ApiError(409, 'Sign the bond first, then pay the fee');
      if (installmentNo > 1 && !(await prisma.payment.findFirst({ where: { applicationId: app.id, feePlanId, installmentNo: installmentNo - 1, status: 'PAID' } })))
        throw new ApiError(409, 'Pay the previous installment first');
    } else {
      if (app.status !== 'BOND_SIGNED') throw new ApiError(409, 'Sign the bond first, then pay the fee');
      const paid = await prisma.payment.findFirst({ where: { applicationId: app.id, status: 'PAID' } });
      if (paid) throw new ApiError(409, 'Fee already paid');
    }

    const order = await createRazorpayOrder(amount, `app_${app.id.slice(-10)}`);
    const payment = await prisma.payment.create({
      data: { applicationId: app.id, userId: app.userId, amount, razorpayOrderId: order.id, feePlanId: feePlanId ?? null, installmentNo },
    });
    ok(res, {
      paymentId: payment.id, orderId: order.id, amount, currency: 'INR',
      keyId: env.RAZORPAY_KEY_ID || null, mock: order.mock,
    }, 'Order created', 201);
  }));

// Candidate verifies after checkout. In MOCK mode (no keys, non-production) signature check is skipped.
r.post('/verify',
  authorize('CANDIDATE'),
  validate(z.object({ razorpayOrderId: z.string(), razorpayPaymentId: z.string(), razorpaySignature: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const p = await prisma.payment.findUnique({ where: { razorpayOrderId } });
    if (!p || p.userId !== uid(req)) throw new ApiError(404, 'Payment not found');

    if (razorpayConfigured()) {
      const expected = hmacSha256(`${razorpayOrderId}|${razorpayPaymentId}`, env.RAZORPAY_KEY_SECRET);
      if (!razorpaySignature || !safeEqual(expected, razorpaySignature)) throw new ApiError(400, 'Payment signature mismatch');
    } else if (isProd) {
      throw new ApiError(500, 'Payment gateway is not configured');
    }
    ok(res, await markPaid(razorpayOrderId, razorpayPaymentId), 'Payment successful');
  }));

// ---- Fee plans (installments / discounts). Any logged-in user can read, admins manage ----
const planBody = z.object({
  trackId: z.string(),
  planType: z.enum(['ONE_TIME', 'INSTALLMENTS']).default('ONE_TIME'),
  totalAmount: z.number().int().positive(),
  installments: z.number().int().min(1).max(24).default(1),
  perInstallment: z.number().int().positive().optional(),
  discountPct: z.number().min(0).max(100).optional(),
  lateFee: z.number().int().min(0).optional(),
});
r.get('/plans', asyncHandler(async (req, res) => {
  const { trackId } = req.query as Record<string, string | undefined>;
  ok(res, await prisma.feePlan.findMany({ where: { isActive: true, ...(trackId ? { trackId } : {}) }, orderBy: { createdAt: 'desc' } }));
}));
r.post('/plans', authorize(...ADMINS), validate(planBody),
  asyncHandler(async (req, res) => ok(res, await prisma.feePlan.create({ data: req.body }), 'Fee plan created', 201)));
r.patch('/plans/:id', authorize(...ADMINS), validate(planBody.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => ok(res, await prisma.feePlan.update({ where: { id: req.params.id }, data: req.body }), 'Fee plan updated')));

// ---- Admin: record an offline (cash / bank transfer) payment ----
r.post('/manual', authorize(...ADMINS),
  validate(z.object({
    applicationId: z.string(), amount: z.number().int().positive(),
    mode: z.enum(['CASH', 'BANK_TRANSFER']), feePlanId: z.string().optional(),
    installmentNo: z.number().int().min(1).optional(), adminNotes: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const app = await prisma.application.findUnique({ where: { id: req.body.applicationId } });
    if (!app) throw new ApiError(404, 'Application not found');
    const p = await prisma.payment.create({
      data: {
        ...req.body, userId: app.userId, status: 'PAID', paidAt: new Date(),
        receiptNo: `RCPT-${new Date().getFullYear()}-M${Date.now().toString(36).toUpperCase()}`,
      },
    });
    await finalizePaid(p.id);
    ok(res, p, 'Manual payment recorded', 201);
  }));

// ---- Admin: revenue summary ----
r.get('/revenue', authorize(...ADMINS), asyncHandler(async (_req, res) => {
  const [total, byMode, byMonth] = await Promise.all([
    prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ['mode'], where: { status: 'PAID' }, _sum: { amount: true }, _count: true }),
    prisma.$queryRaw<{ month: string; amount: bigint | number | string }[]>`
      SELECT DATE_FORMAT(paidAt, '%Y-%m') AS month, SUM(amount) AS amount
      FROM Payment WHERE status = 'PAID' AND paidAt IS NOT NULL
      GROUP BY month ORDER BY month DESC LIMIT 12`,
  ]);
  ok(res, {
    totalCollected: total._sum.amount ?? 0, totalPayments: total._count,
    byMode: byMode.map((m) => ({ mode: m.mode, amount: m._sum.amount ?? 0, count: m._count })),
    byMonth: byMonth.map((m) => ({ month: m.month, amount: Number(m.amount) })),
  });
}));

r.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query as Record<string, string | undefined>;
  const { page, limit, skip, take } = paging(req.query);
  const where = { ...(isStaff(req) ? {} : { userId: uid(req) }), ...(status ? { status: status as 'CREATED' | 'PAID' | 'FAILED' } : {}) };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({ where, include: { user: { select: { id: true, name: true, email: true } }, application: { select: { track: { select: { name: true } } } } }, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.payment.count({ where }),
  ]);
  ok(res, items, 'OK', 200, { page, limit, total });
}));

r.get('/:id/receipt', asyncHandler(async (req, res) => {
  const p = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true, email: true } }, application: { include: { track: true } } },
  });
  if (!p) throw new ApiError(404, 'Payment not found');
  if (!isStaff(req) && p.userId !== uid(req)) throw new ApiError(403, 'Forbidden');
  if (p.status !== 'PAID') throw new ApiError(409, 'Receipt is available only for paid payments');
  ok(res, {
    receiptNo: p.receiptNo, paidAt: p.paidAt, amount: p.amount, currency: p.currency,
    candidate: p.user, track: p.application.track.name, razorpayPaymentId: p.razorpayPaymentId,
  });
}));

// Admin: send reminder to candidates who signed the bond but have not paid yet
r.post('/reminders', authorize(...ADMINS), asyncHandler(async (_req, res) => {
  const pending = await prisma.application.findMany({ where: { status: 'BOND_SIGNED' }, include: { track: true } });
  await Promise.all(pending.map((a) => notify(a.userId, 'Fee payment reminder', `Please pay the fee of Rs. ${a.track.fee} to confirm your seat in ${a.track.name}.`)));
  ok(res, { reminded: pending.length }, 'Reminders sent');
}));

export default r;
