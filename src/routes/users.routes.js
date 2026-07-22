const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getProfileHandler, updateProfileHandler, deleteAccountHandler } = require('../controllers/user.controller');
const { getRatingsHandler } = require('../controllers/ride.controller');

router.get('/profile', authenticateToken, getProfileHandler);
router.put('/profile/update', authenticateToken, updateProfileHandler);
router.delete('/account', authenticateToken, deleteAccountHandler);
router.get('/ratings/:userId', authenticateToken, getRatingsHandler);

module.exports = router;
