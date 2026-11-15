import crypto from 'node:crypto';
import { env } from '../config/env.js';

/* QR pass token:  WI1.<bookingId>.<version>.<signature>
   The signature is an HMAC with the server secret, so nobody can invent a pass. The database is still
   checked on every scan (status, date, slot), the signature only proves the QR was issued by us. */

const sign = (id, version) =>
  crypto.createHmac('sha256', env.jwtSecret).update(`WI1.${id}.${version}`).digest('base64url').slice(0, 22);

export const makeToken = (id, version) => `WI1.${id}.${version}.${sign(id, version)}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns { id, version } or null when the text is not a genuine pass.
export function readToken(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'WI1') return null;
  const [, id, ver, sig] = parts;
  if (!UUID_RE.test(id) || !/^\d{1,6}$/.test(ver)) return null;
  const want = Buffer.from(sign(id, Number(ver)));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return { id, version: Number(ver) };
}

/* ---- India time (override with WALKIN_TZ). Drive dates and slot times are local wall-clock times. ---- */
const TZ = process.env.WALKIN_TZ || 'Asia/Kolkata';

export function nowLocal(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
