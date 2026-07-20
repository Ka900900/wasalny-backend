/**
 * Document-type mapping.
 *
 * Every key matches the Prisma field name on DriverProfile.
 *   idPhotoFront → صورة البطاقة (وجه)
 *   idPhotoBack  → صورة البطاقة (ظهر)
 *   licensePhoto → رخصة القيادة
 *   facePhoto    → صورة شخصية (selfie)
 *   carPhoto     → صورة السيارة
 *   avatar       → الصورة الشخصية العامة
 *
 * The value is the Cloudinary sub-folder.
 */
const DOCUMENT_MAP = {
  'id-front':   { folder: 'wasalny/documents/id',   prismaField: 'idPhotoFront' },
  'id-back':    { folder: 'wasalny/documents/id',   prismaField: 'idPhotoBack' },
  'license':    { folder: 'wasalny/documents/license', prismaField: 'licensePhoto' },
  'face':       { folder: 'wasalny/documents/face', prismaField: 'facePhoto' },
  'car':        { folder: 'wasalny/vehicle',         prismaField: 'carPhoto' },
  'profile':    { folder: 'wasalny/avatars',         prismaField: 'avatar' },
  'insurance':  { folder: 'wasalny/documents/insurance', prismaField: 'insurancePhoto' },
};

/**
 * Upper-camel-case helper for Prisma field display.
 */
const FIELD_LABELS = {
  idPhotoFront: 'National ID (Front)',
  idPhotoBack:  'National ID (Back)',
  licensePhoto: 'Driver License',
  facePhoto:    'Face / Selfie',
  carPhoto:     'Vehicle Photo',
  avatar:       'Profile Photo',
  insurancePhoto: 'Insurance Document',
};

module.exports = { DOCUMENT_MAP, FIELD_LABELS };
