import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { HttpError } from './errors.js';

export const AVATAR_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads', 'halms', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

export const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTS.includes(ext) || !file.mimetype.startsWith('image/')) {
      return cb(new HttpError(400, 'Only JPG, PNG or WebP images are allowed.'));
    }
    return cb(null, true);
  },
}).single('photo');

// Check the real file signature, not just the extension.
export async function looksLikeImage(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(12), 0, 12, 0);
    const jpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    return jpg || png || webp;
  } finally {
    await fh.close();
  }
}
