import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";

/**
 * Webhook authenticity guards for SaaS-subscription payment providers.
 *
 * These guards FAIL CLOSED in every environment: if the shared secret is not
 * configured the webhook is rejected (503), never waved through. They need the
 * raw request body (mount the route with `express.raw({ type: "*\/*" })`
 * BEFORE the global JSON parser) so the signature is computed over the exact
 * bytes the provider sent.
 *
 * A valid signature only proves the provider sent the event. The handlers
 * still re-verify the transaction with the provider's API (status, amount,
 * currency) before activating anything; the webhook body is never trusted.
 */

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function rawBody(req: Request): Buffer | null {
  return Buffer.isBuffer(req.body) ? req.body : null;
}

/** Flutterwave sends the dashboard "secret hash" verbatim in `verif-hash`. */
export function flutterwaveGuard(req: Request, res: Response, next: NextFunction) {
  const secret = config.flutterwave.webhookSecret;
  if (!secret) {
    logger.error("flutterwave webhook rejected: FLUTTERWAVE_WEBHOOK_SECRET not configured");
    res.status(503).json({ error: "webhook not configured" });
    return;
  }
  if (!rawBody(req)) {
    res.status(400).json({ error: "raw body required" });
    return;
  }
  const provided = String(req.headers["verif-hash"] ?? "");
  if (!provided || !timingSafeEqualStr(provided, secret)) {
    logger.warn({ ip: req.ip }, "flutterwave webhook: signature mismatch");
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  next();
}

/** Paystack signs the raw body with HMAC-SHA512 using the secret key. */
export function paystackGuard(req: Request, res: Response, next: NextFunction) {
  const secret = config.paystack.secretKey;
  if (!secret) {
    logger.error("paystack webhook rejected: PAYSTACK_SECRET_KEY not configured");
    res.status(503).json({ error: "webhook not configured" });
    return;
  }
  const body = rawBody(req);
  if (!body) {
    res.status(400).json({ error: "raw body required" });
    return;
  }
  const provided = String(req.headers["x-paystack-signature"] ?? "");
  const expected = crypto.createHmac("sha512", secret).update(body).digest("hex");
  if (!provided || !timingSafeEqualStr(provided, expected)) {
    logger.warn({ ip: req.ip }, "paystack webhook: signature mismatch");
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  next();
}
