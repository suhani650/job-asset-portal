import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { asyncHandler, ApiError, uid } from '../../utils/http';
import { authenticate, isAdmin, isStaff } from '../../middleware/auth';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TYPES = [
  'ID_PROOF',          // Aadhaar / PAN / Voter ID / Passport
  'ADDRESS_PROOF',
  'PHOTO',
  'SIGNATURE',
  'RESUME',
  'TENTH_MARKSHEET',
  'TWELFTH_MARKSHEET',
  'DIPLOMA',
  'GRADUATION',
  'POST_GRADUATION',
  'EDUCATION',         // koi aur education certificate
  'CERTIFICATE',       // course / training certificate
  'EXPERIENCE_LETTER',
  'RELIEVING_LETTER',
  'SALARY_SLIP',
  'OFFER_LETTER',
  'BANK_PROOF',        // cancelled cheque / passbook
  'PAN_CARD',
  'AADHAAR_CARD',
  'PASSPORT',
  'CASTE_CERTIFICATE',
  'DOMICILE',
  'MEDICAL_CERTIFICATE',
  'POLICE_VERIFICATION',
  'OTHER',
];
const ALLOWED = ['.pdf', '.png', '.jpg', '.jpeg'];

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Only PDF, PNG or JPG allowed')),
});

const r = Router();
r.use(authenticate);

// filePath client ko kabhi nahi jata
const pub = (d: any) => ({
  id: d.id, type: d.type, fileName: d.fileName, status: d.status,
  remarks: d.remarks, createdAt: d.createdAt, url: `/documents/${d.id}/file`,
});

// Candidate: apne documents
r.get('/mine', asyncHandler(async (req, res) => {
  const rows = await prisma.document.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: 'desc' } });
  res.json({ data: rows.map(pub) });
}));

// Admin: sab candidates ke documents (filter: status, search). Admin > Documents page isi se list banata hai.
r.get('/', asyncHandler(async (req, res) => {
  if (!isAdmin(req)) throw new ApiError(403, 'Admin only');
  const status = String(req.query.status || '');
  const search = String(req.query.search || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 50));
  const rows = await prisma.document.findMany({
    where: {
      ...(['PENDING', 'VERIFIED', 'REJECTED'].includes(status) ? { status: status as any } : {}),
      ...(search ? { user: { OR: [{ name: { contains: search } }, { email: { contains: search } }] } } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({ data: rows.map((d) => ({ ...pub(d), user: d.user })) });
}));

// Candidate: upload (FormData: file + type)
r.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'File is required');
  const type = String(req.body.type || 'OTHER');
  if (!TYPES.includes(type)) {
    fs.unlink(req.file.path, () => {});
    throw new ApiError(400, 'Invalid type');
  }
  const d = await prisma.document.create({
    data: {
      userId: uid(req), type, fileName: req.file.originalname, filePath: req.file.filename,
      mimeType: req.file.mimetype, size: req.file.size,
    },
  });
  res.status(201).json({ data: pub(d) });
}));

// Download: owner ya staff
r.get('/:id/file', asyncHandler(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: String(req.params.id) } });
  if (!d) throw new ApiError(404, 'Not found');
  if (d.userId !== uid(req) && !isStaff(req)) throw new ApiError(403, 'Forbidden');
  res.download(path.resolve(UPLOAD_DIR, d.filePath), d.fileName);
}));

// Admin: kisi candidate ke documents
r.get('/user/:userId', asyncHandler(async (req, res) => {
  if (!isAdmin(req)) throw new ApiError(403, 'Admin only');
  const rows = await prisma.document.findMany({ where: { userId: String(req.params.userId) }, orderBy: { createdAt: 'desc' } });
  res.json({ data: rows.map(pub) });
}));

// Admin: verify / reject
r.patch('/:id/status', asyncHandler(async (req, res) => {
  if (!isAdmin(req)) throw new ApiError(403, 'Admin only');
  const { status, remarks } = req.body || {};
  if (!['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) throw new ApiError(400, 'Invalid status');
  const d = await prisma.document.update({ where: { id: String(req.params.id) }, data: { status, remarks } });
  res.json({ data: pub(d) });
}));

// Delete: owner ya admin
r.delete('/:id', asyncHandler(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: String(req.params.id) } });
  if (!d) throw new ApiError(404, 'Not found');
  if (d.userId !== uid(req) && !isAdmin(req)) throw new ApiError(403, 'Forbidden');
  await prisma.document.delete({ where: { id: d.id } });
  fs.unlink(path.resolve(UPLOAD_DIR, d.filePath), () => {});
  res.json({ data: { ok: true } });
}));

export default r;
