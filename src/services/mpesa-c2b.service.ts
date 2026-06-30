import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import * as ledger from "./ledger.service.js";

/**
 * M-Pesa C2B (paybill) processing service.
 *
 * Two responsibilities:
 *   1. processConfirmation(callbackId): invoked by BullMQ `mpesa:c2b:process`.
 *      Fetches a previously-persisted MpesaCallback row, resolves the chama
 *      from BillRefNumber, decides whether this is a member contribution or a
 *      public donation, and posts to the ledger. On error, marks the callback
 *      with errorMessage and rethrows so BullMQ retries with backoff.
 *   2. resolveChamaForRef(ref): tiny helper shared with the validation route.
 *
 * The actual money-event has already happened at this point (Safaricom moved
 * the funds before invoking our confirmation URL). This worker just records
 * it. The validation URL is what stops bad money from entering in the first
 * place.
 */

export interface C2BCallbackPayload {
  TransactionType?: string;
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string;
  BillRefNumber?: string;
  InvoiceNumber?: string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
}

// Platform fee for public harambee donations — RESEARCH_DOSSIER.md §4
// ("Fee model — donor pays platform fee … 2.5-3% all-in").
const HARAMBEE_PLATFORM_FEE_RATE = 0.025;

export async function resolveChamaForRef(billRefNumber: string) {
  if (!billRefNumber) return null;
  return prisma.chama.findUnique({
    where: { paybillAccountNumber: billRefNumber.trim() },
    select: { id: true, name: true, type: true, privacy: true, status: true },
  });
}

function normalisePhone(msisdn: string | undefined): string {
  if (!msisdn) return "";
  // Safaricom sends MSISDN as 2547XXXXXXXX — leave as-is, just strip non-digits.
  return msisdn.replace(/\D/g, "");
}

function donorDisplayName(p: C2BCallbackPayload): string {
  return [p.FirstName, p.MiddleName, p.LastName]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join(" ")
    .trim();
}

/**
 * Worker entry point. BullMQ `mpesa:c2b:process` job data: `{ callbackId }`.
 */
export async function processConfirmation(callbackId: string): Promise<void> {
  const callback = await prisma.mpesaCallback.findUnique({ where: { id: callbackId } });
  if (!callback) {
    logger.warn({ callbackId }, "mpesa-c2b: callback row not found, skipping");
    return;
  }

  if (callback.processedAt) {
    logger.info({ callbackId }, "mpesa-c2b: already processed, skipping");
    return;
  }

  const payload = callback.rawPayload as unknown as C2BCallbackPayload;
  const billRef = (payload.BillRefNumber ?? "").trim();
  const msisdn = normalisePhone(payload.MSISDN);
  const amountKes = Number(payload.TransAmount ?? 0);
  const mpesaReceipt = (payload.TransID ?? "").trim() || callback.mpesaReceipt || callback.id;

  try {
    if (!billRef) {
      throw new Error("c2b confirmation missing BillRefNumber");
    }
    if (!msisdn) {
      throw new Error("c2b confirmation missing MSISDN");
    }
    if (!Number.isFinite(amountKes) || amountKes <= 0) {
      throw new Error(`c2b confirmation has invalid TransAmount: ${payload.TransAmount}`);
    }

    const chama = await resolveChamaForRef(billRef);
    if (!chama) {
      // We accepted the money because validation passed at the time, but the
      // chama has since been deleted / renumbered. Park in suspense and let an
      // operator reconcile manually.
      throw new Error(`c2b confirmation: unknown BillRefNumber=${billRef}`);
    }

    // Member contribution vs public-mode donation:
    //  - Look for an active Membership whose user has an MpesaAccount matching MSISDN.
    //  - If found → chama contribution.
    //  - Else if the chama allows public donations (type=fundraiser OR privacy=public) → donation.
    //  - Else → throw (rule engine should have stopped this; treat as exception).
    const membership = await prisma.membership.findFirst({
      where: {
        chamaId: chama.id,
        status: "active",
        user: {
          mpesaAccounts: {
            some: { phoneNumber: msisdn },
          },
        },
      },
      select: { id: true, userId: true },
    });

    const isPublicMode = chama.type === "fundraiser" || chama.privacy === "public";

    if (!membership && !isPublicMode) {
      throw new Error(
        `c2b confirmation: MSISDN=${msisdn} is not a member of chama=${chama.id} and chama is not public — refusing to credit`,
      );
    }

    // Always record the contribution in the ledger. The ledger is the source
    // of truth; the Donation row below is just a presentational mirror for
    // harambee donor walls.
    const idempotencyKey = `mpesa-c2b:${mpesaReceipt}`;
    const isHarambee = !membership && isPublicMode;
    const amountDecimal = new Decimal(amountKes);

    if (isHarambee) {
      const feeKes = amountDecimal.mul(HARAMBEE_PLATFORM_FEE_RATE);
      await ledger.recordHarambeeDonation({
        chamaId: chama.id,
        donorMsisdn: msisdn,
        amountKes: amountDecimal,
        platformFeeKes: feeKes,
        mpesaReceipt,
        idempotencyKey,
      });
    } else {
      await ledger.recordContribution({
        chamaId: chama.id,
        fromMsisdn: msisdn,
        memberUserId: membership?.userId,
        amountKes: amountDecimal,
        mpesaReceipt,
        idempotencyKey,
      });
    }

    if (isHarambee) {
      // Public-mode harambee donation — mirror into Donation table so the
      // public campaign page can render the donor wall.
      await prisma.donation.create({
        data: {
          chamaId: chama.id,
          userId: null,
          donorName: donorDisplayName(payload) || null,
          donorPhone: msisdn,
          amount: amountKes,
          isAnonymous: !donorDisplayName(payload),
          paymentMethod: "mpesa",
          reference: mpesaReceipt,
        },
      });
    }

    await prisma.mpesaCallback.update({
      where: { id: callback.id },
      data: { processedAt: new Date(), errorMessage: null },
    });

    logger.info(
      { callbackId, chamaId: chama.id, mpesaReceipt, amountKes, mode: membership ? "contribution" : "donation" },
      "mpesa-c2b: confirmation processed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ callbackId, err: message }, "mpesa-c2b: confirmation processing failed");
    // Persist the failure so the operator can see why it bounced, then
    // re-throw so BullMQ retries with the queue's backoff policy.
    await prisma.mpesaCallback
      .update({
        where: { id: callback.id },
        data: { errorMessage: message.slice(0, 1000) },
      })
      .catch(() => {
        /* swallow — don't mask the original error */
      });
    throw err;
  }
}
