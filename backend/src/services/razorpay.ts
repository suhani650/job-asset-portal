import crypto from 'crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/http';

export const razorpayConfigured = () => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

export async function createRazorpayOrder(amountRupees: number, receipt: string): Promise<{ id: string; mock: boolean }> {
  if (!razorpayConfigured()) return { id: `order_mock_${crypto.randomBytes(6).toString('hex')}`, mock: true };
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: amountRupees * 100, currency: 'INR', receipt }),
  });
  if (!r.ok) throw new ApiError(502, 'Razorpay order creation failed');
  const j = (await r.json()) as { id: string };
  return { id: j.id, mock: false };
}
