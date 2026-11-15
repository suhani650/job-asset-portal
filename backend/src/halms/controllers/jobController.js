import fsp from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { Job, User, Registration, todayStr } from '../models/index.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { JD_DIR, looksLikeDocument } from '../middleware/uploadJd.js';
import { str, audit } from '../utils/helpers.js';
import { sequelize } from '../config/db.js';
import { JobApplication } from '../models/jobApplication.js';
import { WalkInDrive } from '../models/walkin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['onsite', 'hybrid', 'remote'];
const TYPES = ['full_time', 'part_time', 'internship', 'contract'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const validateJobId = (req, res, next, id) =>
  UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Job not found.' });

/* ---------- helpers ---------- */
const bad = (msg) => new HttpError(400, msg);

function int(v, name, { min, max, optional = false }) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw bad(`${name} is required.`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}

function cleanSkills(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw bad('Skills must be a list.');
  const seen = new Map(); // case-insensitive de-duplication
  v.map((s) => str(s, 40)).filter(Boolean).forEach((s) => { if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s); });
  const out = [...seen.values()];
  if (out.length > 20) throw bad('You can add up to 20 skills.');
  return out;
}

// Validates only the fields that are present (so PATCH works) and returns clean values.
function parseJob(b, { requireCore }) {
  const out = {};
  const text = (key, label, min, max, required) => {
    if (b[key] === undefined && !required) return;
    const v = str(b[key], max);
    if (required && v.length < min) throw bad(`${label} must be at least ${min} characters.`);
    if (v && v.length < min) throw bad(`${label} must be at least ${min} characters.`);
    out[key] = v || null;
  };
  text('title', 'Job title', 3, 120, requireCore || b.title !== undefined);
  text('department', 'Department', 2, 80, requireCore || b.department !== undefined);
  text('location', 'Location', 2, 80, requireCore || b.location !== undefined);
  text('education', 'Education', 2, 120, false);
  text('description', 'Description', 30, 5000, false);
  text('responsibilities', 'Responsibilities', 10, 3000, false);
  text('requirements', 'Requirements', 10, 3000, false);

  if (b.workMode !== undefined) {
    if (!MODES.includes(b.workMode)) throw bad('Invalid work mode.');
    out.workMode = b.workMode;
  }
  if (b.employmentType !== undefined) {
    if (!TYPES.includes(b.employmentType)) throw bad('Invalid employment type.');
    out.employmentType = b.employmentType;
  }
  if (b.openings !== undefined) out.openings = int(b.openings, 'Openings', { min: 1, max: 500 });
  if (b.experienceMin !== undefined) out.experienceMin = int(b.experienceMin, 'Minimum experience', { min: 0, max: 40 });
  if (b.experienceMax !== undefined) out.experienceMax = int(b.experienceMax, 'Maximum experience', { min: 0, max: 50, optional: true });
  if (b.salaryMin !== undefined) out.salaryMin = int(b.salaryMin, 'Minimum salary', { min: 0, max: 100000000, optional: true });
  if (b.salaryMax !== undefined) out.salaryMax = int(b.salaryMax, 'Maximum salary', { min: 0, max: 100000000, optional: true });
  if (b.probationMonths !== undefined) out.probationMonths = int(b.probationMonths, 'Probation months', { min: 0, max: 6 });
  for (const k of ['salaryVisible', 'trainingProvided', 'serviceAgreement']) {
    if (b[k] !== undefined) out[k] = b[k] === true;
  }
  const skills = cleanSkills(b.skills);
  if (skills !== undefined) out.skills = skills;
  if (b.lastDate !== undefined) {
    if (b.lastDate === '' || b.lastDate === null) out.lastDate = null;
    else {
      if (!DATE_RE.test(b.lastDate) || Number.isNaN(Date.parse(b.lastDate))) throw bad('Enter a valid last date.');
      out.lastDate = b.lastDate;
    }
  }
  return out;
}

// Checks that must pass on the final merged job before it can go live.
function assertPublishable(j) {
  if (!j.description || j.description.length < 30) throw bad('Add a job description (min 30 characters) before publishing.');
  if (!j.lastDate) throw bad('Set the last date to apply before publishing.');
  const today = todayStr();
  if (j.lastDate < today) throw bad('The last date is in the past. Set a future date.');
  const max = new Date(); max.setFullYear(max.getFullYear() + 1);
  if (j.lastDate > max.toISOString().slice(0, 10)) throw bad('Last date can be at most 1 year from today.');
}

function assertRanges(j) {
  if (j.experienceMax != null && j.experienceMax < (j.experienceMin ?? 0)) throw bad('Maximum experience cannot be less than minimum.');
  if (j.salaryMin != null && j.salaryMax != null && j.salaryMax < j.salaryMin) throw bad('Maximum salary cannot be less than minimum.');
}

// Company isolation: HR / Recruiter only touch their own company's jobs. Super Admin can view all.
function orgWhere(req) {
  if (req.user.role === ROLES.SUPER_ADMIN) return {};
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return { orgId: req.user.registrationId };
}

async function findJob(req, id = req.params.id) {
  const job = await Job.findOne({
    where: { id, ...orgWhere(req) },
    include: [{ model: User, as: 'creator', attributes: ['name'] }],
  });
  if (!job) throw new HttpError(404, 'Job not found.');
  return job;
}

async function nextCode() {
  const year = new Date().getFullYear();
  const n = await Job.count({ where: { jobCode: { [Op.like]: `JOB-${year}-%` } } });
  return `JOB-${year}-${String(n + 1).padStart(3, '0')}`;
}

async function createWithCode(data) {
  for (let i = 0; i < 4; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await Job.create({ ...data, jobCode: await nextCode() });
    } catch (e) {
      if (e.name !== 'SequelizeUniqueConstraintError' || i === 3) throw e;
    }
  }
  return null;
}

/* ---------- handlers ---------- */

export const listJobs = asyncHandler(async (req, res) => {
  const base = orgWhere(req);
  const where = { ...base };
  const wanted = req.query.status;
  if (['draft', 'published', 'closed', 'archived'].includes(wanted)) where.status = wanted;
  else where.status = { [Op.ne]: 'archived' };
  const q = str(req.query.q, 60);
  if (q) {
    const like = { [Op.like]: `%${q.replace(/[%_]/g, '')}%` };
    where[Op.or] = [{ title: like }, { department: like }, { location: like }, { jobCode: like }];
  }
  const [rows, archived] = await Promise.all([
    Job.findAll({ where, include: [{ model: User, as: 'creator', attributes: ['name'] }], order: [['createdAt', 'DESC']], limit: 300 }),
    Job.count({ where: { ...base, status: 'archived' } }),
  ]);
  const perJob = rows.length
    ? await JobApplication.findAll({ attributes: ['jobId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where: { jobId: rows.map((j) => j.id), status: { [Op.ne]: 'withdrawn' } }, group: ['jobId'], raw: true })
    : [];
  const counts = Object.fromEntries(perJob.map((r) => [r.jobId, Number(r.n)]));
  const drives = rows.length ? await WalkInDrive.findAll({ where: { jobId: rows.map((j) => j.id), status: 'open' }, attributes: ['jobId', 'driveDate', 'venueName'] }) : [];
  const driveByJob = Object.fromEntries(drives.map((d) => [d.jobId, { driveDate: d.driveDate, venueName: d.venueName }]));
  res.json({ items: rows.map((j) => ({ ...j.toClient(), applicants: counts[j.id] || 0, walkIn: driveByJob[j.id] || null })), archivedCount: archived });
});

export const getJob = asyncHandler(async (req, res) => {
  res.json((await findJob(req)).toClient());
});

export const createJob = asyncHandler(async (req, res) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  const data = parseJob(req.body || {}, { requireCore: true });
  assertRanges(data);
  const publish = req.body?.publish === true;
  if (publish) assertPublishable(data);

  const job = await createWithCode({
    ...data,
    orgId: req.user.registrationId,
    createdById: req.user.id,
    status: publish ? 'published' : 'draft',
    publishedAt: publish ? new Date() : null,
  });
  await audit({ actor: req.user, action: publish ? 'JOB_PUBLISHED' : 'JOB_CREATED', entity: 'Job', entityId: job.id, meta: { title: job.title, code: job.jobCode }, req });
  res.status(201).json((await findJob(req, job.id)).toClient());
});

export const updateJob = asyncHandler(async (req, res) => {
  const job = await findJob(req);
  if (job.status === 'archived') throw new HttpError(409, 'Restore this job before editing it.');
  const data = parseJob(req.body || {}, { requireCore: false });
  const merged = { ...job.get({ plain: true }), ...data };
  assertRanges(merged);
  if (job.status === 'published') assertPublishable(merged); // a live job must stay valid
  await job.update(data);
  await audit({ actor: req.user, action: 'JOB_UPDATED', entity: 'Job', entityId: job.id, meta: { fields: Object.keys(data) }, req });
  res.json((await findJob(req)).toClient());
});

const TRANSITIONS = {
  publish: { from: ['draft'], to: 'published' },
  close: { from: ['published'], to: 'closed' },
  reopen: { from: ['closed'], to: 'published' },
  archive: { from: ['draft', 'published', 'closed'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
};

export const setJobStatus = asyncHandler(async (req, res) => {
  const action = req.body?.action;
  const t = TRANSITIONS[action];
  if (!t) throw bad('Invalid action.');
  const job = await findJob(req);
  if (!t.from.includes(job.status)) throw new HttpError(409, `You cannot ${action} a job that is ${job.status}.`);
  if (t.to === 'published') assertPublishable(job.get({ plain: true }));

  const patch = { status: t.to };
  if (t.to === 'published') { patch.publishedAt = job.publishedAt || new Date(); patch.closedAt = null; }
  if (t.to === 'closed') patch.closedAt = new Date();
  await job.update(patch);
  await audit({ actor: req.user, action: `JOB_${action.toUpperCase()}`, entity: 'Job', entityId: job.id, meta: { title: job.title, code: job.jobCode }, req });
  res.json((await findJob(req)).toClient());
});

/* ---------- JD file ---------- */

export const uploadJd = asyncHandler(async (req, res) => {
  if (!req.file) throw bad('Choose a PDF, DOC or DOCX file.');
  let job;
  try {
    job = await findJob(req);
    if (job.status === 'archived') throw new HttpError(409, 'Restore this job before editing it.');
    if (!(await looksLikeDocument(req.file.path))) throw bad('This file is not a valid PDF or Word document.');
  } catch (e) {
    await fsp.rm(req.file.path, { force: true });
    throw e;
  }
  const old = job.jdFile;
  const safeName = path.basename(req.file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 150);
  await job.update({ jdFile: req.file.filename, jdName: safeName });
  if (old) await fsp.rm(path.join(JD_DIR, path.basename(old)), { force: true });
  await audit({ actor: req.user, action: 'JOB_JD_UPLOADED', entity: 'Job', entityId: job.id, req });
  res.json((await findJob(req)).toClient());
});

export const removeJd = asyncHandler(async (req, res) => {
  const job = await findJob(req);
  const old = job.jdFile;
  if (old) {
    await job.update({ jdFile: null, jdName: null });
    await fsp.rm(path.join(JD_DIR, path.basename(old)), { force: true });
    await audit({ actor: req.user, action: 'JOB_JD_REMOVED', entity: 'Job', entityId: job.id, req });
  }
  res.json((await findJob(req)).toClient());
});

export const downloadJd = asyncHandler(async (req, res) => {
  const job = await findJob(req);
  if (!job.jdFile) throw new HttpError(404, 'No JD file.');
  res.download(path.join(JD_DIR, path.basename(job.jdFile)), job.jdName || 'job-description');
});

/* ---------- Public API (for the Candidate portal, no login) ---------- */

const publicShape = (j, company) => {
  const o = j.toClient();
  return {
    id: o.id, jobCode: o.jobCode, title: o.title, company: company || null,
    department: o.department, location: o.location, workMode: o.workMode, employmentType: o.employmentType,
    openings: o.openings, experienceMin: o.experienceMin, experienceMax: o.experienceMax,
    salaryMin: o.salaryVisible ? o.salaryMin : null, salaryMax: o.salaryVisible ? o.salaryMax : null,
    skills: o.skills, education: o.education, description: o.description,
    responsibilities: o.responsibilities, requirements: o.requirements,
    probationMonths: o.probationMonths, trainingProvided: o.trainingProvided, serviceAgreement: o.serviceAgreement,
    lastDate: o.lastDate, publishedAt: o.publishedAt,
  };
};
const liveWhere = () => ({ status: 'published', lastDate: { [Op.gte]: todayStr() } });

async function companyNames(jobs) {
  const ids = [...new Set(jobs.map((j) => j.orgId).filter(Boolean))];
  const regs = ids.length ? await Registration.findAll({ where: { id: ids }, attributes: ['id', 'company'] }) : [];
  return Object.fromEntries(regs.map((r) => [r.id, r.company?.name]));
}

export const publicList = asyncHandler(async (req, res) => {
  const where = liveWhere();
  const q = str(req.query.q, 60).replace(/[%_]/g, '');
  if (q) where[Op.or] = [{ title: { [Op.like]: `%${q}%` } }, { department: { [Op.like]: `%${q}%` } }, { location: { [Op.like]: `%${q}%` } }];
  if (TYPES.includes(req.query.type)) where.employmentType = req.query.type;
  if (MODES.includes(req.query.mode)) where.workMode = req.query.mode;
  const jobs = await Job.findAll({ where, order: [['publishedAt', 'DESC']], limit: 100 });
  const names = await companyNames(jobs);
  res.json(jobs.map((j) => publicShape(j, names[j.orgId])));
});

export const publicOne = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'Job not found.');
  const job = await Job.findOne({ where: { id: req.params.id, ...liveWhere() } });
  if (!job) throw new HttpError(404, 'Job not found.');
  const names = await companyNames([job]);
  res.json(publicShape(job, names[job.orgId]));
});
