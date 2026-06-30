import { Worker } from "bullmq";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/database.js";
import { processConfirmation } from "../../services/mpesa-c2b.service.js";
import * as ledger from "../../services/ledger.service.js";
import { queryStkStatus } from "../../services/mpesa.service.js";
import { processStkCallback } from "../../services/stk-callback.service.js";
import { fire as fireDaraja } from "../../lib/daraja-breaker.js";
import { emitToUser } from "../../websocket/index.js";
import * as billing from "../../services/billing.service.js";

const connection = { connection: redis };

function createWorker(queueName: string, processor: (job: any) => Promise<void>) {
  const worker = new Worker(
    queueName,
    async (job) => {
      logger.info({ queue: queueName, jobId: job.id }, "Processing job");
      try {
        await processor(job);
        logger.info({ queue: queueName, jobId: job.id }, "Job completed");
      } catch (err) {
        logger.error({ queue: queueName, jobId: job.id, err }, "Job failed");
        throw err;
      }
    },
    connection
  );

  worker.on("failed", (job, err) => {
    logger.error({ queue: queueName, jobId: job?.id, err }, "Worker job failed");
  });

  return worker;
}

// Close expired votes
createWorker("close-expired-votes", async () => {
  const expired = await prisma.vote.updateMany({
    where: {
      status: "open",
      closesAt: { lt: new Date() },
    },
    data: { status: "rejected" },
  });
  if (expired.count > 0) {
    logger.info({ count: expired.count }, "Closed expired votes");
  }
});

// Cleanup expired invite codes
createWorker("cleanup-expired-invites", async () => {
  const result = await prisma.inviteCode.updateMany({
    where: {
      isActive: true,
      expiresAt: { lt: new Date() },
    },
    data: { isActive: false },
  });
  if (result.count > 0) {
    logger.info({ count: result.count }, "Deactivated expired invites");
  }
});

// Prune old notifications
createWorker("prune-old-notifications", async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const result = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    logger.info({ count: result.count }, "Pruned old notifications");
  }
});

// Check overdue loans
createWorker("check-overdue-loans", async () => {
  const overdue = await prisma.loanRepayment.updateMany({
    where: {
      status: "pending",
      dueDate: { lt: new Date() },
    },
    data: { status: "overdue" },
  });
  if (overdue.count > 0) {
    logger.info({ count: overdue.count }, "Marked overdue loan repayments");
  }
});

// Stub workers for remaining jobs (implement full logic as needed)
createWorker("compute-analytics", async () => {
  logger.info("Analytics computation would run here");
});

createWorker("send-contribution-reminders", async () => {
  logger.info("Contribution reminders would be sent here");
});

createWorker("send-meeting-reminders", async () => {
  logger.info("Meeting reminders would be sent here");
});

// M-Pesa reconciliation queue — dispatches by job.name:
//   - "mpesa:c2b:process": process a persisted C2B confirmation row
//   - any other name: reconciliation sweep placeholder
createWorker("reconcile-mpesa", async (job) => {
  if (job.name === "mpesa:c2b:process") {
    const callbackId = job.data?.callbackId as string | undefined;
    if (!callbackId) {
      throw new Error("mpesa:c2b:process job missing data.callbackId");
    }
    await processConfirmation(callbackId);
    return;
  }
  logger.info({ name: job.name }, "M-Pesa reconciliation sweep (placeholder)");
});

// Ledger global invariant check — sum(debit) === sum(credit) across all
// ledger_entries. Logs an error if the books are out of balance.
createWorker("ledger-invariant", async () => {
  const result = await ledger.verifyGlobalBalance();
  if (!result.balanced) {
    logger.error(
      {
        debitTotal: result.debitTotal.toString(),
        creditTotal: result.creditTotal.toString(),
        difference: result.difference.toString(),
      },
      "ledger.verifyGlobalBalance: BOOKS OUT OF BALANCE",
    );
  } else {
    logger.info(
      {
        debitTotal: result.debitTotal.toString(),
        creditTotal: result.creditTotal.toString(),
      },
      "ledger.verifyGlobalBalance: balanced",
    );
  }
});

createWorker("compute-health-scores", async () => {
  logger.info("Health score computation would run here");
});

createWorker("generate-monthly-statements", async () => {
  logger.info("Monthly statement generation would run here");
});

// STK Push status poll — every 60s. Picks Transactions stuck in `pending`
// where the STK callback never arrived, queries Daraja, then either replays
// the callback path or marks the transaction failed if too much time elapsed.
//
// Thresholds:
//   - 90s old: start polling (Daraja STK Push UX is ~30-60s typical)
//   - 7m old:  give up, mark failed, emit payment:timeout
const STK_POLL_AGE_MS = 90 * 1000;
const STK_TIMEOUT_MS = 7 * 60 * 1000;

createWorker("stk-status-poll", async () => {
  const now = Date.now();
  const cutoff = new Date(now - STK_POLL_AGE_MS);
  const timeoutCutoff = new Date(now - STK_TIMEOUT_MS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = (await (prisma as any).transaction.findMany({
    where: {
      status: "pending",
      createdAt: { lt: cutoff },
      NOT: { mpesaCheckoutRequestId: null },
    },
    select: {
      id: true,
      userId: true,
      mpesaCheckoutRequestId: true,
      createdAt: true,
    },
    take: 50,
  })) as Array<{
    id: string;
    userId: string;
    mpesaCheckoutRequestId: string | null;
    createdAt: Date;
  }>;

  for (const tx of candidates) {
    // Timeout branch: too old, give up.
    if (tx.createdAt < timeoutCutoff) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "failed",
          description: "STK Push timed out (no callback received within 7 minutes)",
        },
      });
      emitToUser(tx.userId, "payment:timeout", {
        transactionId: tx.id,
        checkoutRequestId: tx.mpesaCheckoutRequestId,
      });
      logger.warn({ transactionId: tx.id }, "stk-status-poll: timed out, marked failed");
      continue;
    }

    // Poll Daraja for status.
    try {
      const status = await fireDaraja(queryStkStatus, tx.mpesaCheckoutRequestId!);
      // ResultCode 1037 = transaction in progress; 1032 = cancelled by user;
      // 1 = insufficient funds; 0 = success.
      if (status.resultCode === 0 || (status.resultCode > 0 && status.resultCode !== 1037)) {
        // Reconstruct a synthetic callback payload and run it through the
        // same handler. NOTE: the STK status query doesn't include
        // CallbackMetadata, so on success we can only mark "matched" — the
        // real callback (when it eventually arrives) will fill in the receipt.
        const synthetic = {
          Body: {
            stkCallback: {
              CheckoutRequestID: tx.mpesaCheckoutRequestId,
              ResultCode: status.resultCode,
              ResultDesc: status.resultDesc,
            },
          },
        };
        await processStkCallback(synthetic);
      }
    } catch (err) {
      logger.warn({ err, transactionId: tx.id }, "stk-status-poll: query failed");
    }
  }

  if (candidates.length > 0) {
    logger.info({ count: candidates.length }, "stk-status-poll: processed candidates");
  }
});

// Subscription billing — dispatches by job.name onto a single "billing" queue.
//   - "generate-due-invoices": hourly — rollover sub periods + STK push
//   - "collect-overdue":       daily 03:00 — dunning retries + downgrade
//   - "expire-trials":         every 15min — convert trial→paid + STK push
createWorker("billing", async (job) => {
  switch (job.name) {
    case "generate-due-invoices": {
      const out = await billing.generateDueInvoices();
      logger.info({ ...out }, "billing.generateDueInvoices");
      return;
    }
    case "collect-overdue": {
      const out = await billing.collectOverdue();
      logger.info({ ...out }, "billing.collectOverdue");
      return;
    }
    case "expire-trials": {
      const out = await billing.expireTrials();
      logger.info({ ...out }, "billing.expireTrials");
      return;
    }
    default:
      logger.warn({ name: job.name }, "billing worker: unknown job name");
  }
});

logger.info("All workers initialized");
