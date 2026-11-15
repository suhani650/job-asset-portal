import nodemailer from 'nodemailer';

/* Sends an email with the SMTP settings of backend/.env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).
   When SMTP is not set, the email is printed in the BACKEND window instead, so everything can be tried without an email provider. */

let transporter;
function transport() {
  if (transporter !== undefined) return transporter;
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = process.env.SMTP_HOST
    ? nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
    : null;
  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  const t = transport();
  if (!t) {
    console.log(`\n[EMAIL - SMTP is not set in backend/.env, so the email is shown here instead]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    return { sent: false, shownInConsole: true };
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || 'Asset Portal <no-reply@example.com>', to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('Email could not be sent:', e.message);
    return { sent: false, error: e.message };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A simple, good-looking email: header, a few lines, an optional big code, a footer.
export function emailHtml({ title, lines = [], code, codeNote, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f8f5fb;font-family:Segoe UI,Arial,sans-serif;color:#281b3d">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:linear-gradient(135deg,#281b3d,#4a3470);color:#fff;padding:22px 26px"><div style="font-size:12px;letter-spacing:2px;color:#e2925f;font-weight:700">ASSET PORTAL</div><div style="font-size:20px;font-weight:800;margin-top:6px">${esc(title)}</div></div>
    <div style="padding:24px 26px;font-size:14px;line-height:1.6">
      ${lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join('')}
      ${code ? `<div style="margin:18px 0;text-align:center"><div style="display:inline-block;background:#f8f5fb;border:2px dashed #9b7bc0;border-radius:14px;padding:14px 26px;font-size:34px;font-weight:800;letter-spacing:10px;color:#3a2860">${esc(code)}</div>${codeNote ? `<div style="font-size:12px;color:#64748b;margin-top:8px">${esc(codeNote)}</div>` : ''}</div>` : ''}
      ${footer ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${footer}</p>` : ''}
    </div></div></body></html>`;
}
export const safe = esc;
