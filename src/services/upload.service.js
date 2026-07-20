/**
 * Professional Cloudinary upload service.
 *
 * Uses Multer MemoryStorage so files are never written to disk.
 * Uploads are streamed directly to Cloudinary via `upload_stream` with
 * automatic format & quality optimisation.
 */
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// ─── Allowed MIME types ────────────────────────────────────
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// ─── Validation ────────────────────────────────────────────

/**
 * Validate that a file buffer passes our constraints.
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
function validateFile(file) {
  if (!file) {
    return { ok: false, status: 400, message: 'No file provided' };
  }
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return {
      ok: false,
      status: 400,
      message: `Unsupported file type "${file.mimetype}". Allowed: ${[...ALLOWED_MIMES].join(', ')}`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      status: 413,
      message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 5 MB`,
    };
  }
  return { ok: true };
}

// ─── Cloudinary upload ────────────────────────────────────

/**
 * Upload a single image buffer to Cloudinary.
 *
 * @param {Buffer}    buffer          – raw image bytes
 * @param {string}    [folder='wasalny/documents']
 * @param {object}    [extra={}]      – extra Cloudinary upload params
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
function uploadBuffer(buffer, folder = 'wasalny/documents', extra = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        // Automatic optimisation
        fetch_format: 'auto',
        quality: 'auto',
        // Security
        type: 'authenticated',
        ...extra,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
        });
      },
    );

    // Pipe the in-memory buffer into the upload stream
    const readable = Readable.from(buffer);
    readable.pipe(stream);
  });
}

/**
 * Convenience: delete an image by public_id.
 */
function deleteImage(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

module.exports = {
  validateFile,
  uploadBuffer,
  deleteImage,
  ALLOWED_MIMES,
  MAX_FILE_SIZE,
};
