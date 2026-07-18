const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const upload = require('../middlewares/upload.middleware');

/**
 * POST /api/v1/upload
 * Upload a single image to Cloudinary
 * Field Name: image (must match Flutter MultipartRequest)
 *
 * Middleware order:
 *   1. authenticateToken  ← JWT verification (reads only headers)
 *   2. upload.single('image')  ← Multer parses multipart body
 *   3. Controller handler
 *
 * No express.json() in this route — Multer handles body parsing.
 */
router.post('/', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    console.log('========== Upload Request ==========');
    console.log('User:', req.user);
    console.log('File Exists:', !!req.file);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    console.log('========== Cloudinary File ==========');
    console.log(req.file);

    const imageUrl =
      req.file.path ||
      req.file.secure_url ||
      req.file.url;

    const publicId =
      req.file.filename ||
      req.file.public_id ||
      null;

    if (!imageUrl) {
      return res.status(500).json({
        success: false,
        message: 'File uploaded but no URL was returned from storage',
      });
    }

    console.log('✅ Upload Success');
    console.log('Image URL:', imageUrl);
    console.log('Public ID:', publicId);

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
      publicId,
    });

  } catch (error) {
    console.error('========== Upload Error ==========');
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message || 'An error occurred during upload',
    });
  }
});

module.exports = router;