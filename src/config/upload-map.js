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
module.exports = {
  idPhotoFront: { prismaField: 'idPhotoFront', folder: 'wasalny/documents' },
  idPhotoBack: { prismaField: 'idPhotoBack', folder: 'wasalny/documents' },
  licensePhoto: { prismaField: 'licensePhoto', folder: 'wasalny/documents' },
  facePhoto: { prismaField: 'facePhoto', folder: 'wasalny/faces' },
  insurancePhoto: { prismaField: 'insurancePhoto', folder: 'wasalny/documents' },
  
  // تزويد المسارات المترادفة لتفادي خطأ 500
  profile: { prismaField: 'facePhoto', folder: 'wasalny/profiles' },
  avatar: { prismaField: 'facePhoto', folder: 'wasalny/profiles' }
};