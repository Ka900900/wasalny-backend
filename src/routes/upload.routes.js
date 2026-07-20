const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const upload = require('../middlewares/upload.middleware');
const { uploadDocument } = require('../controllers/upload.controller');

// ─── Multer error wrapper ─────────────────────────────────
// Catches Multer / validation errors and returns clean JSON.
const withUpload = (handler) => (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('[upload] middleware error:', err.message);
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
    return handler(req, res, next);
  });
};

// ─── Dynamic document-upload endpoint ─────────────────────
// POST /api/v1/upload/:docType
//   docType ∈ { id-front, id-back, license, face, car, profile, insurance }
router.post('/:docType', authenticateToken, withUpload(uploadDocument));

// ─── Legacy shorthands (backward compat) ──────────────────
// Each maps to the canonical docType and calls the same handler.
const LEGACY_MAP = {
  '/profile':   { docType: 'profile' },
  '/license':   { docType: 'license' },
  '/id-card':   { docType: 'id-front' },
  '/car':       { docType: 'car' },
  '/insurance': { docType: 'insurance' },
};

for (const [legacyPath, { docType }] of Object.entries(LEGACY_MAP)) {
  router.post(legacyPath, authenticateToken, withUpload((req, res) => {
    req.params = { ...req.params, docType };
    return uploadDocument(req, res);
  }));
}

module.exports = router;