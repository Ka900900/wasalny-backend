const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { updateLocationSchema, toggleAvailabilitySchema } = require('../validators/ride.validator');
const { updateLocationHandler, getAvailableRidesHandler, toggleAvailabilityHandler, acceptRideHandler, startRideHandler, completeRideHandler, getEarningsHandler, getDriverRatingsHandler } = require('../controllers/captain.controller');
const { getRideHistoryHandler } = require('../controllers/ride.controller');

router.put('/location', authenticateToken, requireRole('DRIVER'), validate(updateLocationSchema), (req, res) => updateLocationHandler(req, res, req.app.locals.io));
router.post('/toggle-availability', authenticateToken, requireRole('DRIVER'), validate(toggleAvailabilitySchema), (req, res) => toggleAvailabilityHandler(req, res, req.app.locals.io));
router.get('/available-rides', authenticateToken, requireRole('DRIVER'), getAvailableRidesHandler);
router.post('/accept-ride/:rideId', authenticateToken, requireRole('DRIVER'), (req, res) => acceptRideHandler(req, res, req.app.locals.io));
router.put('/ride/start/:rideId', authenticateToken, requireRole('DRIVER'), (req, res) => startRideHandler(req, res, req.app.locals.io));
router.put('/ride/complete/:rideId', authenticateToken, requireRole('DRIVER'), (req, res) => completeRideHandler(req, res, req.app.locals.io));
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
router.get('/earnings', authenticateToken, requireRole('DRIVER'), getEarningsHandler);
router.get('/ratings', authenticateToken, requireRole('DRIVER'), getDriverRatingsHandler);

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
router.get('/rides/history', authenticateToken, requireRole('DRIVER'), getRideHistoryHandler);

module.exports = router;
