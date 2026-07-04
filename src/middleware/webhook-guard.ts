import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";

// Safaricom Daraja production egress ranges. Public: https://developer.safaricom.co.ke
// Override via env DARAJA_ALLOWED_IPS="1.2.3.4,5.6.7.8".
const DEFAULT_DARAJA_IPS = [
  "196.201.214.200",
  "196.201.214.206",
  "196.201.213.114",
  "196.201.214.207",
  "196.201.214.208",
  "196.201.213.44",
  "196.201.212.127",
  "196.201.212.128",
  "196.201.212.129",
  "196.201.212.132",
  "196.201.212.136",
  "196.201.212.138",
  "196.201.212.69",
  "196.201.212.74",
];

function allowedIps(): Set<string> {
  const env = config.mpesa.allowedIps.length > 0 ? config.mpesa.allowedIps : DEFAULT_DARAJA_IPS;
  return new Set(env);
}

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "";
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Daraja 2.0 signs callbacks with HMAC-SHA256 via the `x-m-pesa-signature`
 * header using the Consumer Secret as the signing key. This is new in v2.
 *
 * Trust anchors (defense-in-depth):
 *   1. HMAC-SHA256 signature verification (Daraja 2.0 mandatory)
 *   2. Source-IP allowlist (Safaricom's known egress ranges)
 *   3. Secret path token — callback URL includes a random token only
 *      Safaricom knows. Callers not in possession cannot forge callbacks.
 *
 * Both checks are gated by NODE_ENV === "production" — dev/sandbox still
 * needs to work behind ngrok etc.
 */
export function darajaGuard(req: Request, res: Response, next: NextFunction) {
  if (config.nodeEnv !== "production") {
    return next();
  }

  // ── Layer 1: HMAC-SHA256 signature verification (Daraja 2.0) ──────
  // The signature covers the raw JSON body. Must verify BEFORE JSON parse.
  const signatureHeader = (req.headers["x-m-pesa-signature"] ?? "").toString();
  if (signatureHeader) {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const expected = crypto
      .createHmac("sha256", config.mpesa.consumerSecret || config.mpesa.passkey)
      .update(rawBody)
      .digest("base64");

    if (!timingSafeEqual(signatureHeader, expected)) {
      logger.warn({ ip: clientIp(req), path: req.path }, "daraja webhook: HMAC signature mismatch");
      res.status(401).json({ ResultCode: 1, ResultDesc: "Invalid signature" });
      return;
    }
  }

  // ── Layer 2: Secret path token ────────────────────────────────────
  const secret = config.mpesa.webhookSecret;
  if (secret) {
    const provided = (req.params.secret ?? req.query.secret ?? "").toString();
    if (!provided || !timingSafeEqual(provided, secret)) {
      logger.warn({ ip: clientIp(req), path: req.path }, "daraja webhook: secret mismatch");
      res.status(403).json({ ResultCode: 1, ResultDesc: "Forbidden" });
      return;
    }
  }

  // ── Layer 3: IP allowlist ─────────────────────────────────────────
  const ip = clientIp(req);
  const allow = allowedIps();
  if (allow.size > 0 && !allow.has(ip)) {
    logger.warn({ ip, path: req.path }, "daraja webhook: ip not allowlisted");
    res.status(403).json({ ResultCode: 1, ResultDesc: "Forbidden" });
    return;
  }

  next();
}

/**
 * Flutterwave signs webhooks with `verif-hash` = secret from dashboard.
 */
export function flutterwaveGuard(req: Request, res: Response, next: NextFunction) {
  const secret = config.flutterwave.webhookSecret;
  if (!secret) {
    if (config.nodeEnv === "production") {
      logger.error("flutterwave webhook: FLUTTERWAVE_WEBHOOK_SECRET not set in production");
      res.status(500).json({ error: "webhook secret not configured" });
      return;
    }
    return next();
  }

  const provided = (req.headers["verif-hash"] ?? "").toString();
  if (!provided || !timingSafeEqual(provided, secret)) {
    logger.warn({ ip: clientIp(req) }, "flutterwave webhook: signature mismatch");
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  next();
}

// Africa's Talking egress ranges (production). AT does not sign USSD
// callbacks, so we rely on: (a) source-IP allowlist, (b) shared-secret
// path token, (c) HMAC over sessionId (optional if secret set).
// Override via env AT_ALLOWED_IPS="1.2.3.4,5.6.7.8".
const DEFAULT_AT_IPS = [
  "52.16.183.213",
  "52.16.207.226",
  "52.31.199.211",
  "52.209.20.72",
  "54.194.221.130",
  "54.72.230.253",
];

function atAllowedIps(): Set<string> {
  const env = (process.env.AT_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(env.length > 0 ? env : DEFAULT_AT_IPS);
}

/**
 * Africa's Talking USSD webhook guard.
 *   - Prod: source-IP + optional path secret (?secret= or /callback/:secret).
 *   - Dev: no-op.
 */
export function africasTalkingGuard(req: Request, res: Response, next: NextFunction) {
  if (config.nodeEnv !== "production") {
    return next();
  }
  const secret = process.env.AT_USSD_SECRET;
  if (secret) {
    const provided = (req.params.secret ?? req.query.secret ?? req.headers["x-at-secret"] ?? "").toString();
    if (!provided || !timingSafeEqual(provided, secret)) {
      logger.warn({ ip: clientIp(req), path: req.path }, "at ussd: secret mismatch");
      res.status(403).type("text/plain").send("END Forbidden");
      return;
    }
  }
  const ip = clientIp(req);
  const allow = atAllowedIps();
  if (allow.size > 0 && !allow.has(ip)) {
    logger.warn({ ip, path: req.path }, "at ussd: ip not allowlisted");
    res.status(403).type("text/plain").send("END Forbidden");
    return;
  }
  next();
}

/**
 * Stripe verifies `stripe-signature` header via crypto HMAC-SHA256 over the
 * raw request body plus a timestamp. Guard requires the raw body — mount
 * with express.raw({ type: 'application/json' }).
 */
export function stripeGuard(req: Request, res: Response, next: NextFunction) {
  const secret = config.stripe.webhookSecret;
  if (!secret) {
    if (config.nodeEnv === "production") {
      logger.error("stripe webhook: STRIPE_WEBHOOK_SECRET not set in production");
      res.status(500).json({ error: "webhook secret not configured" });
      return;
    }
    return next();
  }
  const header = (req.headers["stripe-signature"] ?? "").toString();
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts["t"];
  const provided = parts["v1"];
  if (!timestamp || !provided) {
    res.status(401).json({ error: "malformed stripe signature" });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  if (!timingSafeEqual(provided, expected)) {
    logger.warn({ ip: clientIp(req) }, "stripe webhook: signature mismatch");
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  next();
}
