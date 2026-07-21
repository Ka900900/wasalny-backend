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
  api_key: '264331839382696',
  api_secret: 'PZa9Qs-VZbDNAnqFU1u3twvhltc',
});


module.exports = cloudinary;
