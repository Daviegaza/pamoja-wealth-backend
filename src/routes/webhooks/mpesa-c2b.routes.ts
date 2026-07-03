import { Router, raw, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { mpesaReconciliationQueue } from "../../jobs/queue.js";
import { resolveChamaForRef, type C2BCallbackPayload } from "../../services/mpesa-c2b.service.js";
import { darajaGuard, flutterwaveGuard } from "../../middleware/webhook-guard.js";

/**
 * M-Pesa C2B (paybill) webhooks.
 *
 * IMPORTANT — the URL path here deliberately avoids the strings "mpesa",
 * "m-pesa", and "safaricom". Per the research dossier (and corroborating
 * field reports), some upstream intermediaries / WAFs strip or block paths
 * containing those tokens, which would break the Safaricom→our-API hop.
 * Use `/webhooks/daraja/c2b/...` instead.
 *
 *  - validation:   synchronous, gates whether Safaricom moves the money.
 *  - confirmation: fire-and-forget, money has already moved.
 *
 * Both routes use `raw` body parsing so we can hash the exact bytes
 * Safaricom sent (the body is the only thing we can authenticate; Daraja
 * webhooks aren't signed — trust is anchored on an IP allow-list at the
 * edge + a secret in the webhook URL).
 */

const c2bRouter = Router();

function sha256(buf: Buffer): Uint8Array<ArrayBuffer> {
  const digest = crypto.createHash("sha256").update(buf).digest();
  // Force ArrayBuffer-backed Uint8Array (Prisma `Bytes` requires it, not ArrayBufferLike).
  const ab = new ArrayBuffer(digest.byteLength);
  const out = new Uint8Array(ab);
  out.set(digest);
  return out;
}

function parseRawBody(req: Request): { raw: Buffer; json: C2BCallbackPayload } {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  let json: C2BCallbackPayload = {};
  try {
    json = JSON.parse(buf.toString("utf8")) as C2BCallbackPayload;
  } catch {
    // leave json empty — handlers will return their canonical responses below.
  }
  return { raw: buf, json };
}

// ── Validation handler ──────────────────────────────────────────────
//
// Safaricom blocks on this response. We MUST reply <30s. On unknown
// BillRefNumber we return `C2B00012` (Invalid Account Number) so Safaricom
// rejects the payment — money never moves. On any known account, we accept.
c2bRouter.post(
  "/validation/:secret?",
  darajaGuard,
  raw({ type: "*/*", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const { raw: rawBody, json } = parseRawBody(req);
    const hash = sha256(rawBody);

    // Persist BEFORE responding so the raw payload exists even if we crash
    // between accepting and queueing. Use `upsert`-style behaviour via
    // try/catch — duplicate hashes are fine here, validation runs frequently.
    try {
      await prisma.mpesaCallback.create({
        data: {
          type: "c2b_validation",
          mpesaReceipt: json.TransID ?? null,
          rawPayload: json as unknown as object,
          hash,
        },
      });
    } catch (err) {
      // Hash collision (rare — same exact body re-posted) is fine; log and continue.
      logger.warn({ err }, "mpesa-c2b validation: persist failed (possibly duplicate hash)");
    }

    const billRef = (json.BillRefNumber ?? "").trim();
    if (!billRef) {
      res.status(200).json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account Number" });
      return;
    }

    const chama = await resolveChamaForRef(billRef).catch((err) => {
      logger.error({ err, billRef }, "mpesa-c2b validation: chama lookup failed");
      return null;
    });

    if (!chama || chama.status !== "active") {
      res.status(200).json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account Number" });
      return;
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  },
);

// ── Confirmation handler ────────────────────────────────────────────
//
// Safaricom has already moved the money. We dedupe on hash, persist, enqueue,
// and ALWAYS return ResultCode:0 — even on internal error (we push to retry
// queue instead). Per dossier §7.9: if we return anything else, Safaricom
// will hammer us with retries.
c2bRouter.post(
  "/confirmation/:secret?",
  darajaGuard,
  raw({ type: "*/*", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const { raw: rawBody, json } = parseRawBody(req);
    const hash = sha256(rawBody);

    try {
      // Dedupe via MpesaCallback.hash @unique.
      const existing = await prisma.mpesaCallback.findUnique({ where: { hash } });
      if (existing) {
        logger.info({ callbackId: existing.id }, "mpesa-c2b confirmation: duplicate, short-circuiting");
        res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
        return;
      }

      const callback = await prisma.mpesaCallback.create({
        data: {
          type: "c2b_confirmation",
          mpesaReceipt: json.TransID ?? null,
          rawPayload: json as unknown as object,
          hash,
        },
      });

      await mpesaReconciliationQueue.add(
        "mpesa:c2b:process",
        { callbackId: callback.id },
        {
          jobId: `c2b:${callback.id}`, // BullMQ dedupe; same callback → same job id
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    } catch (err) {
      // Critical: never let an internal failure leak into the response —
      // Safaricom would retry aggressively and we'd duplicate-process when
      // we recover. The callback row may or may not have been persisted; an
      // out-of-band reconciliation job will pick this up via the daily
      // statement download.
      logger.error({ err }, "mpesa-c2b confirmation: persist/enqueue failed — returning Success anyway");
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
  },
);

// Parent router: `/webhooks/daraja/c2b/{validation,confirmation}` — mounted by
// `src/routes/index.ts`. We avoid the strings "mpesa" / "safaricom" in the
// URL because some intermediaries filter them.
const webhooksRouter = Router();
webhooksRouter.use("/daraja/c2b", c2bRouter);

// Flutterwave subscription-payment webhook. Signed via `verif-hash` header
// (Flutterwave's docs). Body parsed as JSON by the global Express middleware
// — handler verifies signature, then routes `charge.completed` events with
// tx_ref=SUB-{invoiceId} to billing.recordInvoicePayment.
import * as billing from "../../controllers/billing.controller.js";
webhooksRouter.post("/flutterwave", flutterwaveGuard, billing.flutterwaveWebhook);

export default webhooksRouter;
