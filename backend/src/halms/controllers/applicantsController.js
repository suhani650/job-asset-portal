import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Op } from 'sequelize';
import { Job } from '../models/index.js';
import { JobApplication, STAGES } from '../models/jobApplication.js';
import { WalkInDrive, WalkInSlot, WalkInBooking } from '../models/walkin.js';
import { Interview } from '../models/interview.js';
import { Employee } from '../models/employee.js';
import { ensureEmployeeFromApplication } from '../utils/employeeRegistry.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';
import { notifyCandidate } from '../utils/notify.js';

/* Company-facing hiring pipeline: every application to this company's jobs. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offered: 'Offered', hired: 'Hired', rejected: 'Rejected' };
export const validateApplicantId = (req, res, next, id) => (UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Applicant not found.' }));

const orgOf = (req) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return req.user.registrationId;
};

const splitSkills = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 25);

function shape(a, job, withDetail = false, walk = null, iv = null) {
  const out = {
    id: a.id, status: a.status, appliedAt: a.createdAt, updatedAt: a.updatedAt,
    job: job ? { id: job.id, title: job.title, jobCode: job.jobCode, department: job.department } : { id: a.jobId, title: 'Deleted job', jobCode: '' },
    candidate: {
      name: a.candidateName, email: a.candidateEmail, phone: a.candidatePhone || '', city: a.city || '', state: a.state || '',
      qualification: a.qualification || '', college: a.college || '', skills: splitSkills(a.skills), expYears: a.expYears,
      currentCompany: a.currentCompany || '', expectedSalary: a.expectedSalary, linkedin: a.linkedin || '',
    },
    hasResume: !!a.resumePath, resumeName: a.resumeName || '', coverNote: a.coverNote || '', walkIn: walk, interview: iv,
  };
  if (withDetail) { out.history = a.history || []; out.notes = a.notes || []; }
  return out;
}


// the walk-in interview of applications: { applicationId -> { status, driveDate, startTime, endTime, venueName, checkedInAt } }
// the newest interview (not cancelled) of each application
async function interviewMap(apps) {
  const ids = apps.map((a) => a.id);
  const rows = ids.length ? await Interview.findAll({ where: { applicationId: ids, status: { [Op.ne]: 'cancelled' } }, order: [['createdAt', 'DESC']] }) : [];
  const out = {};
  rows.forEach((i) => {
    if (!out[i.applicationId]) out[i.applicationId] = { id: i.id, date: i.date, startTime: i.startTime, durationMin: i.durationMin, mode: i.mode, location: i.location, status: i.status, verifiedAt: i.verifiedAt };
  });
  return out;
}

async function walkInMap(apps) {
  const ids = apps.map((a) => a.id);
  const rows = ids.length ? await WalkInBooking.findAll({ where: { applicationId: ids, status: { [Op.ne]: 'cancelled' } }, order: [['createdAt', 'DESC']] }) : [];
  if (!rows.length) return {};
  const [drives, slots] = await Promise.all([
    WalkInDrive.findAll({ where: { id: [...new Set(rows.map((r) => r.driveId))] } }),
    WalkInSlot.findAll({ where: { id: [...new Set(rows.map((r) => r.slotId))] } }),
  ]);
  const dById = Object.fromEntries(drives.map((d) => [d.id, d]));
  const sById = Object.fromEntries(slots.map((x) => [x.id, x]));
  const out = {};
  rows.forEach((b) => {
    if (out[b.applicationId] || !dById[b.driveId]) return;
    const d = dById[b.driveId];
    const sl = sById[b.slotId];
    out[b.applicationId] = {
      bookingId: b.id, status: d.status === 'cancelled' ? 'cancelled' : b.status, driveDate: d.driveDate, venueName: d.venueName,
      startTime: sl?.startTime || '', endTime: sl?.endTime || '', checkedInAt: b.checkedInAt,
    };
  });
  return out;
}

async function load(req) {
  const a = await JobApplication.findOne({ where: { id: req.params.id, orgId: orgOf(req) } });
  if (!a) throw new HttpError(404, 'Applicant not found.');
  return a;
}

export const listApplicants = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  const where = { orgId };
  if (req.query.jobId && UUID_RE.test(req.query.jobId)) where.jobId = req.query.jobId;
  const q = str(req.query.q, 60).replace(/[%_]/g, '');
  if (q) where[Op.or] = [{ candidateName: { [Op.like]: `%${q}%` } }, { candidateEmail: { [Op.like]: `%${q}%` } }, { skills: { [Op.like]: `%${q}%` } }];

  const rows = await JobApplication.findAll({ where, order: [['updatedAt', 'DESC']], limit: 500 });
  const jobs = await Job.findAll({ where: { orgId }, attributes: ['id', 'title', 'jobCode', 'department', 'status'] });
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));

  const walkMap = await walkInMap(rows);
  const ivMap = await interviewMap(rows);
  const counts = Object.fromEntries([...STAGES, 'withdrawn'].map((s) => [s, 0]));
  rows.forEach((r) => { counts[r.status] += 1; });
  res.json({
    items: rows.filter((r) => r.status !== 'withdrawn').map((r) => shape(r, byId[r.jobId], false, walkMap[r.id] || null, ivMap[r.id] || null)),
    counts,
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, jobCode: j.jobCode, status: j.status })),
  });
});

export const getApplicant = asyncHandler(async (req, res) => {
  const a = await load(req);
  const job = await Job.findByPk(a.jobId, { attributes: ['id', 'title', 'jobCode', 'department'] });
  res.json(shape(a, job, true, (await walkInMap([a]))[a.id] || null, (await interviewMap([a]))[a.id] || null));
});

export const setStage = asyncHandler(async (req, res) => {
  const a = await load(req);
  const stage = req.body?.stage;
  if (!STAGES.includes(stage)) throw new HttpError(400, 'Invalid stage.');
  if (a.status === 'withdrawn') throw new HttpError(409, 'The candidate withdrew this application.');
  if (a.status === stage) throw new HttpError(409, `Already in ${LABEL[stage]}.`);
  const message = str(req.body?.message, 300);

  const history = [...(a.history || []), { stage, at: new Date().toISOString(), by: req.user.name, message }];
  await a.update({ status: stage, history });
  const job = await Job.findByPk(a.jobId, { attributes: ['id', 'title', 'jobCode', 'department'] });

  await audit({ actor: req.user, action: 'APPLICANT_STAGE', entity: 'JobApplication', entityId: a.id, meta: { candidate: a.candidateName, job: job?.title, stage }, req });
  const text = stage === 'rejected'
    ? `Your application for ${job?.title || 'the job'} was not selected this time.`
    : `Your application for ${job?.title || 'the job'} moved to: ${LABEL[stage]}.`;
  await notifyCandidate(a.candidateUserId, 'Job application update', message ? `${text} Message from the company: ${message}` : text);

  // a hired candidate joins the employee registry automatically (once), with the next automatic ID
  let employeeCode = null;
  if (stage === 'hired') {
    const fullJob = await Job.findByPk(a.jobId);
    const emp = (await ensureEmployeeFromApplication(a, fullJob, req.user)) || (await Employee.findOne({ where: { applicationId: a.id } }));
    employeeCode = emp?.empCode || null;
  }
  res.json({ ...shape(a, job, true, (await walkInMap([a]))[a.id] || null, (await interviewMap([a]))[a.id] || null), employeeCode });
});

export const addNote = asyncHandler(async (req, res) => {
  const a = await load(req);
  const text = str(req.body?.text, 1000);
  if (text.length < 2) throw new HttpError(400, 'Write the note first.');
  const notes = [...(a.notes || []), { id: crypto.randomUUID(), by: req.user.name, text, at: new Date().toISOString() }].slice(-100);
  await a.update({ notes });
  const job = await Job.findByPk(a.jobId, { attributes: ['id', 'title', 'jobCode', 'department'] });
  res.json(shape(a, job, true, (await walkInMap([a]))[a.id] || null, (await interviewMap([a]))[a.id] || null));
});

// The resume file belongs to the Candidate portal (same uploads folder). Only the HR / recruiter of the job's company can open it.
export const downloadResume = asyncHandler(async (req, res) => {
  const a = await load(req);
  if (!a.resumePath) throw new HttpError(404, 'No resume on this application.');
  const file = path.join(path.resolve(process.env.UPLOAD_DIR || 'uploads'), path.basename(a.resumePath));
  if (!fs.existsSync(file)) throw new HttpError(404, 'The resume file is not available.');
  await audit({ actor: req.user, action: 'APPLICANT_RESUME_VIEWED', entity: 'JobApplication', entityId: a.id, meta: { candidate: a.candidateName }, req });
  res.download(file, a.resumeName || 'resume');
});
