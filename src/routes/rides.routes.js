const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requestRideSchema, rateRideSchema } = require('../validators/ride.validator');
const { getRideOptionsHandler, calculateRideFareHandler, requestRideHandler, getCurrentRideHandler, getRideHistoryHandler, cancelRideHandler, initiateKashierPaymentHandler, verifyKashierPaymentHandler, rateRideHandler, rateRideByParamHandler } = require('../controllers/ride.controller');

router.get('/options', getRideOptionsHandler);
router.get('/fare', calculateRideFareHandler);
router.post('/request', authenticateToken, validate(requestRideSchema), (req, res) => requestRideHandler(req, res, req.app.locals.io));
router.get('/current', authenticateToken, getCurrentRideHandler);
router.get('/history', authenticateToken, getRideHistoryHandler);
router.put('/cancel/:rideId', authenticateToken, cancelRideHandler);
router.post('/rate', authenticateToken, validate(rateRideSchema), rateRideHandler);
router.post('/payments/kashier/initiate', authenticateToken, initiateKashierPaymentHandler);
router.get('/payments/kashier/verify', authenticateToken, verifyKashierPaymentHandler);

// ── Rating with rideId in URL param ────────────────────
// POST /api/v1/rides/:rideId/rate
router.post('/:rideId/rate', authenticateToken, (req, res, next) => {
  // نسخ rideId من params إلى body لكي يعمل validate
  req.body.rideId = req.params.rideId;
  next();
}, validate(rateRideSchema), rateRideByParamHandler);

module.exports = router;
