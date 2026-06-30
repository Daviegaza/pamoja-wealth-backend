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
];
