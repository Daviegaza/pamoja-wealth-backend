import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter, otpResendLimiter } from "../middleware/rate-limit.js";
import {
  registerSchema, loginSchema, verifyOtpSchema, resendOtpSchema,
  forgotPasswordSchema, resetPasswordSchema, refreshSchema,
  enable2faSchema, verify2faSchema,
} from "../validators/auth.schema.js";
import * as auth from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", validate(registerSchema), auth.register);
router.post("/login", authLimiter, validate(loginSchema), auth.login);
router.post("/verify-otp", validate(verifyOtpSchema), auth.verifyOtp);
router.post("/resend-otp", otpResendLimiter, validate(resendOtpSchema), auth.resendOtp);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), auth.resetPassword);
router.post("/refresh", validate(refreshSchema), auth.refresh);
router.post("/logout", authenticate, auth.logout);
router.post("/enable-2fa", authenticate, validate(enable2faSchema), auth.enable2fa);
router.post("/verify-2fa", authenticate, validate(verify2faSchema), auth.verify2fa);

export default router;
