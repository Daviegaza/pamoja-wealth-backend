/**
 * Dividend payout worker.
 *
 * Consumes `dividend-payout` jobs. Given a PayoutRequest id, resolves the
 * recipient's default M-Pesa phone, calls `b2cPayment`, and updates the
 * PayoutRequest with the returned ConversationID + status transition
 * (pending → disbursing). Terminal state (disbursed / failed) is set by
 * the B2C result-URL callback in the mpesa webhook route, not here.
 *
 * Failure modes:
 *   - No default MpesaAccount → status="failed", audit log
 *   - Daraja timeout / 4xx → status="failed", worker throws so BullMQ retries
 *   - Idempotent: if status !== "pending" on entry, skip (already handled)
 */
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { b2cPayment } from "../../services/mpesa.service.js";
import { emitToUser } from "../../websocket/index.js";

export interface DividendPayoutJob {
  payoutRequestId: string;
}

export async function processDividendPayout(data: DividendPayoutJob): Promise<void> {
  const payout = await prisma.payoutRequest.findUnique({
    where: { id: data.payoutRequestId },
    select: {
      id: true,
      chamaId: true,
      recipientUserId: true,
      amount: true,
      purpose: true,
      status: true,
      chama: { select: { name: true } },
    },
  });
  if (!payout) throw new Error(`payout not found: ${data.payoutRequestId}`);
  if (payout.status !== "pending" && payout.status !== "approved") {
    logger.info({ id: payout.id, status: payout.status }, "dividend-payout: skipping non-pending payout");
    return;
  }

  const mpesa = await prisma.mpesaAccount.findFirst({
    where: { userId: payout.recipientUserId, isDefault: true },
    select: { phoneNumber: true },
  });
  const phone = mpesa?.phoneNumber
    ?? (await prisma.user.findUnique({ where: { id: payout.recipientUserId }, select: { phone: true } }))?.phone;

  if (!phone) {
    await prisma.payoutRequest.update({
      where: { id: payout.id },
      data: { status: "failed" },
    });
    emitToUser(payout.recipientUserId, "dividend:failed", {
      payoutId: payout.id,
      reason: "no M-Pesa phone on file",
    });
    logger.warn({ id: payout.id }, "dividend-payout: no phone on file");
    return;
  }

  const amount = Number(payout.amount.toString());
  const remarks = `Dividend from ${payout.chama.name}`.slice(0, 100);
  const { conversationId } = await b2cPayment(phone, amount, remarks);

  await prisma.payoutRequest.update({
    where: { id: payout.id },
    data: {
      status: "disbursing",
      mpesaConversationId: conversationId,
    },
  });

  emitToUser(payout.recipientUserId, "dividend:disbursing", {
    payoutId: payout.id,
    amountKes: amount,
    conversationId,
  });
  logger.info({ id: payout.id, conversationId }, "dividend-payout: b2c initiated");
}
