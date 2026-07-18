const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const upload = require('../middlewares/upload.middleware');

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
router.post('/', authenticateToken, upload.single('image'), uploadHandler);

router.post('/profile', authenticateToken, upload.single('image'), uploadHandler);

router.post('/license', authenticateToken, upload.single('image'), uploadHandler);

router.post('/id-card', authenticateToken, upload.single('image'), uploadHandler);

router.post('/car', authenticateToken, upload.single('image'), uploadHandler);

router.post('/insurance', authenticateToken, upload.single('image'), uploadHandler);

module.exports = router;