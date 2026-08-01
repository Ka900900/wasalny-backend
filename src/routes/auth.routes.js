const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { authenticateToken } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../validators/auth.validator");

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", authController.login);
router.post("/firebase", authController.login);
router.post("/register-fcm-token", authenticateToken, authController.registerFcmToken);
router.post("/update-phone", authenticateToken, authController.updatePhoneNumber);
router.post("/forgot-password", validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);

module.exports = router;