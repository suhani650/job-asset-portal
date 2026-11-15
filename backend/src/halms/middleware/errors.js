import multer from 'multer';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const notFound = (req, res) => res.status(404).json({ message: 'Route not found' });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Maximum size is 5 MB.' : 'Invalid file upload.';
    return res.status(400).json({ message });
  }
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
  if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ message: 'This record already exists.' });
  if (err.name === 'SequelizeValidationError') return res.status(400).json({ message: err.errors?.[0]?.message || 'Invalid data.' });
  console.error(err);
  return res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
