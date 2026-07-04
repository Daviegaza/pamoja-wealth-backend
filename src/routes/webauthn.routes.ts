/**
 * WebAuthn ceremony routes.
 *
 *   POST /webauthn/register/options       — challenge for credentials.create()
 *   POST /webauthn/register/verify        — persist new authenticator
 *   POST /webauthn/authenticate/options   — challenge for credentials.get()
 *   POST /webauthn/authenticate/verify    — verify assertion
 *   GET  /webauthn/credentials            — list mine
 *   DELETE /webauthn/credentials/:id      — remove one
 *
 * All routes 503 with `webauthn_not_installed` when the optional peer
 * `@simplewebauthn/server` is missing — FE falls back to the placeholder
 * biometric-token flow.
 */
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import * as webauthn from "../services/webauthn.service.js";

const router = Router();

async function guard(): Promise<void> {
  const enabled = await webauthn.isEnabled();
  if (!enabled) {
    throw new ApiError("WEBAUTHN_UNAVAILABLE", "WebAuthn not installed on this server", 503);
  }
}

router.post("/webauthn/register/options", authenticate, async (req, res, next) => {
  try {
    await guard();
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, fullName: true, email: true },
    });
    if (!user) throw ApiError.notFound("User");
    const options = await webauthn.buildRegistrationOptions(user.id, user.fullName || user.email);
    success(res, options);
  } catch (err) { next(err); }
});

router.post("/webauthn/register/verify", authenticate, async (req, res, next) => {
  try {
    await guard();
    const result = await webauthn.verifyRegistration(req.user!.userId, req.body?.response ?? req.body);
    if (req.body?.label && result.credentialId) {
      await prisma.webauthnCredential.updateMany({
        where: { userId: req.user!.userId, credentialId: Buffer.from(result.credentialId, "base64url") },
        data: { label: String(req.body.label).slice(0, 80) },
      });
    }
    success(res, result);
  } catch (err) { next(err); }
});

router.post("/webauthn/authenticate/options", authenticate, async (req, res, next) => {
  try {
    await guard();
    const options = await webauthn.buildAuthenticationOptions(req.user!.userId);
    success(res, options);
  } catch (err) { next(err); }
});

router.post("/webauthn/authenticate/verify", authenticate, async (req, res, next) => {
  try {
    await guard();
    const result = await webauthn.verifyAuthentication(req.user!.userId, req.body?.response ?? req.body);
    success(res, result);
  } catch (err) { next(err); }
});

router.get("/webauthn/credentials", authenticate, async (req, res, next) => {
  try {
    const rows = await prisma.webauthnCredential.findMany({
      where: { userId: req.user!.userId },
      select: { id: true, label: true, deviceType: true, backedUp: true, lastUsedAt: true, createdAt: true, transports: true },
      orderBy: { createdAt: "desc" },
    });
    success(res, rows);
  } catch (err) { next(err); }
});

router.delete("/webauthn/credentials/:id", authenticate, async (req, res, next) => {
  try {
    await prisma.webauthnCredential.deleteMany({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    success(res, { ok: true });
  } catch (err) { next(err); }
});

export default router;
