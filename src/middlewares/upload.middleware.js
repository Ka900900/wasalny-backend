const multer = require('multer');
// IMPORTANT: pass the FULL cloudinary module (not .v2) to multer-storage-cloudinary.
// The library internally does `this.cloudinary.v2.uploader...`, so it needs the
// top-level module that exposes `.v2`. Passing `.v2` directly causes
// "Cannot read properties of undefined (reading 'uploader')".
const cloudinary = require('cloudinary');
const cloudinaryStorageModule = require('multer-storage-cloudinary');

// multer-storage-cloudinary exports differently across versions:
//   v2.x: default export = factory function
//   v4.x: named export { CloudinaryStorage } = factory function
// In both cases it is a FACTORY (call without `new`).
const CloudinaryStorage =
  cloudinaryStorageModule.CloudinaryStorage || cloudinaryStorageModule;

// إعداد Cloudinary (v2)
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// إنشاء Storage — pass the full module so the library can reach `.v2.uploader`
const storage = CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'wasalny',
    allowed_formats: ['jpg', 'jpeg', 'png'],
  },
});

// إنشاء Multer
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type'));
    }

    cb(null, true);
  },
});

module.exports = upload;