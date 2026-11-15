import { Op } from 'sequelize';
import { User, Job, AuditLog, Registration } from '../models/index.js';
import { CandidateShortlist } from '../models/candidate.js';
import { JobApplication } from '../models/jobApplication.js';
import { WalkInDrive } from '../models/walkin.js';
import { Interview } from '../models/interview.js';
import { Employee } from '../models/employee.js';
import { nowLocal } from '../utils/walkinPass.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';

/* Real numbers for the dashboard of every company role. Only this company's data.
   Owner       -> the whole company (team, hiring, employees, interviews)
   HR Manager  -> hiring and the team they manage
   Recruiter   -> only the jobs the recruiter created, and what happens on them
   Trainer / Employee -> a small welcome (no hiring numbers) */
export const clientOverview = asyncHandler(async (req, res) => {
  const orgId = req.user.registrationId;
  if (!orgId) throw new HttpError(403, 'Your account is not linked to a company.');
  const role = req.user.role;
  const company = await Registration.findByPk(orgId, { attributes: ['company'] });
  const companyName = company?.company?.name || '';

  if (role === ROLES.TRAINER || role === ROLES.EMPLOYEE) {
    return res.json({ role, companyName, simple: true, profileDone: !!(req.user.phone && req.user.designation), photoDone: !!req.user.avatarFile });
  }

  const today = nowLocal().date;
  const mine = role === ROLES.RECRUITER; // a recruiter sees only their own jobs
  const jobScope = mine ? { orgId, createdById: req.user.id } : { orgId };
  const myJobs = mine ? (await Job.findAll({ where: jobScope, attributes: ['id'] })).map((j) => j.id) : null;
  const appScope = mine ? { orgId, jobId: { [Op.in]: myJobs.length ? myJobs : ['00000000-0000-0000-0000-000000000000'] } } : { orgId };
  const ivScope = mine ? { orgId, jobId: appScope.jobId } : { orgId };

  const [live, drafts, closed, openings, team, shortlisted, members, funnelRows, drivesToday, ivRows, empRows, teamRows] = await Promise.all([
    Job.count({ where: { ...jobScope, status: 'published', lastDate: { [Op.gte]: today } } }),
    Job.count({ where: { ...jobScope, status: 'draft' } }),
    Job.count({ where: { ...jobScope, [Op.or]: [{ status: 'closed' }, { status: 'published', lastDate: { [Op.lt]: today } }] } }),
    Job.sum('openings', { where: { ...jobScope, status: 'published', lastDate: { [Op.gte]: today } } }),
    User.count({ where: { registrationId: orgId, role: { [Op.in]: [ROLES.RECRUITER, ROLES.TRAINER, ROLES.EMPLOYEE] } } }),
    CandidateShortlist.count({ where: { orgId } }),
    User.findAll({ where: { registrationId: orgId }, attributes: ['id'] }),
    JobApplication.findAll({ where: { ...appScope, status: { [Op.ne]: 'withdrawn' } }, attributes: ['status'], raw: true }),
    WalkInDrive.count({ where: { ...(mine ? { orgId, jobId: appScope.jobId } : { orgId }), driveDate: today, status: 'open' } }),
    Interview.findAll({ where: { ...ivScope, status: 'scheduled', date: { [Op.gte]: today } }, order: [['date', 'ASC'], ['startTime', 'ASC']], limit: 100 }),
    mine ? [] : Employee.findAll({ where: { orgId }, attributes: ['status'], raw: true }),
    mine ? [] : User.findAll({ where: { registrationId: orgId }, attributes: ['role'], raw: true }),
  ]);

  const funnel = { applied: 0, screening: 0, interview: 0, offered: 0, hired: 0, rejected: 0 };
  funnelRows.forEach((r) => { funnel[r.status] = (funnel[r.status] || 0) + 1; });
  const applicants = funnelRows.length;
  const jobTitles = ivRows.length ? Object.fromEntries((await Job.findAll({ where: { id: [...new Set(ivRows.map((i) => i.jobId))] }, attributes: ['id', 'title'] })).map((j) => [j.id, j.title])) : {};
  const interviewsToday = ivRows.filter((i) => i.date === today);

  const recent = members.length && !mine
    ? await AuditLog.findAll({ where: { actorId: { [Op.in]: members.map((m) => m.id) }, action: { [Op.notIn]: ['LOGIN'] } }, order: [['at', 'DESC']], limit: 8 })
    : mine
      ? await AuditLog.findAll({ where: { actorId: req.user.id, action: { [Op.notIn]: ['LOGIN'] } }, order: [['at', 'DESC']], limit: 8 })
      : [];

  const teamByRole = { owner: 0, hr_manager: 0, recruiter: 0, trainer: 0, employee: 0 };
  teamRows.forEach((r) => { if (teamByRole[r.role] !== undefined) teamByRole[r.role] += 1; });
  const employees = { total: empRows.length, probation: 0, active: 0, notice: 0, exited: 0 };
  empRows.forEach((r) => { employees[r.status] += 1; });

  const profile = req.user;
  res.json({
    role, scope: mine ? 'mine' : 'company', companyName,
    counts: {
      live, drafts, closed, openings: openings || 0, team, shortlisted, applicants, newApplicants: funnel.applied,
      interviewsToday: interviewsToday.length, interviewsUpcoming: ivRows.length, walkinsToday: drivesToday, employees: employees.total,
    },
    funnel, teamByRole: mine ? null : teamByRole, employees: mine ? null : employees,
    nextInterviews: ivRows.slice(0, 5).map((i) => ({ id: i.id, candidate: i.candidateName, job: jobTitles[i.jobId] || '', date: i.date, startTime: i.startTime, mode: i.mode, verified: !!i.verifiedAt })),
    checklist: {
      profileDone: !!(profile.phone && profile.designation),
      photoDone: !!profile.avatarFile,
      firstJob: live + drafts + closed > 0,
      teamMember: team > 0,
      hrManager: teamByRole.hr_manager > 0,
      shortlisted: shortlisted > 0,
      reviewedApplicant: applicants > 0 && funnel.applied < applicants,
      firstInterview: ivRows.length > 0 || funnel.interview > 0,
      firstEmployee: employees.total > 0,
    },
    recent: recent.map((a) => ({ id: a.id, action: a.action, actor: a.actorName, at: a.at, meta: a.meta || {} })),
  });
});
