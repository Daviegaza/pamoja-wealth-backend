import { logger } from "../config/logger.js";
import { allQueues } from "./queue.js";

export async function startScheduler() {
  logger.info("Starting BullMQ schedulers...");

  // Clean existing repeatable jobs to avoid duplicates
  for (const queue of allQueues) {
    await queue.obliterate({ force: true });
  }

  // Compute chama analytics daily at 2am
  await allQueues[0].add("compute-analytics", {}, {
    repeat: { pattern: "0 2 * * *" },
  });

  // Contribution reminders daily at 8am
  await allQueues[1].add("send-contribution-reminders", {}, {
    repeat: { pattern: "0 8 * * *" },
  });

  // Meeting reminders every 30 minutes
  await allQueues[2].add("send-meeting-reminders", {}, {
    repeat: { pattern: "*/30 * * * *" },
  });

  // Close expired votes every 5 minutes
  await allQueues[3].add("close-expired-votes", {}, {
    repeat: { pattern: "*/5 * * * *" },
  });

  // Check overdue loans daily at 6am
  await allQueues[4].add("check-overdue-loans", {}, {
    repeat: { pattern: "0 6 * * *" },
  });

  // Reconcile M-Pesa hourly
  await allQueues[5].add("reconcile-mpesa", {}, {
    repeat: { pattern: "0 * * * *" },
  });

  // Compute health scores daily at 3am
  await allQueues[6].add("compute-health-scores", {}, {
    repeat: { pattern: "0 3 * * *" },
  });

  // Monthly statements 1st of month at 7am
  await allQueues[7].add("generate-monthly-statements", {}, {
    repeat: { pattern: "0 7 1 * *" },
  });

  // Cleanup expired invites daily at 4am
  await allQueues[8].add("cleanup-expired-invites", {}, {
    repeat: { pattern: "0 4 * * *" },
  });

  // Prune old notifications weekly Sunday at 5am
  await allQueues[9].add("prune-old-notifications", {}, {
    repeat: { pattern: "0 5 * * 0" },
  });

  // Ledger global invariant check daily at 02:00 — verifies sum(debit) ===
  // sum(credit) across every ledger_entries row. Logs pino-error if
  // !balanced. Per RESEARCH_DOSSIER.md §7.1.
  await allQueues[10].add("ledger-invariant", {}, {
    repeat: { pattern: "0 2 * * *" },
  });

  // STK Push status poll — every 60s, finds pending Transactions older than
  // 90s with a CheckoutRequestID and queries Daraja for status. Catches the
  // "phantom contribution" failure mode (STK Push completes silently when
  // Safaricom callbacks get lost). RESEARCH_DOSSIER §4 — "ResultCode 0 !=
  // money moved" — applies in reverse too.
  await allQueues[11].add("stk-status-poll", {}, {
    repeat: { pattern: "* * * * *" }, // every minute (BullMQ minimum)
  });

  // ── Subscription billing crons ─────────────────────────────────────
  // All three jobs run on `billingQueue` (index 12). Dispatcher in
  // workers/index.ts switches on job.name.
  //
  //   generate-due-invoices  — hourly
  //   collect-overdue        — daily 03:00
  //   expire-trials          — every 15 minutes

  await allQueues[12].add("generate-due-invoices", {}, {
    repeat: { pattern: "0 * * * *" }, // hourly
  });

  await allQueues[12].add("collect-overdue", {}, {
    repeat: { pattern: "0 3 * * *" }, // 03:00 daily
  });

  await allQueues[12].add("expire-trials", {}, {
    repeat: { pattern: "*/15 * * * *" }, // every 15 min
  });

  // Float sweep — daily 03:30. Snapshots every fee-account balance.
  await allQueues[13].add("float-sweep", {}, {
    repeat: { pattern: "30 3 * * *" },
  });

  // Referral reward retry — every 6 hours. Picks pending rewards > 24h old.
  await allQueues[15].add("referral-retry", {}, {
    repeat: { pattern: "0 */6 * * *" },
  });

  // Audit-report queue is one-shot (buyer purchases). No cron.

  // Anomaly sweep — every 15 minutes. Freezes chamas on abuse signals.
  await allQueues[16].add("anomaly-sweep", {}, {
    repeat: { pattern: "*/15 * * * *" },
  });

  // Nudges — twice daily (morning + evening). Skips users already nudged today.
  await allQueues[17].add("streak-loss", {}, {
    repeat: { pattern: "0 9 * * *" }, // 09:00 daily
  });
  await allQueues[17].add("social-proof", {}, {
    repeat: { pattern: "0 18 * * *" }, // 18:00 daily
  });

  logger.info("All job schedulers registered");
}
