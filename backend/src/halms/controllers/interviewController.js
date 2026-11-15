import { Op } from 'sequelize';
import { Job, Registration } from '../models/index.js';
import { JobApplication } from '../models/jobApplication.js';
import { Interview } from '../models/interview.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';
import { nowLocal, toMinutes } from '../utils/walkinPass.js';
import { applyWalkInEvent as applyEvent } from '../utils/applicationSync.js';
import { notifyCandidate } from '../utils/notify.js';
import { sendEmail, emailHtml, safe } from '../utils/mailer.js';
import { interviewCode, codeMatches } from '../utils/interviewCode.js';

/* Scheduled interviews: the company picks a date and time, the candidate gets an email with a 6-digit code,
   and the interviewer verifies the candidate with that code when the candidate arrives. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODES = ['in_person', 'online', 'phone'];
const MAX_WRONG = 5;
const bad = (m) => new HttpError(400, m);

export const validateInterviewId = (req, res, next, id) => (UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Interview not found.' }));

const orgOf = (req) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return req.user.registrationId;
};
const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const t12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const whenText = (iv) => `${dayText(iv.date)}, ${t12(iv.startTime)} (${iv.durationMin} min)`;
const whereText = (iv) => (iv.mode === 'online' ? `Online. Meeting link: ${iv.location}` : iv.mode === 'phone' ? `Phone interview. We will call you on: ${iv.location}` : `In person at: ${iv.location}`);

function shape(iv, job) {
  return {
    id: iv.id, applicationId: iv.applicationId, jobId: iv.jobId, jobTitle: job?.title || '', jobCode: job?.jobCode || '',
    candidate: { name: iv.candidateName, email: iv.candidateEmail },
    date: iv.date, startTime: iv.startTime, durationMin: iv.durationMin, mode: iv.mode, location: iv.location,
    instructions: iv.instructions || '', interviewerName: iv.interviewerName || '', status: iv.status,
    verifiedAt: iv.verifiedAt, verifiedBy: iv.verifiedBy || '', verifyMethod: iv.verifyMethod || '', locked: iv.attempts >= MAX_WRONG && !iv.verifiedAt,
    cancelReason: iv.cancelReason || '', createdByName: iv.createdByName || '', createdAt: iv.createdAt,
  };
}

function clean(b) {
  const date = str(b.date, 10);
  const startTime = str(b.startTime, 5);
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw bad('Choose the interview date.');
  if (!TIME_RE.test(startTime)) throw bad('Choose the interview start time.');
  const durationMin = Number(b.durationMin ?? 30);
  if (!Number.isInteger(durationMin) || durationMin < 10 || durationMin > 480) throw bad('The interview length must be between 10 and 480 minutes.');
  const mode = b.mode || 'in_person';
  if (!MODES.includes(mode)) throw bad('Choose how the interview happens: in person, online or phone.');
  const location = str(b.location, 300);
  if (mode === 'in_person' && location.length < 5) throw bad('Write the address where the candidate should come.');
  if (mode === 'online' && !/^https?:\/\/\S{4,}$/i.test(location)) throw bad('Paste the meeting link (it must start with http:// or https://).');
  if (mode === 'phone' && !/^[0-9+\-\s()]{7,20}$/.test(location)) throw bad('Write the phone number the candidate should be called on.');
  const now = nowLocal();
  if (date < now.date || (date === now.date && toMinutes(startTime) < now.minutes)) throw bad('The interview time cannot be in the past.');
  return { date, startTime, durationMin, mode, location, instructions: str(b.instructions, 1000) || null, interviewerName: str(b.interviewerName, 120) || null };
}

async function mailCandidate(iv, job, kind) {
  const reg = await Registration.findByPk(iv.orgId, { attributes: ['company'] });
  const company = reg?.company?.name || 'the company';
  const code = interviewCode(iv);
  const head = kind === 'rescheduled' ? 'Your interview was rescheduled' : 'Your interview is scheduled';
  const lines = [
    `Hello ${safe(iv.candidateName)},`,
    kind === 'rescheduled' ? `<b>${safe(company)}</b> has changed the time of your interview for <b>${safe(job?.title || 'the job')}</b>. The new details are below.` : `<b>${safe(company)}</b> has scheduled your interview for <b>${safe(job?.title || 'the job')}</b>.`,
    `<b>When:</b> ${safe(whenText(iv))}`,
    `<b>Where:</b> ${safe(whereText(iv))}`,
    ...(iv.interviewerName ? [`<b>Interviewer:</b> ${safe(iv.interviewerName)}`] : []),
    ...(iv.instructions ? [`<b>Please note:</b> ${safe(iv.instructions)}`] : []),
    'Show the code below to the interviewer. It proves it is really you:',
  ];
  await sendEmail({
    to: iv.candidateEmail,
    subject: `${head}: ${job?.title || 'Interview'} at ${company}`,
    text: `Hello ${iv.candidateName},\n\n${head} for ${job?.title || 'the job'} at ${company}.\nWhen: ${whenText(iv)}\nWhere: ${whereText(iv)}\n${iv.interviewerName ? `Interviewer: ${iv.interviewerName}\n` : ''}${iv.instructions ? `Please note: ${iv.instructions}\n` : ''}\nYour verification code: ${code}\nShow it to the interviewer. You can also see it any time under My Job Applications on the portal.\n\nAsset Portal`,
    html: emailHtml({ title: head, lines, code, codeNote: 'Your interview verification code', footer: 'You can also see this code any time under <b>My Job Applications</b> on the Asset Portal.' }),
  });
}

async function load(req) {
  const iv = await Interview.findOne({ where: { id: req.params.id, orgId: orgOf(req) } });
  if (!iv) throw new HttpError(404, 'Interview not found.');
  return iv;
}

/* GET /interviews?scope=today|upcoming|past|cancelled|all */
export const listInterviews = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  const today = nowLocal().date;
  const scope = ['today', 'upcoming', 'past', 'cancelled', 'all'].includes(req.query.scope) ? req.query.scope : 'upcoming';
  const where = { orgId };
  if (scope === 'today') Object.assign(where, { date: today, status: { [Op.ne]: 'cancelled' } });
  else if (scope === 'upcoming') Object.assign(where, { date: { [Op.gt]: today }, status: 'scheduled' });
  else if (scope === 'past') Object.assign(where, { [Op.or]: [{ date: { [Op.lt]: today }, status: { [Op.ne]: 'cancelled' } }, { date: today, status: { [Op.in]: ['completed', 'no_show'] } }] });
  else if (scope === 'cancelled') where.status = 'cancelled';
  const rows = await Interview.findAll({ where, order: [['date', scope === 'past' ? 'DESC' : 'ASC'], ['startTime', 'ASC']], limit: 300 });
  const jobs = await Job.findAll({ where: { id: [...new Set(rows.map((r) => r.jobId))] }, attributes: ['id', 'title', 'jobCode'] });
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));

  const all = await Interview.findAll({ where: { orgId }, attributes: ['date', 'status', 'verifiedAt'], raw: true });
  const counts = {
    today: all.filter((r) => r.date === today && r.status !== 'cancelled').length,
    todayWaiting: all.filter((r) => r.date === today && r.status === 'scheduled' && !r.verifiedAt).length,
    upcoming: all.filter((r) => r.date > today && r.status === 'scheduled').length,
    past: all.filter((r) => r.status !== 'cancelled' && (r.date < today || (r.date === today && r.status !== 'scheduled'))).length,
    cancelled: all.filter((r) => r.status === 'cancelled').length,
  };
  res.json({ items: rows.map((r) => shape(r, byId[r.jobId])), counts, today });
});

/* POST /interviews */
export const scheduleInterview = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  if (!UUID_RE.test(String(req.body?.applicationId || ''))) throw bad('Choose the applicant.');
  const app = await JobApplication.findOne({ where: { id: req.body.applicationId, orgId } });
  if (!app) throw new HttpError(404, 'Applicant not found.');
  if (['withdrawn', 'rejected', 'hired'].includes(app.status)) throw new HttpError(409, `This applicant is ${app.status}, so an interview cannot be scheduled.`);
  const details = clean(req.body);
  if (await Interview.count({ where: { applicationId: app.id, status: 'scheduled' } })) throw new HttpError(409, 'This applicant already has a scheduled interview. Reschedule it instead.');

  const job = await Job.findByPk(app.jobId, { attributes: ['id', 'title', 'jobCode'] });
  const iv = await Interview.create({
    ...details, orgId, jobId: app.jobId, applicationId: app.id, candidateUserId: app.candidateUserId,
    candidateName: app.candidateName, candidateEmail: app.candidateEmail, createdById: req.user.id, createdByName: req.user.name,
  });
  await applyEvent(app.id, { stage: 'interview', status: 'interview', onlyFrom: ['applied', 'screening', 'interview'], message: `Interview scheduled: ${whenText(iv)}. ${whereText(iv)}`, by: req.user.name });
  await notifyCandidate(app.candidateUserId, 'Interview scheduled', `${job?.title || 'Job'}: ${whenText(iv)}. ${whereText(iv)}. Your verification code is on My Job Applications.`);
  await mailCandidate(iv, job, 'scheduled');
  await audit({ actor: req.user, action: 'INTERVIEW_SCHEDULED', entity: 'Interview', entityId: iv.id, meta: { candidate: app.candidateName, date: iv.date, time: iv.startTime }, req });
  res.status(201).json(shape(iv, job));
});

/* PATCH /interviews/:id  (reschedule) */
export const rescheduleInterview = asyncHandler(async (req, res) => {
  const iv = await load(req);
  if (iv.status !== 'scheduled') throw new HttpError(409, `This interview is ${iv.status.replace('_', ' ')} and cannot be changed.`);
  if (iv.verifiedAt) throw new HttpError(409, 'The candidate has already been verified for this interview.');
  const details = clean({ ...req.body, mode: req.body?.mode ?? iv.mode, location: req.body?.location ?? iv.location });
  await iv.update({ ...details, codeVersion: iv.codeVersion + 1, attempts: 0 }); // a new code, and the wrong-code counter starts again
  const job = await Job.findByPk(iv.jobId, { attributes: ['id', 'title', 'jobCode'] });
  await applyEvent(iv.applicationId, { stage: 'interview', message: `Interview rescheduled: ${whenText(iv)}. ${whereText(iv)}`, by: req.user.name });
  await notifyCandidate(iv.candidateUserId, 'Interview rescheduled', `${job?.title || 'Job'}: new time ${whenText(iv)}. ${whereText(iv)}. Your NEW verification code is on My Job Applications.`);
  await mailCandidate(iv, job, 'rescheduled');
  await audit({ actor: req.user, action: 'INTERVIEW_RESCHEDULED', entity: 'Interview', entityId: iv.id, meta: { date: iv.date, time: iv.startTime }, req });
  res.json(shape(iv, job));
});

/* POST /interviews/:id/cancel */
export const cancelInterview = asyncHandler(async (req, res) => {
  const iv = await load(req);
  if (iv.status !== 'scheduled') throw new HttpError(409, `This interview is already ${iv.status.replace('_', ' ')}.`);
  const reason = str(req.body?.reason, 300);
  await iv.update({ status: 'cancelled', cancelReason: reason || null });
  const job = await Job.findByPk(iv.jobId, { attributes: ['id', 'title', 'jobCode'] });
  await applyEvent(iv.applicationId, { stage: 'screening', status: 'screening', onlyFrom: ['interview'], message: `The interview on ${dayText(iv.date)} was cancelled.${reason ? ` ${reason}` : ''}`, by: req.user.name });
  await notifyCandidate(iv.candidateUserId, 'Interview cancelled', `${job?.title || 'Job'}: the interview on ${dayText(iv.date)} was cancelled.${reason ? ` ${reason}` : ''}`);
  const reg = await Registration.findByPk(iv.orgId, { attributes: ['company'] });
  await sendEmail({
    to: iv.candidateEmail, subject: `Interview cancelled: ${job?.title || 'Interview'}`,
    text: `Hello ${iv.candidateName},\n\nYour interview for ${job?.title || 'the job'} on ${whenText(iv)} was cancelled by ${reg?.company?.name || 'the company'}.${reason ? `\nReason: ${reason}` : ''}\nThe team will contact you if a new time is fixed.\n\nAsset Portal`,
    html: emailHtml({ title: 'Interview cancelled', lines: [`Hello ${safe(iv.candidateName)},`, `Your interview for <b>${safe(job?.title || 'the job')}</b> on ${safe(whenText(iv))} was cancelled.`, ...(reason ? [`Reason: ${safe(reason)}`] : []), 'The team will contact you if a new time is fixed.'] }),
  });
  await audit({ actor: req.user, action: 'INTERVIEW_CANCELLED', entity: 'Interview', entityId: iv.id, req });
  res.json(shape(iv, job));
});

/* POST /interviews/:id/status  { status: 'completed' | 'no_show' } */
export const setInterviewStatus = asyncHandler(async (req, res) => {
  const iv = await load(req);
  const status = req.body?.status;
  if (!['completed', 'no_show'].includes(status)) throw bad('Choose completed or no show.');
  if (iv.status === 'cancelled') throw new HttpError(409, 'This interview was cancelled.');
  await iv.update({ status });
  await applyEvent(iv.applicationId, { stage: 'interview', message: status === 'completed' ? 'Your interview is complete. The team will update you soon.' : 'You were marked absent for the interview.', by: req.user.name });
  await audit({ actor: req.user, action: status === 'completed' ? 'INTERVIEW_COMPLETED' : 'INTERVIEW_NO_SHOW', entity: 'Interview', entityId: iv.id, req });
  const job = await Job.findByPk(iv.jobId, { attributes: ['id', 'title', 'jobCode'] });
  res.json(shape(iv, job));
});

/* POST /interviews/verify  { interviewId, code }   -> always 200 with { result: 'ok' | 'denied', reason, message } */
async function verifiedReply(iv, method, actor, req) {
  await iv.update({ verifiedAt: new Date(), verifiedBy: actor.name, verifyMethod: method });
  await applyEvent(iv.applicationId, { stage: 'interview', message: 'You arrived and were verified for the interview.', by: actor.name });
  await audit({ actor, action: method === 'otp' ? 'INTERVIEW_VERIFIED_OTP' : 'INTERVIEW_VERIFIED_MANUAL', entity: 'Interview', entityId: iv.id, meta: { candidate: iv.candidateName }, req });
  const job = await Job.findByPk(iv.jobId, { attributes: ['id', 'title', 'jobCode'] });
  return { result: 'ok', message: `${iv.candidateName} is verified.`, interview: shape(iv, job) };
}
function blocked(iv) {
  const now = nowLocal();
  const deny = (reason, message) => ({ result: 'denied', reason, message });
  if (iv.status === 'cancelled') return deny('CANCELLED', 'This interview was cancelled.');
  if (iv.status !== 'scheduled') return deny('CLOSED', `This interview is already ${iv.status.replace('_', ' ')}.`);
  if (iv.verifiedAt) return deny('ALREADY_VERIFIED', `${iv.candidateName} was already verified${iv.verifiedBy ? ` by ${iv.verifiedBy}` : ''}.`);
  if (iv.date !== now.date) return deny('WRONG_DATE', iv.date > now.date ? `Too early. This interview is on ${dayText(iv.date)}.` : `This interview was on ${dayText(iv.date)}.`);
  return null;
}

export const verifyInterview = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  const code = str(req.body?.code, 12).replace(/\s/g, '');
  if (!UUID_RE.test(String(req.body?.interviewId || ''))) throw bad('Choose the candidate to verify.');
  if (!/^\d{6}$/.test(code)) return res.json({ result: 'denied', reason: 'BAD_CODE', message: 'Type the 6-digit code the candidate shows.' });
  const iv = await Interview.findOne({ where: { id: req.body.interviewId, orgId } });
  if (!iv) throw new HttpError(404, 'Interview not found.');
  const stop = blocked(iv);
  if (stop) return res.json({ ...stop, interview: shape(iv, null) });
  if (iv.attempts >= MAX_WRONG) return res.json({ result: 'denied', reason: 'LOCKED', message: 'Too many wrong codes. Check the candidate\'s ID card and use "Verify with ID".' });
  if (!codeMatches(iv, code)) {
    await iv.update({ attempts: iv.attempts + 1 });
    const left = MAX_WRONG - iv.attempts;
    return res.json({ result: 'denied', reason: 'WRONG_CODE', message: left > 0 ? `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Check the candidate\'s ID card and use "Verify with ID".' });
  }
  res.json(await verifiedReply(iv, 'otp', req.user, req));
});

// POST /interviews/:id/verify-manual: the interviewer checked the candidate's ID card instead of the code
export const verifyInterviewManually = asyncHandler(async (req, res) => {
  const iv = await load(req);
  const stop = blocked(iv);
  if (stop) return res.json({ ...stop, interview: shape(iv, null) });
  res.json(await verifiedReply(iv, 'manual', req.user, req));
});
