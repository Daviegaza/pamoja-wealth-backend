import { Queue, Worker } from "bullmq";
import { redis } from "../config/redis.js";

// Redis connection for BullMQ
const connection = {
  connection: redis,
};

// Define queues
export const analyticsQueue = new Queue("compute-analytics", connection);
export const contributionRemindersQueue = new Queue("send-contribution-reminders", connection);
export const meetingRemindersQueue = new Queue("send-meeting-reminders", connection);
export const closeVotesQueue = new Queue("close-expired-votes", connection);
export const overdueLoansQueue = new Queue("check-overdue-loans", connection);
export const mpesaReconciliationQueue = new Queue("reconcile-mpesa", connection);
export const healthScoresQueue = new Queue("compute-health-scores", connection);
export const monthlyStatementsQueue = new Queue("generate-monthly-statements", connection);
export const cleanupInvitesQueue = new Queue("cleanup-expired-invites", connection);
export const pruneNotificationsQueue = new Queue("prune-old-notifications", connection);
export const ledgerInvariantQueue = new Queue("ledger-invariant", connection);
export const stkStatusPollQueue = new Queue("stk-status-poll", connection);
// Subscription billing — generate-due-invoices, collect-overdue, expire-trials
// all dispatched by job.name onto a single queue.
export const billingQueue = new Queue("billing", connection);
// Platform float snapshot — daily 03:30. Reads all fee-account balances,
// stores an audit-log entry that treasury reconciles against.
export const floatSweepQueue = new Queue("float-sweep", connection);
// Audit report SKU — buyer pays via STK, worker renders + uploads PDF.
export const auditReportQueue = new Queue("audit-report", connection);
// Referral reward retry — finds pending rewards > 24h old, replays.
export const referralRetryQueue = new Queue("referral-retry", connection);
// Dividend payouts — one PayoutRequest per holder, B2C via M-Pesa.
export const dividendPayoutQueue = new Queue("dividend-payout", connection);
// Anomaly sweep — auto-freeze chamas on velocity/mass-exit signals.
export const anomalySweepQueue = new Queue("anomaly-sweep", connection);
// Behavioural nudges — streak-loss + social-proof reminders.
export const nudgesQueue = new Queue("nudges", connection);

// All queues for easy management
export const allQueues = [
  analyticsQueue,
  contributionRemindersQueue,
  meetingRemindersQueue,
  closeVotesQueue,
  overdueLoansQueue,
  mpesaReconciliationQueue,
  healthScoresQueue,
  monthlyStatementsQueue,
  cleanupInvitesQueue,
  pruneNotificationsQueue,
  ledgerInvariantQueue,
  stkStatusPollQueue,
  billingQueue,
  floatSweepQueue,
  auditReportQueue,
  referralRetryQueue,
  dividendPayoutQueue,
  anomalySweepQueue,
  nudgesQueue,
];
