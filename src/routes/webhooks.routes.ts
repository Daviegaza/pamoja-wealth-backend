import express, { Router, type Request, type Response } from "express";
import { flutterwaveGuard, paystackGuard } from "../middleware/webhook-guard.js";
import { logger } from "../config/logger.js";
import * as billing from "../services/billing.service.js";
import type { BillingProvider } from "../services/payment-providers.js";

/**
 * Subscription-payment webhooks. Mounted in app.ts BEFORE the global JSON
 * parser so the guards see the raw bytes for signature checks.
 *
 * Flow: signature check -> extract OUR reference -> verify with the provider
 * API (status + amount + currency) -> activate. The body itself is never
 * trusted for amounts or status.
 */
const router = Router();
const raw = express.raw({ type: "*/*", limit: "256kb" });

function handler(provider: BillingProvider) {
  return async (req: Request, res: Response) => {
    let body: unknown;
    try {
      body = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      res.status(400).json({ error: "invalid JSON" });
      return;
    }
    const reference = billing.referenceFromWebhook(provider, body);
    if (!reference) {
      // Not an event we act on (or not one of our subscription references).
      res.status(200).json({ received: true });
      return;
    }
    try {
      const outcome = await billing.verifyAndActivate(reference, null);
      logger.info({ provider, reference, outcome }, "subscription webhook processed");
      res.status(200).json({ received: true });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) {
        logger.warn({ provider, reference }, "subscription webhook for unknown reference");
        res.status(200).json({ received: true });
        return;
      }
      // Provider verify failed (network etc.): 500 so the provider retries.
      logger.error({ err, provider, reference }, "subscription webhook verification failed");
      res.status(500).json({ error: "verification failed, retry later" });
    }
  };
}

router.post("/flutterwave", raw, flutterwaveGuard, (req, res) => void handler("flutterwave")(req, res));
router.post("/paystack", raw, paystackGuard, (req, res) => void handler("paystack")(req, res));

export default router;
