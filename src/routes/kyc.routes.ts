/**
 * KYC Routes
 *
 * POST   /kyc/upload       — Upload KYC document (ID, selfie, proof of address)
 * GET    /kyc/status        — Get current KYC status & limits
 * POST   /kyc/check-limit   — Check if a contribution amount is allowed
 * GET    /kyc/export        — Export all user data (DPA 2019 right of access)
 * DELETE /kyc/erase         — Erase all user data (DPA 2019 right to erasure)
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import {
  getKycStatus,
  canContribute,
  uploadKycDocument,
  exportUserData,
  eraseUserData,
} from "../services/kyc.service.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import multer from "multer";

const router = Router();

// Configure multer for file uploads (25MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/heic", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Accepted: JPEG, PNG, HEIC, PDF."));
    }
  },
});

// ── KYC Status ────────────────────────────────────────────────────

/**
 * GET /kyc/status
 * Get current user's KYC tier, verification status, and limits.
 */
router.get("/kyc/status", authenticate, async (req, res) => {
  const status = await getKycStatus(req.user!.userId);
  success(res, status);
});

/**
 * POST /kyc/check-limit
 * Check if user can make a contribution of the given amount.
 */
const checkLimitSchema = z.object({
  amount: z.number().positive(),
});

router.post(
  "/kyc/check-limit",
  authenticate,
  validate(checkLimitSchema),
  async (req, res) => {
    const result = await canContribute(req.user!.userId, req.body.amount);
    success(res, result);
  },
);

// ── KYC Document Upload ──────────────────────────────────────────

const uploadSchema = z.object({
  documentType: z.enum(["national_id", "passport", "selfie", "proof_of_address"]),
});

/**
 * POST /kyc/upload
 * Upload a KYC document for verification.
 */
router.post(
  "/kyc/upload",
  authenticate,
  upload.single("file"),
  validate(uploadSchema),
  async (req, res) => {
    if (!req.file) {
      throw ApiError.validation("No file provided");
    }

    const result = await uploadKycDocument(
      req.user!.userId,
      req.file.buffer,
      req.file.originalname,
      req.body.documentType,
      req.file.mimetype,
    );

    success(res, result, undefined, 201);
  },
);

// ── Data Privacy (Kenya DPA 2019) ────────────────────────────────

/**
 * GET /kyc/export
 * Export all user data (right of access / data portability).
 */
router.get("/kyc/export", authenticate, async (req, res) => {
  const data = await exportUserData(req.user!.userId);
  success(res, data);
});

/**
 * DELETE /kyc/erase
 * Erase all user data (right to erasure). Requires re-authentication.
 */
const eraseSchema = z.object({
  confirmation: z.literal("DELETE_MY_DATA"),
});

router.delete(
  "/kyc/erase",
  authenticate,
  validate(eraseSchema),
  async (req, res) => {
    await eraseUserData(req.user!.userId);
    success(res, { message: "User data erased successfully" });
  },
);

export default router;
