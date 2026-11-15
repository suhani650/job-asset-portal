import fsp from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { User, ProfileEditRequest } from '../models/index.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { AVATAR_DIR, looksLikeImage } from '../middleware/uploadAvatar.js';
import { str, audit } from '../utils/helpers.js';
import { notifySuperAdmins, notifyUsers } from '../utils/notify.js';

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // approved access stays valid for 24 hours
const PHONE_RE = /^[0-9+\-\s]{7,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const activeApproval = (userId) =>
  ProfileEditRequest.findOne({
    where: { userId, status: 'approved', expiresAt: { [Op.gt]: new Date() } },
    order: [['createdAt', 'DESC']],
  });

/* ---------------- Logged-in user ---------------- */

export const getProfile = asyncHandler(async (req, res) => {
  const requests = await ProfileEditRequest.findAll({
    where: { userId: req.user.id },
    include: [{ model: User, as: 'decider', attributes: ['name'] }],
    order: [['createdAt', 'DESC']],
    limit: 10,
  });
  res.json({
    user: req.user.toClient(),
    canEditDirectly: req.user.role === ROLES.SUPER_ADMIN,
    requests: requests.map((r) => r.toClient()),
  });
});

export const requestEdit = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.SUPER_ADMIN) throw new HttpError(400, 'Super Admin can edit the profile directly.');
  const reason = str(req.body?.reason, 300);
  if (reason.length < 5) throw new HttpError(400, 'Please tell why you want to edit (min 5 characters).');

  if (await ProfileEditRequest.count({ where: { userId: req.user.id, status: 'pending' } })) {
    throw new HttpError(409, 'You already have a request waiting for approval.');
  }
  if (await activeApproval(req.user.id)) {
    throw new HttpError(409, 'Your edit request is already approved. You can edit your profile now.');
  }

  const request = await ProfileEditRequest.create({ userId: req.user.id, reason });
  await audit({ actor: req.user, action: 'PROFILE_EDIT_REQUESTED', entity: 'ProfileEditRequest', entityId: request.id, meta: { reason }, req });
  await notifySuperAdmins({ type: 'profile', title: 'Profile edit request', body: `${req.user.name} wants to edit their profile.`, link: '/profile-requests' });
  res.status(201).json(request.toClient());
});

export const updateProfile = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === ROLES.SUPER_ADMIN;
  const approval = isAdmin ? null : await activeApproval(req.user.id);
  if (!isAdmin && !approval) {
    throw new HttpError(403, 'Editing is locked. Send an edit request and wait for Super Admin approval.');
  }

  const b = req.body || {};
  const changes = {};
  if (b.name !== undefined) {
    const v = str(b.name, 100);
    if (v.length < 2) throw new HttpError(400, 'Name must be at least 2 characters.');
    changes.name = v;
  }
  if (b.phone !== undefined) {
    const v = str(b.phone, 15);
    if (v && !PHONE_RE.test(v)) throw new HttpError(400, 'Enter a valid phone number.');
    changes.phone = v || null;
  }
  if (b.designation !== undefined) changes.designation = str(b.designation, 80) || null;
  if (b.department !== undefined) changes.department = str(b.department, 80) || null;

  const before = {};
  const after = {};
  for (const [k, v] of Object.entries(changes)) {
    if ((req.user[k] || null) !== v) { before[k] = req.user[k] || null; after[k] = v; }
  }
  if (!Object.keys(after).length) throw new HttpError(400, 'No changes to save.');

  await req.user.update(after);
  if (approval) await approval.update({ status: 'used', usedAt: new Date() }); // one approval = one edit
  await audit({ actor: req.user, action: 'PROFILE_UPDATED', entity: 'User', entityId: req.user.id, meta: { before, after }, req });
  res.json({ user: req.user.toClient() });
});

/* ---------------- Photo (no approval needed) ---------------- */

export const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose an image to upload.');
  if (!(await looksLikeImage(req.file.path))) {
    await fsp.rm(req.file.path, { force: true });
    throw new HttpError(400, 'This file is not a valid image.');
  }
  const old = req.user.avatarFile;
  await req.user.update({ avatarFile: req.file.filename });
  if (old) await fsp.rm(path.join(AVATAR_DIR, path.basename(old)), { force: true });
  await audit({ actor: req.user, action: 'PROFILE_PHOTO_UPDATED', entity: 'User', entityId: req.user.id, req });
  res.json({ user: req.user.toClient() });
});

export const removePhoto = asyncHandler(async (req, res) => {
  const old = req.user.avatarFile;
  if (old) {
    await req.user.update({ avatarFile: null });
    await fsp.rm(path.join(AVATAR_DIR, path.basename(old)), { force: true });
    await audit({ actor: req.user, action: 'PROFILE_PHOTO_REMOVED', entity: 'User', entityId: req.user.id, req });
  }
  res.json({ user: req.user.toClient() });
});

export const getPhoto = asyncHandler(async (req, res) => {
  if (!req.user.avatarFile) throw new HttpError(404, 'No photo.');
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(AVATAR_DIR, path.basename(req.user.avatarFile)));
});

/* ---------------- Super Admin ---------------- */

export const listEditRequests = asyncHandler(async (req, res) => {
  const where = {};
  if (['pending', 'approved', 'rejected', 'used'].includes(req.query.status)) where.status = req.query.status;
  const rows = await ProfileEditRequest.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'email', 'role'] },
      { model: User, as: 'decider', attributes: ['name'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: 200,
  });
  res.json(rows.map((r) => r.toClient(true)));
});

export const decideEditRequest = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'Request not found.');
  const action = req.body?.action;
  const note = str(req.body?.note, 300);
  if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'Invalid action.');
  if (action === 'reject' && note.length < 5) throw new HttpError(400, 'A reason is required to reject (min 5 characters).');

  const request = await ProfileEditRequest.findByPk(req.params.id, { include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'role'] }] });
  if (!request) throw new HttpError(404, 'Request not found.');
  if (request.status !== 'pending') throw new HttpError(409, `This request is already ${request.status}.`);

  await request.update({
    status: action === 'approve' ? 'approved' : 'rejected',
    decidedById: req.user.id,
    decidedAt: new Date(),
    decisionNote: note || null,
    expiresAt: action === 'approve' ? new Date(Date.now() + EDIT_WINDOW_MS) : null,
  });
  await audit({
    actor: req.user, action: `PROFILE_EDIT_${action.toUpperCase()}`, entity: 'ProfileEditRequest',
    entityId: request.id, meta: { forUser: request.user.email, note }, req,
  });
  await notifyUsers([request.userId], {
    type: 'profile', link: '/profile',
    title: action === 'approve' ? 'Profile edit approved' : 'Profile edit rejected',
    body: action === 'approve' ? 'You can now edit your profile (valid for 24 hours).' : (note || 'Your request was rejected.'),
  });
  request.decider = { name: req.user.name };
  res.json(request.toClient(true));
});
