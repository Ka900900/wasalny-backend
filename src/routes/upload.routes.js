const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const upload = require('../middlewares/upload.middleware');

// Multer error wrapper — converts Multer/Cloudinary failures into clean
// JSON responses instead of letting them bubble up as a 502 from the proxy.
const withUpload = (handler) => (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('[upload] middleware error:', err.message);
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        success: false,
        message: err.message || 'Upload failed',
      });
    }
    return handler(req, res, next);
  });
};

// Upload Handler
const uploadHandler = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const imageUrl =
      req.file.path ||
      req.file.secure_url ||
      req.file.url;

    const publicId =
      req.file.filename ||
      req.file.public_id ||
      null;

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
      publicId,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message || 'Upload failed',
    });
  }
};

// جميع المسارات المطلوبة بواسطة Flutter
router.post('/', authenticateToken, withUpload(uploadHandler));

router.post('/profile', authenticateToken, withUpload(uploadHandler));

router.post('/license', authenticateToken, withUpload(uploadHandler));

router.post('/id-card', authenticateToken, withUpload(uploadHandler));

router.post('/car', authenticateToken, withUpload(uploadHandler));

router.post('/insurance', authenticateToken, withUpload(uploadHandler));

module.exports = router;