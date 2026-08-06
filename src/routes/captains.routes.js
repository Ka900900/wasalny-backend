const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload.middleware'); // 👈 1. استيراد ميدل وير الرفع
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { updateLocationSchema, toggleAvailabilitySchema } = require('../validators/ride.validator');
const { 
  updateLocationHandler, 
  getAvailableRidesHandler, 
  toggleAvailabilityHandler, 
  acceptRideHandler, 
  startRideHandler, 
  completeRideHandler, 
  getEarningsHandler, 
  getDriverRatingsHandler,
  uploadDocuments, // 👈 2. استيراد دالة رفع المستندات
  addVehicleHandler, // 👈 دالة إضافة المركبة
  getVerificationStatusHandler, // 👈 دالة التحقق من حالة التوثيق
} = require('../controllers/captain.controller');
const { getRideHistoryHandler } = require('../controllers/ride.controller');

/**
 * @swagger
 * /api/v1/captain/documents:
 *   post:
 *     summary: Upload captain documents (National ID, License, Avatar)
 *     tags: [Captain]
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/documents',
  authenticateToken,
  requireRole('CAPTAIN', 'DRIVER'), // 👈 الكابتن مسجّل بدور DRIVER — نسمح بالدورين
  upload.fields([
    { name: 'nationalIdFront', maxCount: 1 },
    { name: 'nationalIdBack', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 },
    { name: 'avatar', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'licenseBack', maxCount: 1 },
  ]),
  uploadDocuments
);

router.post(
  '/vehicle',
  authenticateToken,
  requireRole('CAPTAIN', 'DRIVER'),
  upload.fields([
    { name: 'licenseFront', maxCount: 1 },
    { name: 'licenseBack', maxCount: 1 },
  ]),
  addVehicleHandler
);

router.get('/verification-status', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), getVerificationStatusHandler);
router.put('/location', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), validate(updateLocationSchema), (req, res) => updateLocationHandler(req, res, req.app.locals.io));
router.post('/toggle-availability', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), validate(toggleAvailabilitySchema), (req, res) => toggleAvailabilityHandler(req, res, req.app.locals.io));
router.get('/available-rides', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), getAvailableRidesHandler);
router.post('/accept-ride/:rideId', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), (req, res) => acceptRideHandler(req, res, req.app.locals.io));
router.put('/ride/start/:rideId', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), (req, res) => startRideHandler(req, res, req.app.locals.io));
router.put('/ride/complete/:rideId', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), (req, res) => completeRideHandler(req, res, req.app.locals.io));

/**
 * @swagger
 * /api/v1/driver/earnings:
 *   get:
 *     summary: Get driver earnings summary (aggregated from RideRequest)
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *           default: daily
 *         description: Aggregation period (daily=last 7 days, weekly=last 8 weeks, monthly=last 12 months)
 *     responses:
 *       200:
 *         description: Earnings data
 */
// نسمح بالدورين CAPTAIN و DRIVER لأن الكابتن مسجّل بدور DRIVER في الـ schema
// (جميع مسارات الكابتن المشتركة تسمح بالدورين لتجنّب 403 "مخصص لـ CAPTAIN فقط")
router.get('/earnings', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), getEarningsHandler);
router.get('/ratings', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), getDriverRatingsHandler);

/**
 * @swagger
 * /api/v1/driver/rides/history:
 *   get:
 *     summary: Get driver ride history (alias for /api/v1/rides/history)
 *     tags: [Driver]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: List of past rides for the driver
 */
router.get('/rides/history', authenticateToken, requireRole('CAPTAIN', 'DRIVER'), getRideHistoryHandler);

module.exports = router;