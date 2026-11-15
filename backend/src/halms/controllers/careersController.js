import { Op } from 'sequelize';
import { Job, Registration, todayStr } from '../models/index.js';
import { JobApplication } from '../models/jobApplication.js';
import { WalkInDrive, WalkInSlot, WalkInBooking } from '../models/walkin.js';
import { Interview } from '../models/interview.js';
import { interviewCode } from '../utils/interviewCode.js';
import { nowLocal, toMinutes } from '../utils/walkinPass.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str } from '../utils/helpers.js';
import { notifyOrgHR } from '../utils/notify.js';

/* Candidate-facing: apply to a company job, see own applications, withdraw. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validateAppId = (req, res, next, id) => (UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Not found.' }));

const STAGE_LABEL = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offered: 'Offered', hired: 'Hired', rejected: 'Not selected', withdrawn: 'Withdrawn', checkin: 'Checked in at walk-in' };

async function companyNames(orgIds) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const regs = ids.length ? await Registration.findAll({ where: { id: ids }, attributes: ['id', 'company'] }) : [];
  return Object.fromEntries(regs.map((r) => [r.id, r.company?.name || '']));
}

async function shape(apps) {
  const jobs = await Job.findAll({ where: { id: apps.map((a) => a.jobId) } });
  const jobById = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const names = await companyNames(apps.map((a) => a.orgId));

  // the walk-in interview of each application (if the candidate booked one)
  const bookings = apps.length ? await WalkInBooking.findAll({ where: { applicationId: apps.map((a) => a.id), status: { [Op.ne]: 'cancelled' } }, order: [['createdAt', 'DESC']] }) : [];
  const driveRows = bookings.length ? await WalkInDrive.findAll({ where: { id: [...new Set(bookings.map((b) => b.driveId))] } }) : [];
  const slotRows = bookings.length ? await WalkInSlot.findAll({ where: { id: [...new Set(bookings.map((b) => b.slotId))] } }) : [];
  const driveById = Object.fromEntries(driveRows.map((d) => [d.id, d]));
  const slotById = Object.fromEntries(slotRows.map((x) => [x.id, x]));
  const bookingByApp = {};
  bookings.forEach((b) => { if (!bookingByApp[b.applicationId]) bookingByApp[b.applicationId] = b; });
  const ivRows = apps.length ? await Interview.findAll({ where: { applicationId: apps.map((a) => a.id), status: { [Op.ne]: 'cancelled' } }, order: [['createdAt', 'DESC']] }) : [];
  const ivByApp = {};
  ivRows.forEach((i) => { if (!ivByApp[i.applicationId]) ivByApp[i.applicationId] = i; });
  const now = nowLocal();

  return apps.map((a) => {
    const j = jobById[a.jobId];
    const bk = bookingByApp[a.id];
    const dr = bk && driveById[bk.driveId];
    const sl = bk && slotById[bk.slotId];
    const walkIn = bk && dr ? {
      bookingId: bk.id, driveDate: dr.driveDate, venueName: dr.venueName, address: dr.address, mapLink: dr.mapLink || '',
      contactName: dr.contactName || '', contactPhone: dr.contactPhone || '', instructions: dr.instructions || '',
      startTime: sl?.startTime || '', endTime: sl?.endTime || '', checkedInAt: bk.checkedInAt,
      status: dr.status === 'cancelled' ? 'cancelled' : bk.status,
      missed: bk.status === 'booked' && dr.status !== 'cancelled' && (dr.driveDate < now.date || (dr.driveDate === now.date && sl && now.minutes > toMinutes(sl.endTime) + 30)),
    } : null;
    return {
      id: a.id, status: a.status, statusLabel: STAGE_LABEL[a.status], appliedAt: a.createdAt, updatedAt: a.updatedAt,
      coverNote: a.coverNote || '', walkIn,
      // the scheduled interview. The 6-digit code is shown only to the candidate, only until they are verified.
      interview: ivByApp[a.id] ? {
        id: ivByApp[a.id].id, date: ivByApp[a.id].date, startTime: ivByApp[a.id].startTime, durationMin: ivByApp[a.id].durationMin,
        mode: ivByApp[a.id].mode, location: ivByApp[a.id].location, instructions: ivByApp[a.id].instructions || '',
        interviewerName: ivByApp[a.id].interviewerName || '', status: ivByApp[a.id].status, verifiedAt: ivByApp[a.id].verifiedAt,
        code: ivByApp[a.id].status === 'scheduled' && !ivByApp[a.id].verifiedAt ? interviewCode(ivByApp[a.id]) : null,
      } : null,
      job: j ? { id: j.id, title: j.title, jobCode: j.jobCode, location: j.location, workMode: j.workMode, employmentType: j.employmentType, company: names[a.orgId] || '' } : null,
      // only what the candidate is meant to read: stage + the message the company chose to send
      history: (a.history || []).map((h) => ({ stage: h.stage, label: STAGE_LABEL[h.stage] || h.stage, at: h.at, message: h.message || '' })),
    };
  });
}

export const myApplications = asyncHandler(async (req, res) => {
  const rows = await JobApplication.findAll({ where: { candidateUserId: req.candidate.id }, order: [['updatedAt', 'DESC']], limit: 200 });
  res.json({ items: await shape(rows) });
});

export const applyToJob = asyncHandler(async (req, res) => {
  const c = req.candidate;
  if (c.applicantStatus !== 'APPROVED') throw new HttpError(403, 'Your account is not approved yet.');
  if (!UUID_RE.test(req.params.jobId)) throw new HttpError(404, 'Job not found.');
  if (req.body?.consent !== true) throw new HttpError(400, 'Please agree to share your profile and resume with the company.');
  const coverNote = str(req.body?.coverNote, 1000);

  const job = await Job.findOne({ where: { id: req.params.jobId, status: 'published', lastDate: { [Op.gte]: todayStr() } } });
  if (!job) throw new HttpError(404, 'This job is no longer open.');
  // a walk-in job is applied for by booking a time slot (that also creates the application and the QR pass)
  if (await WalkInDrive.findOne({ where: { jobId: job.id, status: 'open' }, attributes: ['id'] })) {
    throw new HttpError(409, 'This job is a walk-in drive. Choose a time slot to apply: you will get your QR pass right away.');
  }

  const snapshot = {
    candidateName: c.name, candidateEmail: c.email, candidatePhone: c.phone || null,
    city: c.city || null, state: c.state || null, qualification: c.qualification || null, college: c.college || null,
    skills: c.skills || null, expYears: c.expYears ?? null, currentCompany: c.currentCompany || null,
    expectedSalary: c.expectedSalary ?? null, linkedin: c.linkedin || null,
    resumePath: c.resumePath || null, resumeName: c.resumeName || null, coverNote: coverNote || null,
  };

  const existing = await JobApplication.findOne({ where: { jobId: job.id, candidateUserId: c.id } });
  let app;
  if (existing) {
    if (existing.status !== 'withdrawn') throw new HttpError(409, 'You have already applied for this job.');
    // applying again after withdrawing: reopen the same application
    await existing.update({ ...snapshot, status: 'applied', history: [...existing.history, { stage: 'applied', at: new Date().toISOString(), by: 'Candidate', message: 'Applied again' }] });
    app = existing;
  } else {
    app = await JobApplication.create({
      jobId: job.id, orgId: job.orgId, candidateUserId: c.id, ...snapshot,
      history: [{ stage: 'applied', at: new Date().toISOString(), by: 'Candidate', message: '' }],
    });
  }

  await notifyOrgHR(job.orgId, {
    type: 'applicant', title: `New applicant: ${c.name}`, body: `Applied for ${job.title} (${job.jobCode}).`, link: `/applicants?app=${app.id}`,
  }, [job.createdById]);

  const [item] = await shape([app]);
  res.status(201).json(item);
});

export const withdrawApplication = asyncHandler(async (req, res) => {
  const app = await JobApplication.findOne({ where: { id: req.params.id, candidateUserId: req.candidate.id } });
  if (!app) throw new HttpError(404, 'Application not found.');
  if (['withdrawn', 'hired'].includes(app.status)) throw new HttpError(409, `This application is already ${app.status}.`);
  // the candidate is out: free their walk-in seat too, so the QR stops working
  await WalkInBooking.update({ status: 'cancelled', cancelledAt: new Date() }, { where: { applicationId: app.id, status: 'booked' } });
  await app.update({ status: 'withdrawn', history: [...app.history, { stage: 'withdrawn', at: new Date().toISOString(), by: 'Candidate', message: '' }] });
  const job = await Job.findByPk(app.jobId, { attributes: ['title', 'createdById'] });
  await notifyOrgHR(app.orgId, { type: 'applicant', title: `${app.candidateName} withdrew`, body: `Withdrew the application for ${job?.title || 'a job'}.`, link: `/applicants?app=${app.id}` }, job ? [job.createdById] : []);
  const [item] = await shape([app]);
  res.json(item);
});
