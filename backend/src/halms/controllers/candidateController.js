import fsp from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { Candidate, CandidateShortlist } from '../models/candidate.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { RESUME_DIR } from '../middleware/uploadResume.js';
import { looksLikeDocument } from '../middleware/uploadJd.js';
import { str, audit } from '../utils/helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-\s]{7,15}$/;
export const EDUCATION = ['Below 12th', '12th Pass', 'Diploma', 'Graduate', 'Post Graduate', 'Doctorate'];
const WORK_MODES = ['onsite', 'hybrid', 'remote', 'any'];
const bad = (msg) => new HttpError(400, msg);

export const validateCandidateId = (req, res, next, id) =>
  UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Candidate not found.' });

const orgOf = (req) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return req.user.registrationId;
};

/* ======================= helpers ======================= */
function toList(v, max, itemMax) {
  let arr = v;
  if (arr === undefined || arr === null || arr === '') return [];
  if (typeof arr === 'string') {
    const t = arr.trim();
    if (t.startsWith('[')) {
      try { arr = JSON.parse(t); } catch { throw bad('Invalid list format.'); }
    } else arr = t.split(',');
  }
  if (!Array.isArray(arr)) throw bad('Invalid list format.');
  const seen = new Map(); // case-insensitive de-duplication
  arr.map((s) => str(s, itemMax)).filter(Boolean).forEach((s) => { if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s); });
  const out = [...seen.values()];
  if (out.length > max) throw bad(`You can add up to ${max} items in a list.`);
  return out;
}

function toInt(v, name, { min, max, optional = false, fallback = null }) {
  if (v === undefined || v === null || v === '') {
    if (optional) return fallback;
    throw bad(`${name} is required.`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}

const maskEmail = (e) => { const [l, d] = String(e).split('@'); return `${l.slice(0, 1)}***@${d}`; };
const maskPhone = (p) => (p ? `XXXXXX${String(p).replace(/\D/g, '').slice(-4)}` : '');

// Contact details and resume are hidden until the company shortlists the candidate.
function shape(c, unlocked) {
  return {
    id: c.id, name: c.name,
    email: unlocked ? c.email : maskEmail(c.email),
    phone: unlocked ? c.phone || '' : maskPhone(c.phone),
    contactVisible: unlocked,
    city: c.city || '', state: c.state || '', currentTitle: c.currentTitle || '',
    experienceYears: c.experienceYears, education: c.education || '',
    skills: c.skills || [], expectedSalary: c.expectedSalary, noticeDays: c.noticeDays,
    preferredLocations: c.preferredLocations || [], workMode: c.workMode,
    languages: c.languages || [], summary: c.summary || '',
    hasResume: !!c.resumeFile, shortlisted: unlocked, createdAt: c.createdAt,
  };
}

const lit = (sql) => sequelize.literal(sql);
const esc = (s) => sequelize.escape(s);
const cleanTerm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 .+#/-]/g, '').trim().slice(0, 40);

/* ======================= PUBLIC: candidate portal creates a profile ======================= */
export const registerCandidate = asyncHandler(async (req, res) => {
  const file = req.file;
  const discard = () => (file ? fsp.rm(file.path, { force: true }) : Promise.resolve());
  try {
    const b = req.body || {};
    const name = str(b.name, 100);
    if (name.length < 2) throw bad('Name is required.');
    const email = str(b.email, 150).toLowerCase();
    if (!EMAIL_RE.test(email)) throw bad('A valid email is required.');
    const phone = str(b.phone, 20);
    if (!PHONE_RE.test(phone)) throw bad('A valid phone number is required.');
    const city = str(b.city, 80);
    if (city.length < 2) throw bad('City is required.');
    if (!EDUCATION.includes(b.education)) throw bad('Choose a valid education level.');
    const experienceYears = toInt(b.experienceYears, 'Experience', { min: 0, max: 50 });
    const skills = toList(b.skills, 20, 40);
    if (skills.length < 1) throw bad('Add at least one skill.');
    const workMode = b.workMode === undefined || b.workMode === '' ? 'any' : b.workMode;
    if (!WORK_MODES.includes(workMode)) throw bad('Invalid work mode.');
    if (!(b.consent === true || b.consent === 'true')) throw bad('Candidate consent is required.');

    if (file && !(await looksLikeDocument(file.path))) throw bad('The resume file looks invalid. Upload a real PDF, DOC or DOCX.');
    // Never overwrite an existing profile by email: anyone could do that.
    if (await Candidate.count({ where: { email } })) throw new HttpError(409, 'A profile with this email already exists.');

    const c = await Candidate.create({
      name, email, phone, city, state: str(b.state, 80) || null,
      currentTitle: str(b.currentTitle, 100) || null,
      experienceYears, education: b.education,
      skills, skillsKey: skills.map((s) => s.toLowerCase()),
      expectedSalary: toInt(b.expectedSalary, 'Expected salary', { min: 0, max: 100000000, optional: true }),
      noticeDays: toInt(b.noticeDays, 'Notice period', { min: 0, max: 180, optional: true, fallback: 0 }),
      preferredLocations: toList(b.preferredLocations, 5, 80),
      workMode, languages: toList(b.languages, 8, 30),
      summary: str(b.summary, 600) || null,
      resumeFile: file?.filename || null,
      resumeName: file ? file.originalname.slice(0, 200) : null,
      consentAt: new Date(),
    });
    res.status(201).json({ message: 'Profile created.', id: c.id });
  } catch (err) {
    await discard();
    throw err;
  }
});

/* ======================= COMPANY: search ======================= */
export const searchCandidates = asyncHandler(async (req, res) => {
  const orgId = orgOf(req);
  const q = req.query;
  const and = [{ status: 'active' }];

  const text = str(q.q, 80);
  if (text) {
    const like = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
    and.push({
      [Op.or]: [
        { name: { [Op.like]: like } },
        { currentTitle: { [Op.like]: like } },
        { city: { [Op.like]: like } },
        lit(`LOWER(CAST(Candidate.skillsKey AS CHAR)) LIKE LOWER(${esc(like)})`),
      ],
    });
  }

  // Skills: "react" also matches "react native" (starts-with match on each skill)
  const terms = str(q.skills, 300).split(',').map(cleanTerm).filter(Boolean).slice(0, 10);
  if (terms.length) {
    const conds = terms.map((t) => lit(`LOWER(CAST(Candidate.skillsKey AS CHAR)) LIKE LOWER(${esc(`%"${t}%`)})`));
    and.push(q.skillMatch === 'all' ? { [Op.and]: conds } : { [Op.or]: conds });
  }

  const expMin = q.expMin !== undefined && q.expMin !== '' ? Number(q.expMin) : null;
  const expMax = q.expMax !== undefined && q.expMax !== '' ? Number(q.expMax) : null;
  if (Number.isFinite(expMin) && expMin !== null) and.push({ experienceYears: { [Op.gte]: expMin } });
  if (Number.isFinite(expMax) && expMax !== null) and.push({ experienceYears: { [Op.lte]: expMax } });

  const edu = str(q.education, 200).split(',').map((s) => s.trim()).filter((s) => EDUCATION.includes(s));
  if (edu.length) and.push({ education: { [Op.in]: edu } });

  const loc = str(q.location, 80);
  if (loc) {
    const like = `%${loc.replace(/[\\%_]/g, '\\$&')}%`;
    and.push({ [Op.or]: [{ city: { [Op.like]: like } }, lit(`LOWER(CAST(Candidate.preferredLocations AS CHAR)) LIKE LOWER(${esc(like)})`)] });
  }

  const salaryMax = Number(q.salaryMax);
  if (q.salaryMax && Number.isFinite(salaryMax)) {
    // candidates who did not state an expectation are kept
    and.push({ [Op.or]: [{ expectedSalary: { [Op.lte]: salaryMax } }, { expectedSalary: null }] });
  }

  const notice = Number(q.noticeMax);
  if (q.noticeMax !== undefined && q.noticeMax !== '' && Number.isFinite(notice)) and.push({ noticeDays: { [Op.lte]: notice } });

  if (WORK_MODES.includes(q.workMode) && q.workMode !== 'any') and.push({ workMode: { [Op.in]: [q.workMode, 'any'] } });

  const lang = cleanTerm(str(q.language, 30));
  if (lang) and.push(lit(`LOWER(CAST(Candidate.languages AS CHAR)) LIKE LOWER(${esc(`%"${lang}%`)})`));

  if (q.shortlisted === 'true') {
    const rows = await CandidateShortlist.findAll({ where: { orgId }, attributes: ['candidateId'] });
    and.push({ id: { [Op.in]: rows.map((r) => r.candidateId) } });
  }

  const order = {
    experience: [['experienceYears', 'DESC'], ['createdAt', 'DESC']],
    salary: [['expectedSalary', 'ASC NULLS LAST'], ['createdAt', 'DESC']],
  }[q.sort] || [['createdAt', 'DESC']];

  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 12, 1), 50);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);

  const { rows, count } = await Candidate.findAndCountAll({
    where: { [Op.and]: and }, order, limit, offset: (page - 1) * limit,
  });
  const marks = rows.length
    ? await CandidateShortlist.findAll({ where: { orgId, candidateId: { [Op.in]: rows.map((r) => r.id) } } })
    : [];
  const unlocked = new Set(marks.map((m) => m.candidateId));

  res.json({
    items: rows.map((c) => shape(c, unlocked.has(c.id))),
    total: count, page, pages: Math.max(Math.ceil(count / limit), 1),
  });
});

/* ======================= COMPANY: one candidate, shortlist, resume ======================= */
async function loadOne(req) {
  const orgId = orgOf(req);
  const c = await Candidate.findOne({ where: { id: req.params.id, status: 'active' } });
  if (!c) throw new HttpError(404, 'Candidate not found.');
  const mark = await CandidateShortlist.findOne({ where: { orgId, candidateId: c.id } });
  return { c, orgId, unlocked: !!mark };
}

export const getCandidate = asyncHandler(async (req, res) => {
  const { c, unlocked } = await loadOne(req);
  res.json(shape(c, unlocked));
});

export const shortlist = asyncHandler(async (req, res) => {
  const { c, orgId } = await loadOne(req);
  await CandidateShortlist.findOrCreate({
    where: { orgId, candidateId: c.id }, defaults: { shortlistedById: req.user.id },
  });
  await audit({ actor: req.user, action: 'CANDIDATE_SHORTLISTED', entity: 'Candidate', entityId: c.id, meta: { name: c.name }, req });
  res.json(shape(c, true));
});

export const removeShortlist = asyncHandler(async (req, res) => {
  const { c, orgId } = await loadOne(req);
  await CandidateShortlist.destroy({ where: { orgId, candidateId: c.id } });
  await audit({ actor: req.user, action: 'CANDIDATE_SHORTLIST_REMOVED', entity: 'Candidate', entityId: c.id, meta: { name: c.name }, req });
  res.json(shape(c, false));
});

export const downloadResume = asyncHandler(async (req, res) => {
  const { c, unlocked } = await loadOne(req);
  if (!unlocked) throw new HttpError(403, 'Shortlist this candidate to download the resume.');
  if (!c.resumeFile) throw new HttpError(404, 'This candidate has not uploaded a resume.');
  await audit({ actor: req.user, action: 'CANDIDATE_RESUME_VIEWED', entity: 'Candidate', entityId: c.id, req });
  res.download(path.join(RESUME_DIR, path.basename(c.resumeFile)), c.resumeName || 'resume');
});