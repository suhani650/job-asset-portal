import 'dotenv/config';

function req(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 4000,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*', // comma separated list in production
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  JWT_ACCESS_SECRET: req('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: req('JWT_REFRESH_SECRET'),
  ACCESS_TTL: process.env.ACCESS_TTL || '15m',
  REFRESH_TTL: process.env.REFRESH_TTL || '7d',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'Portal <no-reply@example.com>',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  BOND_MONTHS: Number(process.env.BOND_MONTHS) || 12,
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads', // resumes live here (outside any public folder)
  MAX_RESUME_MB: Number(process.env.MAX_RESUME_MB) || 5,
};
export const isProd = env.NODE_ENV === 'production';
