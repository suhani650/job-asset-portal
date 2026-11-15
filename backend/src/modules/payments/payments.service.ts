import { prisma } from '../../config/db';
import { ApiError } from '../../utils/http';
import { moveStatus } from '../applications/applications.service';

export const planTotal = (plan: { totalAmount: number; discountPct: number | null }) =>
  Math.round(plan.totalAmount * (1 - (plan.discountPct ?? 0) / 100));

/** After a payment is PAID: move application BOND_SIGNED -> FEE_PAID (first payment only). The bond already exists and is signed. */
export async function finalizePaid(paymentId: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new ApiError(404, 'Payment not found');
  // only the first payment confirms the seat; later installments must not re-trigger the flow
  const app = await prisma.application.findUnique({ where: { id: p.applicationId }, select: { status: true } });
  if (app?.status === 'BOND_SIGNED') await moveStatus(p.applicationId, 'FEE_PAID');
}

/** Idempotent: marks a payment as PAID, moves the application to FEE_PAID. */
export async function markPaid(orderId: string, paymentId: string) {
  const p = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
  if (!p) throw new ApiError(404, 'Payment not found');
  if (p.status === 'PAID') return p;

  const receiptNo = `RCPT-${new Date().getFullYear()}-${p.id.slice(-6).toUpperCase()}`;
  const updated = await prisma.payment.update({
    where: { id: p.id },
    data: { status: 'PAID', razorpayPaymentId: paymentId, receiptNo, paidAt: new Date() },
  });
  await finalizePaid(p.id);
  return updated;
}
