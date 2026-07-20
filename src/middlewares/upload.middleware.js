/**
 * Multer middleware using in-memory storage.
 *
 * No temporary files are saved to disk.  The raw buffer is handed
 * to the controller which streams it directly to Cloudinary.
 */
const multer = require('multer');
const { ALLOWED_MIMES, MAX_FILE_SIZE } = require('../services/upload.service');

// Memory storage – keeps the file in `req.file.buffer`
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${file.mimetype}"`));
    }
  },
});

module.exports = upload;