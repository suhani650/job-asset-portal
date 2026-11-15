import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { HttpError } from './errors.js';

export const JD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads', 'halms', 'jd');
fs.mkdirSync(JD_DIR, { recursive: true });

const EXTS = ['.pdf', '.doc', '.docx'];

export const jdUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, JD_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    return EXTS.includes(ext) ? cb(null, true) : cb(new HttpError(400, 'Only PDF, DOC or DOCX files are allowed.'));
  },
}).single('jd');

// Verify the real file signature, not just the extension.
export async function looksLikeDocument(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(8), 0, 8, 0);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return buffer.subarray(0, 4).toString() === '%PDF';
    if (ext === '.docx') return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    if (ext === '.doc') return buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    return false;
  } finally {
    await fh.close();
  }
}
