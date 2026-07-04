/**
 * Daraja B2C result / timeout handler.
 *
 * Safaricom POSTs to our ResultURL after a B2C attempt. Payload shape
 * (redacted):
 *   {
 *     Result: {
 *       ConversationID, OriginatorConversationID, ResultCode, ResultDesc,
 *       TransactionID,
 *       ResultParameters: { ResultParameter: [ { Key, Value }, ... ] }
 *     }
 *   }
 *
 * ResultCode === 0 → success → mark PayoutRequest.disbursed
 * Non-zero      → failure → mark PayoutRequest.failed
 *
 * Timeout URL fires the same handler with ResultCode=1 by convention here
 * (no TransactionID). We treat as failed.
 *
 * Idempotency: dedupe by ConversationID → PayoutRequest.mpesaConversationId
 * lookup. If PayoutRequest already terminal, no-op.
 */
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { emitToUser } from "../websocket/index.js";

interface B2CResultParameter {
  Key?: string;
  Value?: unknown;
}

interface B2CResultPayload {
  Result?: {
    ConversationID?: string;
    OriginatorConversationID?: string;
    ResultCode?: number;
    ResultDesc?: string;
    TransactionID?: string;
    ResultParameters?: { ResultParameter?: B2CResultParameter[] };
  };
}

function pickParam(params: B2CResultParameter[] | undefined, key: string): unknown {
  if (!params) return undefined;
  const row = params.find((p) => p.Key === key);
  return row?.Value;
}

export async function handleB2CResult(payload: B2CResultPayload): Promise<{ ok: boolean; action: string }> {
  const result = payload?.Result;
  if (!result) return { ok: false, action: "missing_result" };
  const conversationId = result.ConversationID;
  if (!conversationId) return { ok: false, action: "missing_conversation_id" };

  const payout = await prisma.payoutRequest.findFirst({
    where: { mpesaConversationId: conversationId },
    select: { id: true, recipientUserId: true, chamaId: true, status: true, amount: true },
  });
  if (!payout) {
    logger.warn({ conversationId }, "b2c-callback: no payout for conversationId");
    return { ok: false, action: "unknown_payout" };
  }
  if (payout.status === "disbursed" || payout.status === "failed" || payout.status === "cancelled") {
    return { ok: true, action: "already_terminal" };
  }

  const success = Number(result.ResultCode) === 0;
  const transactionId = result.TransactionID ?? String(pickParam(result.ResultParameters?.ResultParameter, "TransactionReceipt") ?? "");

  await prisma.payoutRequest.update({
    where: { id: payout.id },
    data: {
      status: success ? "disbursed" : "failed",
    },
  });

  emitToUser(payout.recipientUserId, success ? "dividend:disbursed" : "dividend:failed", {
    payoutId: payout.id,
    conversationId,
    transactionId: transactionId || undefined,
    amountKes: Number(payout.amount.toString()),
    resultDesc: result.ResultDesc ?? null,
  });

  logger.info({ payoutId: payout.id, success, transactionId }, "b2c-callback: payout finalised");
  return { ok: true, action: success ? "disbursed" : "failed" };
}

export async function handleB2CTimeout(payload: B2CResultPayload): Promise<{ ok: boolean; action: string }> {
  // Timeout treated as failed. Daraja re-sends the ResultURL later if the
  // charge did eventually settle — the settle callback then flips
  // status="failed" back to "disbursed" via handleB2CResult, which is
  // idempotent on the conversationId.
  return handleB2CResult({
    Result: {
      ...(payload.Result ?? {}),
      ResultCode: payload.Result?.ResultCode ?? 1,
      ResultDesc: payload.Result?.ResultDesc ?? "timeout",
    },
  });
}
