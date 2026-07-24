/**
 * Upload controller.
 *
 * Receives a file buffer from Multer (memory storage), validates it,
 * streams it to Cloudinary, then persists the secure URL on the
 * appropriate Prisma field.
 *
 * The user **must** have a DriverProfile row; the controller creates one
 * on the fly if missing (graceful initial-upload scenario).
 */
const prisma = require('../config/prisma');
const { validateFile, uploadBuffer } = require('../services/upload.service');
const DOCUMENT_MAP = require('../config/upload-map');
const FIELD_LABELS = {};  // Reserved for future human-readable labels

// ─── Helpers ──────────────────────────────────────────────

/** Extract driver-profile id from the authenticated user. */
async function getDriverProfile(userId) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (profile) return profile;

  // Some callers may upload before having a full DriverProfile.
  // Create a minimal stub so we can store the document URL.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  return prisma.driverProfile.create({
    data: {
      userId,
      carModel: 'PENDING',
      carPlateNumber: 'PENDING',
      carColor: 'PENDING',
      vehicleType: 'PRIVATE_CAR',
      carPhotoUrl: '',
    },
  });
}

// ─── Main handler ────────────────────────────────────────

/**
 * POST /api/v1/upload/:docType
 *
 * Expected params:
 *   - `req.params.docType` – one of the keys in DOCUMENT_MAP
 *   - `req.file`           – multer file (buffer, mimetype, originalname)
 */
async function uploadDocument(req, res) {
  try {
    // 1. Validate params
    const docType = req.params.docType;
    const docConfig = DOCUMENT_MAP[docType];
    if (!docConfig) {
      return res.status(400).json({
        success: false,
        message: `Unknown document type "${docType}". Valid: ${Object.keys(DOCUMENT_MAP).join(', ')}`,
      });
    }

    // 2. Validate file
    const validation = validateFile(req.file);
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, message: validation.message });
    }

    // 3. Upload to Cloudinary (memory → stream)
    const result = await uploadBuffer(req.file.buffer, docConfig.folder, {
      public_id: `${req.user.id}_${docType}_${Date.now()}`,
    });

    // 4. Persist URL on DriverProfile
    const profile = await getDriverProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updateData = { [docConfig.prismaField]: result.secure_url };
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: updateData,
    });

    // 5. Respond
    return res.status(200).json({
      success: true,
      message: `${FIELD_LABELS[docConfig.prismaField] || docType} uploaded successfully`,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      field: docConfig.prismaField,
    });
  } catch (err) {
    console.error('[upload]', err);
    return res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
}

module.exports = { uploadDocument };
