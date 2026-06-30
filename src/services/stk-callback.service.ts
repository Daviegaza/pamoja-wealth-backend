import crypto from "node:crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import * as ledger from "./ledger.service.js";
import { emitToUser, emitToChama } from "../websocket/index.js";
import { getMeta } from "./mpesa.service.js";

/**
 * Centralised STK Push callback / status processor.
 *
 * Invoked from two callers:
 *   1. POST /wallet/deposit/mpesa-callback (Safaricom-initiated)
 *   2. The `stk-status-poll` scheduler (timed backfill — RESEARCH_DOSSIER §4
 *      "ResultCode 0 != money moved" gotcha: STK can succeed silently)
 *
 * Behaviour:
 *   - Persist raw payload into MpesaCallback (hash-deduped) for replay safety.
 *   - Look up the matching Transaction by CheckoutRequestID.
 *   - On ResultCode 0: post ledger (contribution or harambee donation per
 *     Chama.type), mark Transaction completed, emit `payment:completed`.
 *   - On non-zero ResultCode: mark Transaction failed, emit `payment:failed`.
 *   - Always idempotent — replays don't double-credit.
 */

const HARAMBEE_PLATFORM_FEE_RATE = 0.025;

export interface StkCallbackPayload {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: {
        Item?: Array<{ Name?: string; Value?: unknown }>;
      };
    };
  };
}

export interface ProcessResult {
  matched: boolean;
  transactionId?: string;
  status?: "completed" | "failed";
  reason?: string;
}

function sha256(buf: Buffer): Buffer {
  return crypto.createHash("sha256").update(buf).digest();
}

function rawBytes(payload: unknown): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  try {
    return Buffer.from(JSON.stringify(payload ?? {}));
  } catch {
    return Buffer.from("");
  }
}

async function persistRawCallback(payload: unknown, mpesaReceipt: string | null, checkoutRequestId: string | null): Promise<void> {
  const buf = rawBytes(payload);
  const hash = sha256(buf);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).mpesaCallback.create({
      data: {
        type: "stk",
        checkoutRequestId,
        mpesaReceipt,
        rawPayload: (typeof payload === "object" && payload !== null ? payload : { raw: String(payload) }) as object,
        hash,
      },
    });
  } catch (err) {
    // P2002 = duplicate hash, fine — this is a replay.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2002") {
      logger.warn({ err }, "stk-callback: persist failed (non-duplicate)");
    }
  }
}

/**
 * Process a normalised STK callback body OR a poll-derived equivalent.
 *
 * `payload.Body.stkCallback` must be present. If `CallbackMetadata.Item` is
 * absent on a success ResultCode (rare — only happens via the status poll path
 * before the real callback arrives), we leave the ledger post for the next
 * cycle (returning matched=false). The Transaction status stays `pending`.
 */
export async function processStkCallback(payload: unknown): Promise<ProcessResult> {
  const body = (payload ?? {}) as StkCallbackPayload;
  const stk = body.Body?.stkCallback;
  if (!stk) {
    logger.warn({ payload }, "stk-callback: missing Body.stkCallback");
    return { matched: false, reason: "no-stk-payload" };
  }

  const checkoutRequestId = stk.CheckoutRequestID ?? null;
  const resultCode = typeof stk.ResultCode === "number" ? stk.ResultCode : Number(stk.ResultCode);
  const resultDesc = String(stk.ResultDesc ?? "");
  const items = stk.CallbackMetadata?.Item ?? [];
  const mpesaReceipt = (getMeta(items, "MpesaReceiptNumber") as string | undefined) ?? null;

  await persistRawCallback(payload, mpesaReceipt, checkoutRequestId);

  if (!checkoutRequestId) {
    return { matched: false, reason: "no-checkout-request-id" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (prisma as any).transaction.findFirst({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    select: {
      id: true,
      userId: true,
      chamaId: true,
      amount: true,
      status: true,
      description: true,
    },
  }) as {
    id: string;
    userId: string;
    chamaId: string | null;
    amount: Decimal;
    status: string;
    description: string | null;
  } | null;

  if (!tx) {
    logger.warn({ checkoutRequestId }, "stk-callback: no Transaction found for CheckoutRequestID");
    return { matched: false, reason: "no-transaction" };
  }

  // Replay protection — if already completed/failed, just re-emit and return.
  if (tx.status === "completed" || tx.status === "failed") {
    logger.info(
      { transactionId: tx.id, status: tx.status },
      "stk-callback: transaction already in terminal state, skipping",
    );
    return { matched: true, transactionId: tx.id, status: tx.status as "completed" | "failed" };
  }

  // ── Failure branch ───────────────────────────────────────────────
  if (resultCode !== 0) {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        description: `STK Push failed: ${resultDesc || `code ${resultCode}`}`.slice(0, 500),
      },
    });
    emitToUser(tx.userId, "payment:failed", {
      transactionId: tx.id,
      checkoutRequestId,
      resultCode,
      reason: resultDesc,
    });
    return { matched: true, transactionId: tx.id, status: "failed", reason: resultDesc };
  }

  // ── Success branch ───────────────────────────────────────────────
  // Need metadata to post the ledger. If absent (poller short-circuit), bail.
  if (!mpesaReceipt) {
    logger.warn(
      { checkoutRequestId, transactionId: tx.id },
      "stk-callback: ResultCode=0 but missing MpesaReceiptNumber — leaving pending",
    );
    return { matched: true, transactionId: tx.id, reason: "no-receipt-yet" };
  }

  const amount = Number(getMeta(items, "Amount") ?? tx.amount);
  const phoneNumber = String(getMeta(items, "PhoneNumber") ?? "");

  if (!tx.chamaId) {
    // Plain wallet deposit — out of scope here, defer to wallet.service.
    logger.info({ transactionId: tx.id }, "stk-callback: no chamaId, deferring to wallet processing");
    return { matched: false, reason: "no-chama-id" };
  }

  const chama = await prisma.chama.findUnique({
    where: { id: tx.chamaId },
    select: { id: true, name: true, type: true, privacy: true },
  });
  if (!chama) {
    logger.error({ transactionId: tx.id, chamaId: tx.chamaId }, "stk-callback: linked chama missing");
    return { matched: false, reason: "chama-missing" };
  }

  // Decide: contribution vs harambee donation. We treat fundraiser type OR
  // public-privacy chama with an unparseable JSON description as "donation"
  // ONLY if there's no active Membership for the user. This mirrors
  // mpesa-c2b.service so the same money flows through the same ledger paths.
  const membership = await prisma.membership.findFirst({
    where: { chamaId: chama.id, userId: tx.userId, status: "active" },
    select: { id: true },
  });
  const isPublicMode = chama.type === "fundraiser" || chama.privacy === "public";
  let isHarambee = false;
  let donorInfo: { name?: string; message?: string; isAnonymous?: boolean } = {};
  if (tx.description) {
    try {
      const parsed = JSON.parse(tx.description);
      if (parsed?.kind === "harambee_donation") {
        isHarambee = true;
        donorInfo = {
          name: parsed.donorName ?? undefined,
          message: parsed.donorMessage ?? undefined,
          isAnonymous: !!parsed.isAnonymous,
        };
      }
    } catch {
      // Not a JSON description — fall back to membership/public-mode heuristic.
    }
  }
  if (!isHarambee && !membership && isPublicMode) {
    isHarambee = true;
  }

  const idempotencyKey = `stk-push:${mpesaReceipt}`;
  const amountDecimal = new Decimal(amount);

  try {
    if (isHarambee) {
      const fee = amountDecimal.mul(HARAMBEE_PLATFORM_FEE_RATE);
      await ledger.recordHarambeeDonation({
        chamaId: chama.id,
        donorMsisdn: phoneNumber || undefined,
        donorUserId: tx.userId,
        amountKes: amountDecimal,
        platformFeeKes: fee,
        mpesaReceipt,
        idempotencyKey,
      });

      // Mirror into Donation table for the public donor wall.
      await prisma.donation
        .create({
          data: {
            chamaId: chama.id,
            userId: donorInfo.isAnonymous ? null : tx.userId,
            donorName: donorInfo.name ?? null,
            donorPhone: phoneNumber || null,
            amount,
            message: donorInfo.message ?? null,
            isAnonymous: !!donorInfo.isAnonymous,
            paymentMethod: "mpesa",
            reference: mpesaReceipt,
          },
        })
        .catch((err) => {
          const code = (err as { code?: string } | null)?.code;
          if (code !== "P2002") {
            logger.warn({ err, transactionId: tx.id }, "stk-callback: donation row create failed");
          }
        });
    } else {
      await ledger.recordContribution({
        chamaId: chama.id,
        fromMsisdn: phoneNumber || "0",
        memberUserId: tx.userId,
        amountKes: amountDecimal,
        mpesaReceipt,
        idempotencyKey,
      });
    }
  } catch (err) {
    logger.error({ err, transactionId: tx.id }, "stk-callback: ledger post failed");
    // Persist the error so reconciliation picks it up. Do NOT mark the
    // Transaction failed (the money DID move) — leave pending for retry.
    return { matched: true, transactionId: tx.id, reason: "ledger-post-failed" };
  }

  // Compute new wallet/chama balance to emit (best-effort).
  let newBalance: string | undefined;
  try {
    newBalance = (await ledger.balanceForUser(tx.userId)).toString();
  } catch {
    /* swallow — not load-bearing */
  }

  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      status: "completed",
      mpesaReceipt,
      mpesaPhone: phoneNumber || undefined,
      balanceAfter: newBalance ? new Decimal(newBalance) : tx.amount,
      description: isHarambee ? `Harambee donation to ${chama.name}` : `Contribution to ${chama.name}`,
    },
  });

  const receiptEvent = {
    transactionId: tx.id,
    checkoutRequestId,
    mpesaReceipt,
    amount,
    newBalance,
    group: {
      id: chama.id,
      name: chama.name,
      kind: isHarambee ? "harambee" : "chama",
    },
  };
  emitToUser(tx.userId, "payment:completed", receiptEvent);
  emitToChama(chama.id, "payment:completed", receiptEvent);

  return { matched: true, transactionId: tx.id, status: "completed" };
}
