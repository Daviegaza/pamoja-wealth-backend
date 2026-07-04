import { logger } from "../config/logger.js";
import { allQueues } from "./queue.js";

/**
 * Register all repeatable cron jobs.
 *
 * Each job uses a stable `repeatJobKey` so BullMQ can idempotently upsert
 * repeatable jobs across process restarts and multi-instance deployments.
 * No `obliterate()` — that wipes every repeatable job on startup and causes
 * race conditions when multiple instances restart simultaneously.
 *
 * To remove a stale schedule, use Bull Board or:
 *   await queue.removeRepeatableByKey(repeatJobKey);
 */
export async function startScheduler() {
  logger.info("Registering BullMQ repeatable jobs...");

  // ── Map of { queue, jobName, pattern, repeatJobKey } ─────────────────
  // repeatJobKey must be stable across deploys so BullMQ deduplicates.
  // The key format is `pamoja:{queueName}:{jobName}`.

  const schedules: Array<{
    queueIdx: number;
    name: string;
    pattern: string;
    repeatJobKey: string;
  }> = [
    // Compute chama analytics daily at 2am
    { queueIdx: 0,  name: "compute-analytics",          pattern: "0 2 * * *",    repeatJobKey: "pamoja:analytics:compute-analytics" },
    // Contribution reminders daily at 8am
    { queueIdx: 1,  name: "send-contribution-reminders", pattern: "0 8 * * *",    repeatJobKey: "pamoja:reminders:contribution" },
    // Meeting reminders every 30 minutes
    { queueIdx: 2,  name: "send-meeting-reminders",      pattern: "*/30 * * * *", repeatJobKey: "pamoja:reminders:meeting" },
    // Close expired votes every 5 minutes
    { queueIdx: 3,  name: "close-expired-votes",         pattern: "*/5 * * * *",  repeatJobKey: "pamoja:votes:close-expired" },
    // Check overdue loans daily at 6am
    { queueIdx: 4,  name: "check-overdue-loans",         pattern: "0 6 * * *",    repeatJobKey: "pamoja:loans:overdue" },
    // Reconcile M-Pesa hourly
    { queueIdx: 5,  name: "reconcile-mpesa",             pattern: "0 * * * *",    repeatJobKey: "pamoja:mpesa:reconcile" },
    // Compute health scores daily at 3am
    { queueIdx: 6,  name: "compute-health-scores",       pattern: "0 3 * * *",    repeatJobKey: "pamoja:health:scores" },
    // Monthly statements 1st of month at 7am
    { queueIdx: 7,  name: "generate-monthly-statements", pattern: "0 7 1 * *",    repeatJobKey: "pamoja:statements:monthly" },
    // Cleanup expired invites daily at 4am
    { queueIdx: 8,  name: "cleanup-expired-invites",     pattern: "0 4 * * *",    repeatJobKey: "pamoja:invites:cleanup" },
    // Prune old notifications weekly Sunday at 5am
    { queueIdx: 9,  name: "prune-old-notifications",     pattern: "0 5 * * 0",    repeatJobKey: "pamoja:notifications:prune" },
    // Ledger global invariant check — sum(debit) === sum(credit). RESEARCH_DOSSIER.md §7.1.
    { queueIdx: 10, name: "ledger-invariant",            pattern: "0 2 * * *",    repeatJobKey: "pamoja:ledger:invariant" },
    // STK Push status poll — every 60s. Catches "phantom contribution" when Safaricom callbacks get lost.
    { queueIdx: 11, name: "stk-status-poll",             pattern: "* * * * *",    repeatJobKey: "pamoja:mpesa:stk-poll" },
    // ── Subscription billing (all on billingQueue, index 12) ──────────
    { queueIdx: 12, name: "generate-due-invoices",       pattern: "0 * * * *",    repeatJobKey: "pamoja:billing:generate-invoices" },
    { queueIdx: 12, name: "collect-overdue",             pattern: "0 3 * * *",    repeatJobKey: "pamoja:billing:collect-overdue" },
    { queueIdx: 12, name: "expire-trials",               pattern: "*/15 * * * *", repeatJobKey: "pamoja:billing:expire-trials" },
    // Float sweep — daily 03:30.
    { queueIdx: 13, name: "float-sweep",                 pattern: "30 3 * * *",   repeatJobKey: "pamoja:float:sweep" },
    // Referral reward retry — every 6 hours.
    { queueIdx: 15, name: "referral-retry",              pattern: "0 */6 * * *",  repeatJobKey: "pamoja:referral:retry" },
    // Anomaly sweep — every 15 minutes. Freezes chamas on abuse signals.
    { queueIdx: 16, name: "anomaly-sweep",               pattern: "*/15 * * * *", repeatJobKey: "pamoja:anomaly:sweep" },
    // Nudges — twice daily (morning + evening streak-loss + social-proof).
    { queueIdx: 17, name: "streak-loss",                 pattern: "0 9 * * *",    repeatJobKey: "pamoja:nudges:streak-loss" },
    { queueIdx: 17, name: "social-proof",                pattern: "0 18 * * *",   repeatJobKey: "pamoja:nudges:social-proof" },
  ];

  for (const { queueIdx, name, pattern, repeatJobKey } of schedules) {
    const queue = allQueues[queueIdx];
    if (!queue) {
      logger.error({ queueIdx, name }, "scheduler: queue index out of bounds — skipped");
      continue;
    }
    await queue.add(name, {}, {
      repeat: { pattern, key: repeatJobKey },
      jobId: `repeat:${repeatJobKey}`,
    });
  }

  logger.info({ count: schedules.length }, "All repeatable jobs registered (idempotent)");
}
