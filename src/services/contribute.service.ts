import crypto from "node:crypto";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";
import { ApiError } from "../utils/api-error.js";
import { generateReference } from "../utils/reference.js";
import { enforceRule } from "../lib/rule-enforcer.js";
import { fire as fireDaraja } from "../lib/daraja-breaker.js";
import { stkPush } from "./mpesa.service.js";
import { emitToUser } from "../websocket/index.js";

/**
 * Zero-friction contribute / donate service.
 *
 * The user presses a button + enters an amount. Within ~3 seconds, an STK
 * Push prompt lands on their phone. After they enter their PIN, the Daraja
 * STK callback hits `/wallet/deposit/mpesa-callback`, which looks up the
 * Transaction by `mpesaCheckoutRequestId` and posts to the ledger.
 *
 * UI never sees the paybill or account number — both routing tokens are
 * generated server-side and stored on `Chama.paybillAccountNumber`.
 *
 * Rate limiting: max 10 STK pushes per phone per hour (`stk-rate:{msisdn}`)
 * to protect users from a runaway client and to keep us under Daraja's
 * fair-use policy.
 */

const STK_EXPIRY_SECONDS = 90;
const STK_RATE_LIMIT_PER_HOUR = 10;
const HARAMBEE_PLATFORM_FEE_RATE = 0.025;

export interface ContributeInput {
  chamaId: string;
  userId: string;
  amount: number;
}

export interface DonateInput {
  chamaId: string;
  amount: number;
  // Authed donor (preferred):
  userId?: string;
  // Anonymous donor:
  phone?: string;
  name?: string;
  message?: string;
  isAnonymous?: boolean;
}

export interface InitiationResult {
  transactionId: string;
  checkoutRequestId: string;
  status: "stk_sent";
  expiresAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a Kenyan MSISDN to 2547XXXXXXXX (no leading +, no leading 0).
 * Accepts: `07XXXXXXXX`, `+2547XXXXXXXX`, `2547XXXXXXXX`, with optional spaces.
 */
export function normaliseMsisdn(input: string): string {
  if (!input) throw ApiError.validation("Phone number is required");
  const digits = input.replace(/[^\d]/g, "");
  let normalised: string;
  if (digits.startsWith("254") && digits.length === 12) {
    normalised = digits;
  } else if (digits.startsWith("0") && digits.length === 10) {
    normalised = `254${digits.slice(1)}`;
  } else if (digits.startsWith("7") && digits.length === 9) {
    normalised = `254${digits}`;
  } else {
    throw ApiError.validation(`Invalid Kenyan MSISDN format: ${input}`);
  }
  if (!/^2547\d{8}$/.test(normalised) && !/^2541\d{8}$/.test(normalised)) {
    throw ApiError.validation(`Invalid Kenyan MSISDN format: ${input}`);
  }
  return normalised;
}

/**
 * Generate a chama paybill-account-reference token like `CHA-AB1C2`.
 * Deterministic on chamaId so re-generation can't change a live account.
 */
function generateAccountRef(chamaId: string): string {
  const hash = crypto.createHash("sha256").update(chamaId).digest();
  // Convert the first 4 bytes into a base36 string and take the first 5 chars.
  const num = hash.readUInt32BE(0);
  const code = num.toString(36).toUpperCase().padStart(5, "0").slice(0, 5);
  return `CHA-${code}`;
}

/**
 * Lazily generate + persist a paybill account number for a chama.
 * Idempotent: on collision we re-read and use the already-stored value.
 * Never exposed to clients — this is purely the Safaricom AccountReference.
 */
export async function ensureChamaPaybillAccount(chamaId: string): Promise<string> {
  // `paybillAccountNumber` is a generated Prisma column that may not be in the
  // currently-emitted client types (we maintain the migration manually). Cast
  // through `any` for the same reason ledger.service.ts does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const chama = await db.chama.findUnique({
    where: { id: chamaId },
    select: { id: true, paybillAccountNumber: true },
  });
  if (!chama) throw ApiError.notFound("Chama", chamaId);
  if (chama.paybillAccountNumber) return chama.paybillAccountNumber as string;

  const candidate = generateAccountRef(chamaId);
  try {
    const updated = await db.chama.update({
      where: { id: chamaId },
      data: { paybillAccountNumber: candidate },
      select: { paybillAccountNumber: true },
    });
    return updated.paybillAccountNumber as string;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2002") {
      // Race with sibling worker (or hash collision). Re-read.
      const re = await db.chama.findUnique({
        where: { id: chamaId },
        select: { paybillAccountNumber: true },
      });
      if (re?.paybillAccountNumber) return re.paybillAccountNumber as string;
      // Hash collision against a DIFFERENT chama — append entropy and retry once.
      const salted = `${candidate}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const fallback = await db.chama.update({
        where: { id: chamaId },
        data: { paybillAccountNumber: salted },
        select: { paybillAccountNumber: true },
      });
      return fallback.paybillAccountNumber as string;
    }
    throw err;
  }
}

/**
 * Resolve the sender MSISDN for an authed user:
 *   1. Default MpesaAccount, if any.
 *   2. Any verified MpesaAccount.
 *   3. User.phone fallback.
 */
async function resolveSenderMsisdnForUser(userId: string): Promise<string> {
  const accounts = await prisma.mpesaAccount.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { isVerified: "desc" }, { lastUsed: "desc" }],
  });
  const preferred = accounts[0]?.phoneNumber;
  if (preferred) return normaliseMsisdn(preferred);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  if (!user?.phone) {
    throw ApiError.validation("No M-Pesa number on file. Add one in Wallet settings.");
  }
  return normaliseMsisdn(user.phone);
}

/**
 * Per-phone STK Push rate limit (default 10/hour). Throws RateLimited at the cap.
 * Counter sits in Redis at `stk-rate:{msisdn}` with a 1h sliding TTL.
 */
async function enforceStkRateLimit(msisdn: string): Promise<void> {
  const key = `stk-rate:${msisdn}`;
  let count = 0;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
  } catch (err) {
    logger.warn({ err, msisdn }, "stk-rate: redis unavailable, allowing through");
    return;
  }
  if (count > STK_RATE_LIMIT_PER_HOUR) {
    throw ApiError.rateLimited(
      `Too many STK Push attempts on this number — try again in an hour.`,
    );
  }
}

function expiryIso(): string {
  return new Date(Date.now() + STK_EXPIRY_SECONDS * 1000).toISOString();
}

// ── Public: contribute ──────────────────────────────────────────────

export async function contribute(input: ContributeInput): Promise<InitiationResult> {
  const { chamaId, userId, amount } = input;
  if (!Number.isFinite(amount) || amount < 1 || amount > 250_000) {
    throw ApiError.validation("Amount must be between 1 and 250,000 KES");
  }

  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    select: { id: true, name: true, status: true, type: true },
  });
  if (!chama) throw ApiError.notFound("Chama", chamaId);
  if (chama.status !== "active") {
    throw ApiError.validation(`Chama is ${chama.status} — contributions are paused.`);
  }

  const membership = await prisma.membership.findFirst({
    where: { chamaId, userId, status: "active" },
    select: { id: true },
  });
  if (!membership) {
    throw ApiError.forbidden("You are not an active member of this chama.");
  }

  // Rule engine hook — shadow mode or enforce, depending on feature flag.
  await enforceRule("contribution_received", chamaId, { userId, amount });

  const msisdn = await resolveSenderMsisdnForUser(userId);
  await enforceStkRateLimit(msisdn);

  const accountRef = await ensureChamaPaybillAccount(chamaId);
  const reference = generateReference("CON");

  // Persist Transaction BEFORE invoking Daraja so we always have a row to
  // attach the CheckoutRequestID to (and to fall back on for status polling).
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      chamaId,
      type: "contribution",
      amount,
      balanceAfter: 0, // updated on callback
      method: "mpesa",
      reference,
      description: "STK push pending",
      status: "pending",
      mpesaPhone: msisdn,
    },
  });

  let stk: { checkoutRequestId: string; merchantRequestId: string };
  try {
    stk = await fireDaraja(stkPush, msisdn, amount, accountRef);
  } catch (err) {
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "failed", description: `STK initiation failed: ${(err as Error).message}`.slice(0, 500) },
    });
    logger.error({ err, transactionId: transaction.id }, "contribute: STK Push failed");
    throw ApiError.internal("Failed to start M-Pesa prompt. Please try again.");
  }

  // Cast through `any` because the generated Prisma client may not yet know
  // about the new mpesaCheckout/MerchantRequestId columns until prisma
  // generate runs against the updated schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).transaction.update({
    where: { id: transaction.id },
    data: {
      mpesaCheckoutRequestId: stk.checkoutRequestId,
      mpesaMerchantRequestId: stk.merchantRequestId,
    },
  });

  // In-app live receipt event: "we sent the prompt, watch your phone".
  emitToUser(userId, "payment:initiated", {
    transactionId: transaction.id,
    checkoutRequestId: stk.checkoutRequestId,
    status: "stk_sent",
    chamaId,
    chamaName: chama.name,
    amount,
  });

  return {
    transactionId: transaction.id,
    checkoutRequestId: stk.checkoutRequestId,
    status: "stk_sent",
    expiresAt: expiryIso(),
  };
}

// ── Public: donate (harambee) ───────────────────────────────────────

export async function donate(input: DonateInput): Promise<InitiationResult> {
  const { chamaId, userId, amount } = input;
  if (!Number.isFinite(amount) || amount < 1 || amount > 250_000) {
    throw ApiError.validation("Amount must be between 1 and 250,000 KES");
  }

  const chama = await prisma.chama.findUnique({
    where: { id: chamaId },
    select: { id: true, name: true, status: true, type: true, privacy: true },
  });
  if (!chama) throw ApiError.notFound("Chama", chamaId);
  if (chama.status !== "active") {
    throw ApiError.validation(`Chama is ${chama.status} — donations are paused.`);
  }
  const isPublicMode = chama.type === "fundraiser" || chama.privacy === "public";
  if (!isPublicMode) {
    throw ApiError.forbidden("This group does not accept public donations.");
  }

  let msisdn: string;
  let resolvedUserId: string | null = null;
  if (userId) {
    msisdn = await resolveSenderMsisdnForUser(userId);
    resolvedUserId = userId;
  } else {
    if (!input.phone) {
      throw ApiError.validation("Phone number is required for anonymous donations.");
    }
    msisdn = normaliseMsisdn(input.phone);
  }

  await enforceStkRateLimit(msisdn);

  // Rule engine hook — harambee donations use the same hook point. Skip if
  // anonymous (no userId to evaluate against member-only rules).
  if (resolvedUserId) {
    await enforceRule("contribution_received", chamaId, { userId: resolvedUserId, amount });
  }

  const accountRef = await ensureChamaPaybillAccount(chamaId);
  const reference = generateReference("DON");

  // For anonymous donors, attribute the transaction to a system user is overkill.
  // Instead, we attach to the chama's owner so the FK isn't violated, but the
  // ledger / Donation row will record the real donor MSISDN + name.
  let txUserId: string | null = resolvedUserId;
  if (!txUserId) {
    const owner = await prisma.membership.findFirst({
      where: { chamaId, role: "owner" },
      select: { userId: true },
    });
    if (!owner) {
      throw ApiError.internal("Chama has no owner — cannot route anonymous donation.");
    }
    txUserId = owner.userId;
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: txUserId,
      chamaId,
      type: "contribution",
      amount,
      balanceAfter: 0,
      method: "mpesa",
      reference,
      description: JSON.stringify({
        kind: "harambee_donation",
        anonymous: !resolvedUserId,
        donorName: input.name ?? null,
        donorMessage: input.message ?? null,
        isAnonymous: !!input.isAnonymous,
      }),
      status: "pending",
      mpesaPhone: msisdn,
    },
  });

  let stk: { checkoutRequestId: string; merchantRequestId: string };
  try {
    stk = await fireDaraja(stkPush, msisdn, amount, accountRef);
  } catch (err) {
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "failed", description: `STK initiation failed: ${(err as Error).message}`.slice(0, 500) },
    });
    logger.error({ err, transactionId: transaction.id }, "donate: STK Push failed");
    throw ApiError.internal("Failed to start M-Pesa prompt. Please try again.");
  }

  // Cast through `any` because the generated Prisma client may not yet know
  // about the new mpesaCheckout/MerchantRequestId columns until prisma
  // generate runs against the updated schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).transaction.update({
    where: { id: transaction.id },
    data: {
      mpesaCheckoutRequestId: stk.checkoutRequestId,
      mpesaMerchantRequestId: stk.merchantRequestId,
    },
  });

  // Emit only if we have a real (authed) recipient — anonymous donors don't have
  // a Socket.io session.
  if (resolvedUserId) {
    emitToUser(resolvedUserId, "payment:initiated", {
      transactionId: transaction.id,
      checkoutRequestId: stk.checkoutRequestId,
      status: "stk_sent",
      chamaId,
      chamaName: chama.name,
      amount,
      kind: "donation",
    });
  }

  return {
    transactionId: transaction.id,
    checkoutRequestId: stk.checkoutRequestId,
    status: "stk_sent",
    expiresAt: expiryIso(),
  };
}

// ── Re-exports for callback / poller integration ─────────────────────

export const _internals = {
  HARAMBEE_PLATFORM_FEE_RATE,
  STK_EXPIRY_SECONDS,
  generateAccountRef,
};
