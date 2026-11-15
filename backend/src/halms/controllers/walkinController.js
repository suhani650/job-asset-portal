import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { Job, Registration, todayStr } from '../models/index.js';
import { JobApplication } from '../models/jobApplication.js';
import { WalkInDrive, WalkInSlot, WalkInBooking } from '../models/walkin.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { str, audit } from '../utils/helpers.js';
import { notifyOrgHR, notifyCandidate } from '../utils/notify.js';
import { makeToken, readToken, nowLocal, toMinutes } from '../utils/walkinPass.js';
import { applyWalkInEvent } from '../utils/applicationSync.js';

/* Walk-in drives: the company sets date + time slots on a job, a candidate books a slot and gets a QR pass,
   and the company scans that QR at the gate. Everything here lives in NEW tables (walkin_*). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
const MAX_SLOTS = 12;
const EARLY_MIN = 60; // a pass can be scanned this many minutes before its slot starts
const LATE_MIN = 30;  // ... and this many minutes after it ends

export const validateUuid = (req, res, next, id) => (UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Not found.' }));

const bad = (msg) => new HttpError(400, msg);
const fmt12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const slotText = (s) => `${fmt12(s.startTime)} – ${fmt12(s.endTime)}`;
const dateText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const staffOrg = (req) => {
  if (!req.user.registrationId) throw new HttpError(403, 'Your account is not linked to a company.');
  return req.user.registrationId;
};
// Same-code JSON reply for scanner screens: { code, message, ...extra }
const refuse = (res, status, code, message, extra = {}) => res.status(status).json({ code, message, ...extra });

/* ---------------- shaping ---------------- */

async function loadCounts(driveIds) {
  if (!driveIds.length) return {};
  const rows = await WalkInBooking.findAll({
    attributes: ['driveId', 'slotId', 'status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    where: { driveId: driveIds },
    group: ['driveId', 'slotId', 'status'],
    raw: true,
  });
  const out = {};
  for (const r of rows) {
    const s = (out[r.slotId] ||= { booked: 0, checkedIn: 0, noShow: 0 });
    const n = Number(r.n);
    if (r.status !== 'cancelled') s.booked += n;
    if (r.status === 'checked_in') s.checkedIn += n;
    if (r.status === 'no_show') s.noShow += n;
  }
  return out;
}

function shapeDrive(d, slots, counts) {
  const list = slots.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => {
    const c = counts[s.id] || { booked: 0, checkedIn: 0, noShow: 0 };
    return {
      id: s.id, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity,
      booked: c.booked, checkedIn: c.checkedIn, noShow: c.noShow, seatsLeft: Math.max(0, s.capacity - c.booked),
    };
  });
  const totals = list.reduce((t, s) => ({
    capacity: t.capacity + s.capacity, booked: t.booked + s.booked, checkedIn: t.checkedIn + s.checkedIn, noShow: t.noShow + s.noShow,
  }), { capacity: 0, booked: 0, checkedIn: 0, noShow: 0 });
  return {
    id: d.id, jobId: d.jobId, driveDate: d.driveDate, venueName: d.venueName, address: d.address, mapLink: d.mapLink || '',
    contactName: d.contactName || '', contactPhone: d.contactPhone || '', instructions: d.instructions || '',
    status: d.status, slots: list, totals,
  };
}

async function fullDrive(drive) {
  const slots = await WalkInSlot.findAll({ where: { driveId: drive.id } });
  const counts = await loadCounts([drive.id]);
  return shapeDrive(drive, slots, counts);
}

async function companyNames(orgIds) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const regs = ids.length ? await Registration.findAll({ where: { id: ids }, attributes: ['id', 'company'] }) : [];
  return Object.fromEntries(regs.map((r) => [r.id, r.company?.name || '']));
}

/* ---------------- validation (company side) ---------------- */

function parseDrive(b, { isNew, currentDate }) {
  const today = nowLocal().date;
  if (!DATE_RE.test(b.driveDate || '') || Number.isNaN(Date.parse(b.driveDate))) throw bad('Choose the walk-in drive date.');
  if (b.driveDate < today && (isNew || b.driveDate !== currentDate)) throw bad('The drive date cannot be in the past.');
  const max = new Date(); max.setFullYear(max.getFullYear() + 1);
  if (b.driveDate > max.toISOString().slice(0, 10)) throw bad('The drive date can be at most 1 year from today.');

  const venueName = str(b.venueName, 160);
  const address = str(b.address, 400);
  if (venueName.length < 2) throw bad('Enter the venue name.');
  if (address.length < 5) throw bad('Enter the full venue address.');
  const mapLink = str(b.mapLink, 300);
  if (mapLink && !/^https?:\/\/\S+$/i.test(mapLink)) throw bad('Map link must start with http:// or https://');
  const contactPhone = str(b.contactPhone, 20);
  if (contactPhone && !PHONE_RE.test(contactPhone)) throw bad('Enter a valid contact phone number.');

  if (!Array.isArray(b.slots) || b.slots.length < 1) throw bad('Add at least one time slot.');
  if (b.slots.length > MAX_SLOTS) throw bad(`You can add up to ${MAX_SLOTS} slots.`);
  const slots = b.slots.map((s, i) => {
    const n = i + 1;
    if (!TIME_RE.test(s?.startTime || '') || !TIME_RE.test(s?.endTime || '')) throw bad(`Slot ${n}: choose a start and end time.`);
    if (toMinutes(s.startTime) >= toMinutes(s.endTime)) throw bad(`Slot ${n}: end time must be after the start time.`);
    const cap = Number(s.capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 5000) throw bad(`Slot ${n}: seats must be a whole number between 1 and 5000.`);
    const id = typeof s.id === 'string' && UUID_RE.test(s.id) ? s.id : null;
    return { id, startTime: s.startTime, endTime: s.endTime, capacity: cap };
  });
  const sorted = slots.slice().sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 1; i < sorted.length; i += 1) {
    if (toMinutes(sorted[i].startTime) < toMinutes(sorted[i - 1].endTime)) {
      throw bad(`Slots overlap: ${slotText(sorted[i - 1])} and ${slotText(sorted[i])}.`);
    }
  }
  return {
    drive: {
      driveDate: b.driveDate, venueName, address, mapLink: mapLink || null,
      contactName: str(b.contactName, 100) || null, contactPhone: contactPhone || null,
      instructions: str(b.instructions, 2000) || null,
    },
    slots,
  };
}

async function ownJob(req, jobId) {
  const job = await Job.findOne({ where: { id: jobId, orgId: staffOrg(req) } });
  if (!job) throw new HttpError(404, 'Job not found.');
  return job;
}
async function ownDrive(req, id) {
  const drive = await WalkInDrive.findOne({ where: { id, orgId: staffOrg(req) } });
  if (!drive) throw new HttpError(404, 'Walk-in drive not found.');
  return drive;
}

const activeBookings = (where, t) => WalkInBooking.findAll({ where: { ...where, status: { [Op.ne]: 'cancelled' } }, transaction: t });

/* ---------------- company: configure ---------------- */

export const getJobDrive = asyncHandler(async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  const drive = await WalkInDrive.findOne({ where: { jobId: job.id } });
  res.json({ drive: drive ? await fullDrive(drive) : null });
});

export const saveJobDrive = asyncHandler(async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  if (job.status === 'archived') throw new HttpError(409, 'Restore this job before editing it.');
  const existing = await WalkInDrive.findOne({ where: { jobId: job.id } });
  const { drive: data, slots } = parseDrive(req.body || {}, { isNew: !existing, currentDate: existing?.driveDate });

  const affected = []; // candidates who must hear about a change
  const result = await sequelize.transaction(async (t) => {
    let drive = existing;
    if (drive) {
      const same = ['driveDate', 'venueName', 'address', 'mapLink', 'contactName', 'contactPhone', 'instructions'].every((k) => (drive[k] || null) === (data[k] || null));
      if (!same) affected.push(...(await activeBookings({ driveId: drive.id }, t)));
      await drive.update({ ...data, status: 'open' }, { transaction: t });
    } else {
      drive = await WalkInDrive.create({ ...data, jobId: job.id, orgId: job.orgId, createdById: req.user.id }, { transaction: t });
    }

    const current = await WalkInSlot.findAll({ where: { driveId: drive.id }, transaction: t, lock: t.LOCK.UPDATE });
    const byId = Object.fromEntries(current.map((s) => [s.id, s]));
    const keep = new Set();

    for (const s of slots) {
      const old = s.id && byId[s.id];
      if (old) {
        const bookings = await activeBookings({ slotId: old.id }, t);
        if (s.capacity < bookings.length) throw new HttpError(409, `The slot ${slotText(old)} already has ${bookings.length} booked candidate${bookings.length > 1 ? 's' : ''}. Seats cannot go below that.`);
        if (old.startTime !== s.startTime || old.endTime !== s.endTime) affected.push(...bookings);
        await old.update({ startTime: s.startTime, endTime: s.endTime, capacity: s.capacity }, { transaction: t });
        keep.add(old.id);
      } else {
        const created = await WalkInSlot.create({ driveId: drive.id, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity }, { transaction: t });
        keep.add(created.id);
      }
    }
    for (const old of current) {
      if (keep.has(old.id)) continue;
      const bookings = await activeBookings({ slotId: old.id }, t);
      if (bookings.length) throw new HttpError(409, `The slot ${slotText(old)} has ${bookings.length} booked candidate${bookings.length > 1 ? 's' : ''}, so it cannot be removed.`);
      await WalkInBooking.destroy({ where: { slotId: old.id }, transaction: t }); // only cancelled rows can remain
      await old.destroy({ transaction: t });
    }
    return drive;
  });

  await audit({ actor: req.user, action: existing ? 'WALKIN_UPDATED' : 'WALKIN_CREATED', entity: 'Job', entityId: job.id, meta: { title: job.title, date: data.driveDate, slots: slots.length }, req });

  // Candidates can book only while the job is open, so the apply deadline may never be before the drive day.
  let lastDateExtended = false;
  if (!job.lastDate || job.lastDate < data.driveDate) {
    lastDateExtended = true;
    await job.update({ lastDate: data.driveDate });
  }

  // Every candidate with a seat hears about the change: bell + a line on their job application.
  const fresh = Object.fromEntries((await WalkInSlot.findAll({ where: { driveId: result.id } })).map((s) => [s.id, s]));
  const seen = new Set();
  for (const b of affected) {
    if (seen.has(b.id) || b.status !== 'booked') continue;
    seen.add(b.id);
    const sl = fresh[b.slotId];
    const when = `${dateText(result.driveDate)}${sl ? `, ${slotText(sl)}` : ''} at ${result.venueName}, ${result.address}`;
    await applyWalkInEvent(b.applicationId, { stage: 'interview', message: `Walk-in interview updated. New details: ${when}`, by: req.user.name });
    notifyCandidate(b.candidateUserId, 'Walk-in interview rescheduled', `${job.title}: the company updated your walk-in interview. New details: ${when}. Open Walk-in Passes to see your QR.`);
  }
  res.json({ drive: await fullDrive(result), lastDateExtended });
});

export const removeJobDrive = asyncHandler(async (req, res) => {
  const job = await ownJob(req, req.params.jobId);
  const drive = await WalkInDrive.findOne({ where: { jobId: job.id } });
  if (!drive) return res.json({ removed: false });

  const people = await activeBookings({ driveId: drive.id });
  await sequelize.transaction(async (t) => {
    if (people.length) {
      await WalkInBooking.update({ status: 'cancelled', cancelledAt: new Date() }, { where: { driveId: drive.id, status: { [Op.ne]: 'cancelled' } }, transaction: t });
      await drive.update({ status: 'cancelled' }, { transaction: t });
    } else {
      await WalkInBooking.destroy({ where: { driveId: drive.id }, transaction: t });
      await WalkInSlot.destroy({ where: { driveId: drive.id }, transaction: t });
      await drive.destroy({ transaction: t });
    }
  });
  for (const b of people) await applyWalkInEvent(b.applicationId, { stage: 'applied', status: 'applied', onlyFrom: ['interview'], message: `The company cancelled the walk-in drive on ${dateText(drive.driveDate)}. Your pass is no longer valid.`, by: req.user.name });
  people.forEach((b) => notifyCandidate(b.candidateUserId, 'Walk-in drive cancelled', `The walk-in drive for ${job.title} on ${dateText(drive.driveDate)} was cancelled by the company. Your pass is no longer valid.`));
  await audit({ actor: req.user, action: 'WALKIN_REMOVED', entity: 'Job', entityId: job.id, meta: { title: job.title, cancelledBookings: people.length }, req });
  res.json({ removed: !people.length, cancelled: people.length > 0 });
});

/* ---------------- company: dashboard + bookings ---------------- */

export const listDrives = asyncHandler(async (req, res) => {
  const orgId = staffOrg(req);
  const drives = await WalkInDrive.findAll({ where: { orgId }, order: [['driveDate', 'DESC']], limit: 200 });
  const ids = drives.map((d) => d.id);
  const [slots, counts, jobs] = await Promise.all([
    ids.length ? WalkInSlot.findAll({ where: { driveId: ids } }) : [],
    loadCounts(ids),
    drives.length ? Job.findAll({ where: { id: drives.map((d) => d.jobId) }, attributes: ['id', 'title', 'jobCode', 'status', 'location'] }) : [],
  ]);
  const jobById = Object.fromEntries(jobs.map((j) => [j.id, j]));
  res.json({
    today: nowLocal().date,
    items: drives.map((d) => {
      const j = jobById[d.jobId];
      return { ...shapeDrive(d, slots.filter((s) => s.driveId === d.id), counts), job: j ? { id: j.id, title: j.title, jobCode: j.jobCode, location: j.location } : null };
    }),
  });
});

export const driveBookings = asyncHandler(async (req, res) => {
  const drive = await ownDrive(req, req.params.id);
  const [rows, slots] = await Promise.all([
    WalkInBooking.findAll({ where: { driveId: drive.id, status: { [Op.ne]: 'cancelled' } }, order: [['createdAt', 'ASC']], limit: 5000 }),
    WalkInSlot.findAll({ where: { driveId: drive.id } }),
  ]);
  const slotById = Object.fromEntries(slots.map((s) => [s.id, s]));
  res.json({
    items: rows.map((b) => ({
      id: b.id, name: b.candidateName, email: b.candidateEmail, phone: b.candidatePhone || '', status: b.status,
      slot: slotById[b.slotId] ? { id: b.slotId, startTime: slotById[b.slotId].startTime, endTime: slotById[b.slotId].endTime } : null,
      checkedInAt: b.checkedInAt, checkInMethod: b.checkInMethod || '', applicationId: b.applicationId, bookedAt: b.createdAt,
    })),
  });
});

/* ---------------- company: gate scanning ---------------- */

function passSummary(b, slot, drive, job) {
  return {
    bookingId: b.id, name: b.candidateName, email: b.candidateEmail, phone: b.candidatePhone || '',
    job: job ? { title: job.title, jobCode: job.jobCode } : null,
    slot: slot ? { startTime: slot.startTime, endTime: slot.endTime } : null,
    driveDate: drive.driveDate, status: b.status, checkedInAt: b.checkedInAt,
  };
}

export const checkIn = asyncHandler(async (req, res) => {
  const orgId = staffOrg(req);
  const t = readToken(req.body?.token);
  if (!t) return refuse(res, 400, 'INVALID_QR', 'This is not a valid HALMS walk-in pass.');

  const b = await WalkInBooking.findByPk(t.id);
  if (!b) return refuse(res, 404, 'NOT_FOUND', 'No booking found for this pass.');
  const [drive, slot, job] = await Promise.all([WalkInDrive.findByPk(b.driveId), WalkInSlot.findByPk(b.slotId), Job.findByPk(b.jobId, { attributes: ['title', 'jobCode'] })]);
  if (!drive || b.orgId !== orgId) return refuse(res, 403, 'OTHER_COMPANY', 'This pass belongs to another company\u2019s drive.');

  const summary = passSummary(b, slot, drive, job);
  const appRow = b.applicationId ? await JobApplication.findByPk(b.applicationId, { attributes: ['status'] }) : null;
  if (appRow?.status === 'rejected') return refuse(res, 409, 'REJECTED', 'Your team rejected this application, so entry is not allowed.', { pass: summary });
  if (appRow?.status === 'withdrawn') return refuse(res, 409, 'WITHDRAWN', 'The candidate withdrew this application.', { pass: summary });
  if (req.body?.driveId && req.body.driveId !== drive.id) {
    return refuse(res, 409, 'WRONG_DRIVE', `This pass is for a different drive${job ? ` (${job.title})` : ''}.`, { pass: summary });
  }
  if (b.passVersion !== t.version) return refuse(res, 409, 'OLD_PASS', 'This is an old pass. The candidate booked again, so only their newest QR works.', { pass: summary });
  if (drive.status === 'cancelled') return refuse(res, 409, 'DRIVE_CANCELLED', 'This walk-in drive was cancelled.', { pass: summary });
  if (b.status === 'cancelled') return refuse(res, 409, 'CANCELLED', 'The candidate cancelled this booking.', { pass: summary });
  if (b.status === 'checked_in') return refuse(res, 409, 'ALREADY_CHECKED_IN', 'This pass was already used. Entry is allowed only once.', { pass: summary });

  const now = nowLocal();
  if (drive.driveDate !== now.date) {
    const early = drive.driveDate > now.date;
    return refuse(res, 409, 'WRONG_DATE', early ? `This drive is on ${dateText(drive.driveDate)}. Entry opens on that day.` : `This drive was on ${dateText(drive.driveDate)}. The pass has expired.`, { pass: summary });
  }
  let method = 'qr';
  if (slot) {
    const start = toMinutes(slot.startTime);
    const end = toMinutes(slot.endTime);
    if (now.minutes < start - EARLY_MIN || now.minutes > end + LATE_MIN) {
      if (req.body?.override !== true) {
        return refuse(res, 409, 'WRONG_SLOT', `This candidate booked ${slotText(slot)}. It is outside that time.`, { canOverride: true, pass: summary });
      }
      method = 'override';
    }
  }

  const [changed] = await WalkInBooking.update(
    { status: 'checked_in', checkedInAt: new Date(), checkedInById: req.user.id, checkInMethod: method },
    { where: { id: b.id, status: { [Op.in]: ['booked', 'no_show'] } } }
  );
  if (!changed) return refuse(res, 409, 'ALREADY_CHECKED_IN', 'This pass was just used.', { pass: summary });

  await b.reload();
  await audit({ actor: req.user, action: 'WALKIN_CHECKIN', entity: 'WalkInBooking', entityId: b.id, meta: { candidate: b.candidateName, method }, req });
  await applyWalkInEvent(b.applicationId, { stage: 'checkin', message: '', by: req.user.name });
  notifyCandidate(b.candidateUserId, 'Walk-in check-in done', `You are checked in for the walk-in drive${job ? ` for ${job.title}` : ''}. Good luck!`);
  res.json({ ok: true, code: 'OK', message: `${b.candidateName} is checked in.`, pass: passSummary(b, slot, drive, job) });
});

export const markBooking = asyncHandler(async (req, res) => {
  const orgId = staffOrg(req);
  const b = await WalkInBooking.findOne({ where: { id: req.params.id, orgId } });
  if (!b) throw new HttpError(404, 'Booking not found.');
  const drive = await WalkInDrive.findByPk(b.driveId);
  const action = req.body?.action;
  const today = nowLocal().date;

  if (action === 'check_in') {
    if (b.status === 'checked_in') throw new HttpError(409, 'Already checked in.');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled.');
    if (drive.status === 'cancelled') throw new HttpError(409, 'This drive was cancelled.');
    if (drive.driveDate !== today) throw new HttpError(409, 'Check-in is possible only on the drive date.');
    const appRow = b.applicationId ? await JobApplication.findByPk(b.applicationId, { attributes: ['status'] }) : null;
    if (appRow && ['rejected', 'withdrawn'].includes(appRow.status)) throw new HttpError(409, `This application is ${appRow.status}, so check-in is not allowed.`);
    await b.update({ status: 'checked_in', checkedInAt: new Date(), checkedInById: req.user.id, checkInMethod: 'manual' });
    await applyWalkInEvent(b.applicationId, { stage: 'checkin', message: '', by: req.user.name });
    notifyCandidate(b.candidateUserId, 'Walk-in check-in done', 'You are checked in for the walk-in drive. Good luck!');
  } else if (action === 'no_show') {
    if (b.status !== 'booked') throw new HttpError(409, 'Only a booked candidate can be marked as absent.');
    if (drive.driveDate > today) throw new HttpError(409, 'The drive has not started yet.');
    await b.update({ status: 'no_show' });
    await applyWalkInEvent(b.applicationId, { stage: 'interview', message: 'You were marked absent at the walk-in drive.', by: req.user.name });
  } else if (action === 'undo') {
    if (!['checked_in', 'no_show'].includes(b.status)) throw new HttpError(409, 'Nothing to undo.');
    await b.update({ status: 'booked', checkedInAt: null, checkedInById: null, checkInMethod: null });
    await applyWalkInEvent(b.applicationId, { stage: 'interview', message: 'The walk-in attendance entry was corrected.', by: req.user.name });
  } else {
    throw bad('Invalid action.');
  }
  await audit({ actor: req.user, action: `WALKIN_${action.toUpperCase()}`, entity: 'WalkInBooking', entityId: b.id, meta: { candidate: b.candidateName }, req });
  res.json({ id: b.id, status: b.status, checkedInAt: b.checkedInAt, checkInMethod: b.checkInMethod || '' });
});

/* ---------------- public (no login) ---------------- */

const liveJob = () => ({ status: 'published', lastDate: { [Op.gte]: todayStr() } });

function publicDrive(d, slots, counts) {
  const full = shapeDrive(d, slots, counts);
  const { date, minutes } = nowLocal();
  return {
    id: full.id, jobId: full.jobId, driveDate: full.driveDate, venueName: full.venueName, address: full.address,
    mapLink: full.mapLink, instructions: full.instructions, contactName: full.contactName, contactPhone: full.contactPhone,
    slots: full.slots.map((s) => ({
      id: s.id, startTime: s.startTime, endTime: s.endTime, seatsLeft: s.seatsLeft,
      over: full.driveDate < date || (full.driveDate === date && minutes >= toMinutes(s.endTime)),
    })),
  };
}

export const publicDriveList = asyncHandler(async (_req, res) => {
  const today = nowLocal().date;
  const drives = await WalkInDrive.findAll({ where: { status: 'open', driveDate: { [Op.gte]: today } }, limit: 500 });
  if (!drives.length) return res.json([]);
  const jobs = await Job.findAll({ where: { id: drives.map((d) => d.jobId), ...liveJob() }, attributes: ['id'] });
  const live = new Set(jobs.map((j) => j.id));
  const open = drives.filter((d) => live.has(d.jobId));
  const slots = open.length ? await WalkInSlot.findAll({ where: { driveId: open.map((d) => d.id) } }) : [];
  const counts = await loadCounts(open.map((d) => d.id));
  res.json(open.map((d) => {
    const p = publicDrive(d, slots.filter((s) => s.driveId === d.id), counts);
    return { jobId: d.jobId, driveDate: d.driveDate, venueName: d.venueName, seatsLeft: p.slots.filter((s) => !s.over).reduce((n, s) => n + s.seatsLeft, 0) };
  }));
});

export const publicJobDrive = asyncHandler(async (req, res) => {
  const drive = await WalkInDrive.findOne({ where: { jobId: req.params.jobId, status: 'open' } });
  if (!drive || drive.driveDate < nowLocal().date) return res.json({ drive: null });
  const job = await Job.findOne({ where: { id: drive.jobId, ...liveJob() }, attributes: ['id'] });
  if (!job) return res.json({ drive: null });
  const slots = await WalkInSlot.findAll({ where: { driveId: drive.id } });
  res.json({ drive: publicDrive(drive, slots, await loadCounts([drive.id])) });
});

/* ---------------- candidate ---------------- */

async function passShape(rows) {
  if (!rows.length) return [];
  const [drives, slots, jobs] = await Promise.all([
    WalkInDrive.findAll({ where: { id: [...new Set(rows.map((r) => r.driveId))] } }),
    WalkInSlot.findAll({ where: { id: [...new Set(rows.map((r) => r.slotId))] } }),
    Job.findAll({ where: { id: [...new Set(rows.map((r) => r.jobId))] }, attributes: ['id', 'title', 'jobCode', 'location', 'workMode', 'orgId'] }),
  ]);
  const names = await companyNames(jobs.map((j) => j.orgId));
  const dById = Object.fromEntries(drives.map((d) => [d.id, d]));
  const sById = Object.fromEntries(slots.map((s) => [s.id, s]));
  const jById = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const { date, minutes } = nowLocal();
  return rows.map((b) => {
    const d = dById[b.driveId];
    const s = sById[b.slotId];
    const j = jById[b.jobId];
    const cancelledDrive = d?.status === 'cancelled';
    const expired = !!d && b.status === 'booked' && (d.driveDate < date || (d.driveDate === date && s && minutes > toMinutes(s.endTime) + LATE_MIN));
    return {
      id: b.id, status: cancelledDrive ? 'cancelled' : b.status, expired, qr: b.status === 'booked' && !cancelledDrive ? makeToken(b.id, b.passVersion) : null,
      checkedInAt: b.checkedInAt, bookedAt: b.createdAt,
      slot: s ? { id: s.id, startTime: s.startTime, endTime: s.endTime } : null,
      drive: d ? { driveDate: d.driveDate, venueName: d.venueName, address: d.address, mapLink: d.mapLink || '', instructions: d.instructions || '', contactName: d.contactName || '', contactPhone: d.contactPhone || '' } : null,
      job: j ? { id: j.id, title: j.title, jobCode: j.jobCode, location: j.location, company: names[j.orgId] || '' } : null,
    };
  });
}

export const myPasses = asyncHandler(async (req, res) => {
  const rows = await WalkInBooking.findAll({ where: { candidateUserId: req.candidate.id, status: { [Op.ne]: 'cancelled' } }, order: [['createdAt', 'DESC']], limit: 100 });
  const items = await passShape(rows);
  // checked-in passes keep the QR hidden: it is already used
  res.json({ items: items.map((p) => (p.status === 'checked_in' ? { ...p, qr: null } : p)) });
});

export const bookSlot = asyncHandler(async (req, res) => {
  const c = req.candidate;
  if (c.applicantStatus !== 'APPROVED') throw new HttpError(403, 'Your account is not approved yet.');
  if (!UUID_RE.test(req.params.jobId)) throw new HttpError(404, 'Job not found.');
  const slotId = req.body?.slotId;
  if (typeof slotId !== 'string' || !UUID_RE.test(slotId)) throw bad('Please choose a time slot.');
  if (req.body?.consent !== true) throw bad('Please agree to share your profile and resume with the company.');
  const coverNote = str(req.body?.coverNote, 1000);

  const out = await sequelize.transaction(async (t) => {
    const job = await Job.findOne({ where: { id: req.params.jobId, ...liveJob() }, transaction: t });
    if (!job) throw new HttpError(404, 'This job is no longer open.');
    const drive = await WalkInDrive.findOne({ where: { jobId: job.id, status: 'open' }, transaction: t });
    if (!drive) throw new HttpError(404, 'There is no walk-in drive for this job.');
    const now = nowLocal();
    if (drive.driveDate < now.date) throw new HttpError(409, 'This walk-in drive is over.');

    // lock the slot row: two candidates can never take the last seat together
    const slot = await WalkInSlot.findOne({ where: { id: slotId, driveId: drive.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!slot) throw new HttpError(404, 'This slot does not exist.');
    if (drive.driveDate === now.date && now.minutes >= toMinutes(slot.endTime)) throw new HttpError(409, 'This slot is already over. Choose a later one.');

    const mine = await WalkInBooking.findOne({ where: { driveId: drive.id, candidateUserId: c.id }, transaction: t });
    if (mine && mine.status !== 'cancelled') {
      throw new HttpError(409, mine.status === 'checked_in' ? 'You have already attended this drive.' : 'You already have a pass for this drive. Cancel it first to choose another slot.');
    }
    const taken = await WalkInBooking.count({ where: { slotId: slot.id, status: { [Op.ne]: 'cancelled' } }, transaction: t });
    if (taken >= slot.capacity) throw new HttpError(409, 'This slot is full. Please choose another slot.');

    // the walk-in booking also applies to the job (same data the normal Apply button copies)
    const snapshot = {
      candidateName: c.name, candidateEmail: c.email, candidatePhone: c.phone || null,
      city: c.city || null, state: c.state || null, qualification: c.qualification || null, college: c.college || null,
      skills: c.skills || null, expYears: c.expYears ?? null, currentCompany: c.currentCompany || null,
      expectedSalary: c.expectedSalary ?? null, linkedin: c.linkedin || null,
      resumePath: c.resumePath || null, resumeName: c.resumeName || null, coverNote: coverNote || null,
    };
    let app = await JobApplication.findOne({ where: { jobId: job.id, candidateUserId: c.id }, transaction: t });
    const stamp = new Date().toISOString();
    if (!app) {
      app = await JobApplication.create({
        jobId: job.id, orgId: job.orgId, candidateUserId: c.id, ...snapshot,
        history: [{ stage: 'applied', at: stamp, by: 'Candidate', message: `Booked a walk-in slot on ${dateText(drive.driveDate)}` }],
      }, { transaction: t });
    } else if (app.status === 'withdrawn') {
      await app.update({ ...snapshot, status: 'applied', history: [...app.history, { stage: 'applied', at: stamp, by: 'Candidate', message: 'Applied again (walk-in)' }] }, { transaction: t });
    }

    const fields = {
      slotId: slot.id, applicationId: app.id, candidateName: c.name, candidateEmail: c.email, candidatePhone: c.phone || null,
      status: 'booked', checkedInAt: null, checkedInById: null, checkInMethod: null, cancelledAt: null,
    };
    let booking;
    if (mine) booking = await mine.update({ ...fields, passVersion: mine.passVersion + 1 }, { transaction: t });
    else booking = await WalkInBooking.create({ ...fields, driveId: drive.id, jobId: job.id, orgId: job.orgId, candidateUserId: c.id }, { transaction: t });
    // the application now says: interview scheduled (this is what the candidate and the HR both see)
    await applyWalkInEvent(app.id, { stage: 'interview', status: 'interview', onlyFrom: ['applied', 'screening', 'interview'], message: `Walk-in interview scheduled: ${dateText(drive.driveDate)}, ${slotText(slot)} at ${drive.venueName}`, by: 'Walk-in booking' }, t);
    return { booking, job, drive, slot };
  });

  const { booking, job, drive, slot } = out;
  await notifyOrgHR(job.orgId, { type: 'applicant', title: `Walk-in booking: ${c.name}`, body: `${job.title} (${job.jobCode}), ${dateText(drive.driveDate)}, ${slotText(slot)}.`, link: '/walk-in' }, [job.createdById]);
  await notifyCandidate(c.id, 'Walk-in interview scheduled', `${job.title}: ${dateText(drive.driveDate)}, ${slotText(slot)} at ${drive.venueName}. Your QR pass is ready in Walk-in Passes. Show it at the entry.`);
  const [pass] = await passShape([booking]);
  res.status(201).json(pass);
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const b = await WalkInBooking.findOne({ where: { id: req.params.id, candidateUserId: req.candidate.id } });
  if (!b) throw new HttpError(404, 'Pass not found.');
  if (b.status !== 'booked') throw new HttpError(409, b.status === 'checked_in' ? 'You have already attended this drive.' : 'This pass is already cancelled.');
  const drive = await WalkInDrive.findByPk(b.driveId);
  if (drive && drive.driveDate < nowLocal().date) throw new HttpError(409, 'This drive is already over.');
  await b.update({ status: 'cancelled', cancelledAt: new Date() });
  await applyWalkInEvent(b.applicationId, { stage: 'applied', status: 'applied', onlyFrom: ['interview'], message: 'You cancelled your walk-in slot.', by: 'Candidate' });
  const job = await Job.findByPk(b.jobId, { attributes: ['title', 'createdById'] });
  await notifyOrgHR(b.orgId, { type: 'applicant', title: `${b.candidateName} cancelled the walk-in`, body: `Cancelled the pass for ${job?.title || 'a job'}.`, link: '/walk-in' }, job ? [job.createdById] : []);
  res.json({ id: b.id, status: 'cancelled' });
});
