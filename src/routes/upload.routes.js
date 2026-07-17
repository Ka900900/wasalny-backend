const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middlewares/upload.middleware');

/**
 * POST /api/v1/upload
 * Accepts a single file under the field name "image" and returns the
 * Cloudinary secure URL.
 */
router.post('/', authenticateToken, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم إرفاق صورة' });
    }

    const imageUrl = req.file.path; // Cloudinary secure URL
    console.log('[upload] Cloudinary URL generated:', imageUrl);

    res.json({ success: true, imageUrl });
  } catch (error) {
    console.error('[upload] IMAGE UPLOAD ERROR details:', error?.message || error);
    res.status(500).json({ error: error?.message || 'خطأ في رفع الصورة' });
  }
});

module.exports = router;
