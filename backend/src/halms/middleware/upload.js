import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { HttpError } from './errors.js';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads', 'halms', 'registrations');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DOC_EXTS = ['.pdf', '.jpg', '.jpeg', '.png'];
const LOGO_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Random stored name: the user's file name is never used on disk.
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});

export const registrationUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = file.fieldname === 'companyLogo' ? LOGO_EXTS : DOC_EXTS;
    if (!allowed.includes(ext)) {
      return cb(new HttpError(400, `Unsupported file type: ${ext || 'unknown'}.`));
    }
    return cb(null, true);
  },
}).fields([
  { name: 'companyLogo', maxCount: 1 },
  { name: 'verificationDocs', maxCount: 11 },
]);
