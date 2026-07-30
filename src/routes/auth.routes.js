const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { authenticateToken } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { registerSchema } = require("../validators/auth.validator");

router.post("/register",validate(registerSchema), authController.register);
router.post("/login",validate(loginSchema), authController.login);
router.post("/firebase", authController.login);
router.post("/register-fcm-token", authenticateToken, authController.registerFcmToken);
router.post("/update-phone", authenticateToken, authController.updatePhoneNumber);

module.exports = router;
