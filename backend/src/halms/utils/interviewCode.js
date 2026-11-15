import crypto from 'node:crypto';

// The 6-digit code the candidate shows at the interview. It is NOT stored: it is calculated from the interview
// and a server secret, so the company can check it but cannot read it. A new codeVersion (reschedule) gives a new code.
export function interviewCode(iv) {
  const secret = process.env.HALMS_JWT_SECRET || 'dev-only-secret';
  const n = crypto.createHmac('sha256', secret).update(`interview:${iv.id}:${iv.codeVersion}`).digest().readUInt32BE(0) % 1000000;
  return String(n).padStart(6, '0');
}

export function codeMatches(iv, typed) {
  const a = Buffer.from(interviewCode(iv));
  const b = Buffer.from(String(typed || '').padStart(6, '0').slice(0, 6));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
