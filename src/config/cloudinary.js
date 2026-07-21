/**
 * Cloudinary configuration.
 * Uses standard environment variables:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const cloudinary = require('cloudinary').v2;
 

cloudinary.config({
  cloud_name: 'daxl7bn0m',
  api_key: '2112358381772155',
  api_secret: 'cT06wH9S8xVbZhaYiO2tEGzVWBE',
});


module.exports = cloudinary;
