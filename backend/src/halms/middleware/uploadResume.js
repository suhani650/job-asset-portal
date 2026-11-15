import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { HttpError } from './errors.js';

export const RESUME_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads', 'halms', 'resumes');
fs.mkdirSync(RESUME_DIR, { recursive: true });

const EXTS = ['.pdf', '.doc', '.docx'];

export const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RESUME_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    return EXTS.includes(ext) ? cb(null, true) : cb(new HttpError(400, 'Resume must be a PDF, DOC or DOCX file.'));
  },
}).single('resume');