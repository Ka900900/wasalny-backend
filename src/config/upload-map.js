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
 * criminal-record           → criminalRecordUrl
 * drug-test                 → drugTestUrl
 * license-number            → licenseNumber
 */
module.exports = {
  // ── Canonical and compatibility keys ──
  // Flutter app may send kebab-case or snake_case; backend accepts both.
  'id-front':               { prismaField: 'idPhotoFront',            folder: 'wasalny/documents' },
  'id_front':               { prismaField: 'idPhotoFront',            folder: 'wasalny/documents' },
  'id-back':                { prismaField: 'idPhotoBack',             folder: 'wasalny/documents' },
  'id_back':                { prismaField: 'idPhotoBack',             folder: 'wasalny/documents' },
  license:                  { prismaField: 'licensePhoto',            folder: 'wasalny/documents' },
  'license-back':           { prismaField: 'licenseBackUrl',          folder: 'wasalny/documents_back' },
  'license_back':           { prismaField: 'licenseBackUrl',          folder: 'wasalny/documents_back' },
  face:                     { prismaField: 'facePhoto',               folder: 'wasalny/faces' },
  face_photo:               { prismaField: 'facePhoto',               folder: 'wasalny/faces' },
  car:                      { prismaField: 'carPhotoUrl',             folder: 'wasalny/car_photos' },
  insurance:                { prismaField: 'insurancePhoto',          folder: 'wasalny/documents' },
  insurance_photo:          { prismaField: 'insurancePhoto',          folder: 'wasalny/documents' },
  'vehicle-license-front':  { prismaField: 'vehicleLicenseFrontUrl',  folder: 'wasalny/vehicle_licenses' },
  'vehicle_license_front':  { prismaField: 'vehicleLicenseFrontUrl',  folder: 'wasalny/vehicle_licenses' },
  'vehicle-license-back':   { prismaField: 'vehicleLicenseBackUrl',   folder: 'wasalny/vehicle_licenses' },
  'vehicle_license_back':   { prismaField: 'vehicleLicenseBackUrl',   folder: 'wasalny/vehicle_licenses' },
  'criminal-record':        { prismaField: 'criminalRecordUrl',       folder: 'wasalny/documents' },
  'criminal_record':        { prismaField: 'criminalRecordUrl',       folder: 'wasalny/documents' },
  'drug-test':              { prismaField: 'drugTestUrl',             folder: 'wasalny/documents' },
  'drug_test':              { prismaField: 'drugTestUrl',             folder: 'wasalny/documents' },
  'license-number':         { prismaField: 'licenseNumber',           folder: 'wasalny/documents' },
  'license_number':         { prismaField: 'licenseNumber',           folder: 'wasalny/documents' },

  // legacy / alternate names that may be sent by older app versions
  idPhotoFront:             { prismaField: 'idPhotoFront',    folder: 'wasalny/documents' },
  idPhotoBack:              { prismaField: 'idPhotoBack',     folder: 'wasalny/documents' },
  licensePhoto:             { prismaField: 'licensePhoto',    folder: 'wasalny/documents' },
  facePhoto:                { prismaField: 'facePhoto',       folder: 'wasalny/faces' },
  insurancePhoto:           { prismaField: 'insurancePhoto',  folder: 'wasalny/documents' },
  criminalRecord:           { prismaField: 'criminalRecordUrl', folder: 'wasalny/documents' },
  drugTest:                 { prismaField: 'drugTestUrl',       folder: 'wasalny/documents' },
  licenseNumber:            { prismaField: 'licenseNumber',     folder: 'wasalny/documents' },
  profile:                  { prismaField: 'facePhoto',       folder: 'wasalny/profiles' },
  avatar:                   { prismaField: 'facePhoto',       folder: 'wasalny/profiles' },
};