import path from 'node:path';
import bcrypt from 'bcryptjs';
import { User, Registration } from '../models/index.js';
import { ROLES } from '../config/roles.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { UPLOAD_DIR } from '../middleware/upload.js';
import { str, audit } from '../utils/helpers.js';

const OUTCOME = { approve: 'approved', reject: 'rejected', more_docs: 'more_docs' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validateId = (req, res, next, id) =>
  UUID_RE.test(id) ? next() : res.status(404).json({ message: 'Registration not found.' });

export const listRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findAll({ order: [['submittedAt', 'DESC']] });
  res.json(regs.map((r) => r.toClient()));
});

export const downloadDocument = asyncHandler(async (req, res) => {
  const reg = await Registration.findByPk(req.params.id);
  const doc = reg?.documents?.[req.params.key];
  if (!doc) throw new HttpError(404, 'Document not found.');
  const file = path.join(UPLOAD_DIR, path.basename(doc.storedName));
  await audit({ actor: req.user, action: 'DOCUMENT_VIEWED', entity: 'Registration', entityId: reg.id, meta: { key: req.params.key }, req });
  res.download(file, doc.originalName);
});

export const decideRegistration = asyncHandler(async (req, res) => {
  const action = req.body?.action;
  const reason = str(req.body?.reason, 500);
  if (!OUTCOME[action]) throw new HttpError(400, 'Invalid action.');
  if (action !== 'approve' && reason.length < 5) throw new HttpError(400, 'A reason is required (min 5 characters).');

  const reg = await Registration.scope('withPassword').findByPk(req.params.id);
  if (!reg) throw new HttpError(404, 'Registration not found.');
  if (['approved', 'rejected'].includes(reg.status)) throw new HttpError(409, `This registration is already ${reg.status}.`);

  if (action === 'approve') {
    if (await User.count({ where: { email: reg.contact.email.toLowerCase() } })) {
      throw new HttpError(409, 'A user with this email already exists.');
    }
    const user = await User.create({
      name: reg.contact.fullName,
      email: reg.contact.email,
      passwordHash: reg.passwordHash,
      role: ROLES.OWNER, // the person who registered the company is its Owner
      registrationId: reg.id,
      phone: reg.contact.mobile || null,
      designation: reg.contact.designation || null,
      department: reg.contact.department || null,
    });
    reg.userId = user.id;
  }

  reg.status = OUTCOME[action];
  reg.history = [...(reg.history || []), { action, reason, by: req.user.name, byId: req.user.id, at: new Date() }];
  await reg.save();

  await audit({
    actor: req.user, action: `REGISTRATION_${action.toUpperCase()}`, entity: 'Registration',
    entityId: reg.id, meta: { company: reg.company.name, reason }, req,
  });
  res.json(reg.toClient());
});


// Super Admin sets a new password for an approved company's HR login (used when a client cannot sign in).
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
export const resetClientPassword = asyncHandler(async (req, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || !PASSWORD_RE.test(password)) {
    throw new HttpError(400, 'Password needs 8+ characters with uppercase, lowercase and a number.');
  }
  const reg = await Registration.findByPk(req.params.id);
  if (!reg) throw new HttpError(404, 'Registration not found.');
  if (reg.status !== 'approved' || !reg.userId) throw new HttpError(409, 'Only an approved registration has a login to reset.');

  // update() on the table directly, because passwordHash is hidden by the default scope
  const [changed] = await User.update({ passwordHash: await bcrypt.hash(password, 12) }, { where: { id: reg.userId } });
  if (!changed) throw new HttpError(404, 'The client account was not found.');
  await audit({
    actor: req.user, action: 'CLIENT_PASSWORD_RESET', entity: 'Registration', entityId: reg.id,
    meta: { company: reg.company?.name, email: reg.contact?.email }, req,
  });
  res.json({ message: 'Password updated.' });
});
