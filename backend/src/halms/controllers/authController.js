import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { notifySuperAdmins } from '../utils/notify.js';
import { User, Registration } from '../models/index.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { signToken, str, audit } from '../utils/helpers.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PIN_RE = /^\d{6}$/;

const MANDATORY_DOCS = ['regCertificate', 'panCard', 'gstCertificate', 'signatoryIdProof', 'addressProof'];
const OPTIONAL_DOCS = ['cinCertificate', 'msmeCertificate', 'startupIndiaCert', 'isoCertificate', 'shopEstCert'];
const AGREEMENT_KEYS = ['accuracy', 'authorized', 'terms', 'privacy', 'noMisuse'];

// Only known fields are kept. Anything else sent by the client is dropped.
function cleanProfile(p) {
  const c = p.company || {};
  const a = p.address || {};
  const ct = p.contact || {};
  const h = p.hiring || {};
  const b = p.billing || {};
  return {
    company: {
      name: str(c.name, 150), website: str(c.website), email: str(c.email, 150).toLowerCase(),
      mobile: str(c.mobile, 25), type: str(c.type), industry: str(c.industry), size: str(c.size, 20),
      yearEstablished: str(c.yearEstablished, 4), description: str(c.description, 1000),
    },
    address: {
      country: str(a.country, 80), state: str(a.state, 80), city: str(a.city, 80), area: str(a.area, 100),
      building: str(a.building, 200), pincode: str(a.pincode, 6), landmark: str(a.landmark, 100),
    },
    branches: Array.isArray(p.branches)
      ? p.branches.slice(0, 20).map((x) => ({ city: str(x?.city, 80), state: str(x?.state, 80), pincode: str(x?.pincode, 6) }))
      : [],
    contact: {
      fullName: str(ct.fullName, 100), designation: str(ct.designation, 80), department: str(ct.department, 80),
      email: str(ct.email, 150).toLowerCase(), mobile: str(ct.mobile, 25), whatsapp: str(ct.whatsapp, 25),
    },
    hiring: { hiringFor: str(h.hiringFor), volume: str(h.volume), frequency: str(h.frequency), locations: str(h.locations, 300) },
    billing: {
      gst: str(b.gst, 15).toUpperCase(), pan: str(b.pan, 10).toUpperCase(), cin: str(b.cin, 21).toUpperCase(),
      msme: str(b.msme, 30), billingAddress: str(b.billingAddress, 400),
    },
    account: { username: str(p.account?.username, 40) },
    agreements: Object.fromEntries(AGREEMENT_KEYS.map((k) => [k, p.agreements?.[k] === true])),
  };
}

function validateProfile(d, password, documents) {
  if (d.company.name.length < 2) return 'Company name is required.';
  if (!EMAIL_RE.test(d.company.email)) return 'A valid company email is required.';
  if (!d.company.mobile) return 'Company mobile is required.';
  if (d.company.description.length < 10) return 'Company description is required (min 10 characters).';
  if (!d.address.state || !d.address.city || !d.address.country) return 'Complete registered address is required.';
  if (!PIN_RE.test(d.address.pincode)) return 'A valid 6-digit PIN code is required.';
  if (d.contact.fullName.length < 2) return 'Contact person name is required.';
  if (!EMAIL_RE.test(d.contact.email)) return 'A valid official email is required.';
  if (!d.contact.mobile) return 'Contact mobile is required.';
  if (d.billing.gst && !GST_RE.test(d.billing.gst)) return 'Invalid GST number format.';
  if (d.billing.pan && !PAN_RE.test(d.billing.pan)) return 'Invalid PAN format.';
  if (d.account.username.length < 3) return 'Username must be at least 3 characters.';
  if (!PASSWORD_RE.test(password)) return 'Password needs 8+ characters with uppercase, lowercase and a number.';
  const missing = MANDATORY_DOCS.filter((k) => !documents[k]);
  if (missing.length) return `Missing mandatory documents: ${missing.join(', ')}.`;
  if (!AGREEMENT_KEYS.every((k) => d.agreements[k])) return 'All terms must be accepted.';
  return null;
}

export const register = asyncHandler(async (req, res) => {
  const files = [...(req.files?.companyLogo || []), ...(req.files?.verificationDocs || [])];
  const discard = () => Promise.all(files.map((f) => fs.rm(f.path, { force: true })));

  try {
    let raw;
    try {
      raw = JSON.parse(req.body?.profileData || '{}');
    } catch {
      throw new HttpError(400, 'Invalid registration data.');
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const data = cleanProfile(raw);

    // File names look like "regCertificate_myfile.pdf". The prefix is the document key.
    const documents = {};
    for (const f of files) {
      const [prefix, ...rest] = f.originalname.split('_');
      const key = f.fieldname === 'companyLogo' ? 'logo' : prefix;
      if (key !== 'logo' && ![...MANDATORY_DOCS, ...OPTIONAL_DOCS].includes(key)) continue;
      const shown = rest.join('_') || f.originalname;
      documents[key] = {
        originalName: shown.slice(0, 150),
        storedName: f.filename, mime: f.mimetype, size: f.size,
      };
    }

    const error = validateProfile(data, password, documents);
    if (error) throw new HttpError(400, error);

    const emails = [data.contact.email, data.company.email];
    const clash =
      (await User.count({ where: { email: { [Op.in]: emails } } })) > 0 ||
      (await Registration.count({
        where: {
          status: { [Op.ne]: 'rejected' },
          [Op.or]: [
            { contact: { email: { [Op.in]: emails } } },
            { company: { email: { [Op.in]: emails } } },
          ],
        },
      })) > 0;
    if (clash) throw new HttpError(409, 'A registration with this email already exists.');

    const passwordHash = await bcrypt.hash(password, 12);
    const reg = await Registration.create({ ...data, documents, passwordHash });
    await audit({ action: 'REGISTRATION_SUBMITTED', entity: 'Registration', entityId: reg.id, meta: { company: data.company.name }, req });
    await notifySuperAdmins({ type: 'registration', title: 'New company registration', body: `${data.company.name} is waiting for verification.`, link: '/registrations' });

    return res.status(201).json({ message: 'Registration submitted for verification.', id: reg.id });
  } catch (err) {
    await discard(); // never keep uploaded files for a failed registration
    throw err;
  }
});

export const login = asyncHandler(async (req, res) => {
  const email = str(req.body?.email, 150).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_RE.test(email) || !password) throw new HttpError(400, 'Email and password are required.');

  const user = await User.scope('withPassword').findOne({ where: { email } });
  if (user) {
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Invalid email or password.');
    if (user.status !== 'active') throw new HttpError(403, 'This account has been disabled. Contact your administrator.');
    user.lastLoginAt = new Date();
    await user.save();
    await audit({ actor: user, action: 'LOGIN', entity: 'User', entityId: user.id, req });
    return res.json({ token: signToken(user), user: user.toClient() });
  }

  // No user yet: tell the person their registration status, but only if the password is right.
  const reg = await Registration.scope('withPassword').findOne({
    where: { contact: { email } },
    order: [['submittedAt', 'DESC']],
  });
  if (reg && (await bcrypt.compare(password, reg.passwordHash))) {
    const msg = {
      pending_verification: 'Your registration is pending Super Admin verification.',
      more_docs: 'The Super Admin has requested more documents for your registration.',
      rejected: 'Your registration was rejected. Please contact support.',
      approved: 'Your registration is approved but the account is not ready yet. Please contact support.',
    }[reg.status];
    if (msg) throw new HttpError(403, msg);
  }
  throw new HttpError(401, 'Invalid email or password.');
});

export const me = (req, res) => res.json({ user: req.user.toClient() });
