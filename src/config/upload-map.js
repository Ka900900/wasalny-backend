/**
 * Document-type mapping.
 *
 * Keys are the `:docType` values that Flutter sends in the URL path.
 * Each maps to a Prisma field on DriverProfile and a Cloudinary sub-folder.
 *
 * Flutter UploadDocType     → Prisma field
 * ─────────────────────────────────────────────
 * id-front                  → idPhotoFront
 * id-back                   → idPhotoBack
 * license                   → licensePhoto
 * license-back              → licenseBackUrl
 * face                      → facePhoto
 * car                       → carPhotoUrl
 * profile                   → facePhoto
 * insurance                 → insurancePhoto
 */
module.exports = {
  // ── Canonical docType keys (matching Flutter UploadDocType) ──
  'id-front':     { prismaField: 'idPhotoFront',   folder: 'wasalny/documents' },
  'id-back':      { prismaField: 'idPhotoBack',    folder: 'wasalny/documents' },
  license:        { prismaField: 'licensePhoto',   folder: 'wasalny/documents' },
  'license-back': { prismaField: 'licenseBackUrl', folder: 'wasalny/documents_back' },
  face:           { prismaField: 'facePhoto',      folder: 'wasalny/faces' },
  car:            { prismaField: 'carPhotoUrl',    folder: 'wasalny/car_photos' },
  insurance:      { prismaField: 'insurancePhoto', folder: 'wasalny/documents' },

  // ── Synonym keys (backward compat, used by legacy shorthands) ──
  idPhotoFront:   { prismaField: 'idPhotoFront',   folder: 'wasalny/documents' },
  idPhotoBack:    { prismaField: 'idPhotoBack',    folder: 'wasalny/documents' },
  licensePhoto:   { prismaField: 'licensePhoto',   folder: 'wasalny/documents' },
  facePhoto:      { prismaField: 'facePhoto',      folder: 'wasalny/faces' },
  insurancePhoto: { prismaField: 'insurancePhoto', folder: 'wasalny/documents' },
  profile:        { prismaField: 'facePhoto',      folder: 'wasalny/profiles' },
  avatar:         { prismaField: 'facePhoto',      folder: 'wasalny/profiles' },
};