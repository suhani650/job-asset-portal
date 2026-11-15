import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { ApiError } from './http';

/** Resumes are saved here. This folder is NOT served statically: files are only sent through authenticated routes. */
export const UPLOAD_ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};
const BAD_TYPE = 'Resume must be a PDF, DOC or DOCX file';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
    // random name: the client's file name is never used on disk
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: env.MAX_RESUME_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mimes = ALLOWED_MIME[path.extname(file.originalname).toLowerCase()];
    // some browsers send application/octet-stream for .doc/.docx; the real content is checked after upload
    if (!mimes || !(mimes.includes(file.mimetype) || file.mimetype === 'application/octet-stream')) return cb(new ApiError(400, BAD_TYPE));
    cb(null, true);
  },
});

/** Deletes an uploaded file (best effort). Only the base name is used, so a bad DB value can never escape UPLOAD_ROOT. */
export function removeUpload(name?: string | null) {
  if (!name) return;
  fs.promises.unlink(path.join(UPLOAD_ROOT, path.basename(name))).catch(() => undefined);
}

/** Checks the first bytes of the file so a renamed .exe cannot pass as a resume. */
async function looksLikeResume(file: Express.Multer.File): Promise<boolean> {
  const fh = await fs.promises.open(file.path, 'r');
  try {
    const buf = Buffer.alloc(8);
    await fh.read(buf, 0, 8, 0);
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') return buf.subarray(0, 4).toString('latin1') === '%PDF';
    if (ext === '.docx') return buf[0] === 0x50 && buf[1] === 0x4b; // "PK" (zip container)
    if (ext === '.doc') return buf.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    return false;
  } finally {
    await fh.close();
  }
}

/**
 * Express middleware: accepts ONE optional file in the form field "resume" (multipart/form-data).
 * JSON requests pass straight through. If the request later fails (status >= 400) the saved file is deleted.
 */
export const resumeUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('resume')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError)
        return next(new ApiError(400, err.code === 'LIMIT_FILE_SIZE' ? `Resume must be smaller than ${env.MAX_RESUME_MB} MB` : 'Invalid file upload'));
      return next(err);
    }
    const file = req.file;
    if (!file) return next();
    res.on('finish', () => { if (res.statusCode >= 400) removeUpload(file.filename); });
    looksLikeResume(file)
      .then((good) => {
        if (good) return next();
        removeUpload(file.filename);
        next(new ApiError(400, BAD_TYPE));
      })
      .catch(next);
  });
};

/** Sends a stored resume to an (already authorised) caller as a download. */
export function sendResume(res: Response, resumePath: string | null, resumeName: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!resumePath) return reject(new ApiError(404, 'No resume uploaded'));
    const full = path.join(UPLOAD_ROOT, path.basename(resumePath));
    if (!fs.existsSync(full)) return reject(new ApiError(404, 'Resume file not found on server'));
    res.download(full, resumeName || path.basename(full), (err) => (err && !res.headersSent ? reject(err) : resolve()));
  });
}
