/**
 * Cloudinary configuration.
 * Uses standard environment variables:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const cloudinary = require('cloudinary').v2;

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: 'dax17bn0m',
  api_key: '778245346761483',
  api_secret: 'riQEWC4NSBMQ8M6DnXMj9_ApZbg',
});


module.exports = cloudinary;
