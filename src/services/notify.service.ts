/**
 * Unified notification dispatcher.
 *
 * Fan-out to: in-app (Notification table + WebSocket), SMS (Africa's Talking),
 * email (SendGrid), push (FCM v1). Respects user prefs via `settings.channels`
 * (JSON on User row or in-memory default of all-on).
 *
 * Call sites: contribution-received, meeting-reminder, loan-approved,
 * vote-open, KYC-required, subscription-expiring, referral-reward, etc.
 */
import { prisma } from "../config/database.js";
import { emitNotification } from "../websocket/index.js";
import { sendOtpSms } from "./sms.service.js";
import { logger } from "../config/logger.js";
import { sendPush } from "./push.service.js";
import { dispatchWebhook } from "./integrations.service.js";

export interface NotifyArgs {
  userId: string;
  chamaId?: string;
  type: "info" | "success" | "warning" | "error" | "loan" | "meeting" | "vote" | "wallet";
  title: string;
  message: string;
  actionUrl?: string;
  channels?: {
    inApp?: boolean;
    sms?: boolean;
    email?: boolean;
    push?: boolean;
    webhook?: boolean;
  };
  sms?: { phone: string; body?: string };
  email?: { to: string; subject?: string; html?: string };
}

const DEFAULT_CHANNELS = { inApp: true, sms: false, email: false, push: true, webhook: false };

async function loadUserPrefs(userId: string): Promise<Record<string, boolean> | null> {
  try {
    // Settings service may or may not exist per-user; fall back to default.
    const anyPrisma = prisma as unknown as { userSettings?: { findUnique: Function } };
    if (!anyPrisma.userSettings) return null;
    const row = await anyPrisma.userSettings.findUnique({ where: { userId } });
    return (row?.notificationChannels as Record<string, boolean>) ?? null;
  } catch {
    return null;
  }
}

export async function notify(args: NotifyArgs): Promise<void> {
  const prefs = (await loadUserPrefs(args.userId)) ?? {};
  const channels = { ...DEFAULT_CHANNELS, ...prefs, ...(args.channels ?? {}) };

  // 1. In-app + WebSocket
  if (channels.inApp) {
    try {
      const notif = await prisma.notification.create({
        data: {
          userId: args.userId,
          type: args.type,
          title: args.title,
          message: args.message,
          actionUrl: args.actionUrl,
          isRead: false,
        },
      });
      emitNotification(notif);
    } catch (err) {
      logger.warn({ err, userId: args.userId }, "in-app notify persist failed");
    }
  }

  // 2. SMS
  if (channels.sms && args.sms?.phone) {
    try {
      await sendOtpSms(args.sms.phone, args.sms.body ?? args.message);
    } catch (err) {
      logger.warn({ err, userId: args.userId }, "SMS notify failed");
    }
  }

  // 3. Email — reuses sendOtp path with subject/html override.
  if (channels.email && args.email?.to) {
    try {
      const mod = await import("./email.service.js");
      const send = (mod as { sendGenericEmail?: Function }).sendGenericEmail;
      if (typeof send === "function") {
        await send(args.email.to, args.email.subject ?? args.title, args.email.html ?? `<p>${args.message}</p>`);
      }
    } catch (err) {
      logger.warn({ err, userId: args.userId }, "email notify failed");
    }
  }

  // 4. Push
  if (channels.push) {
    await sendPush(args.userId, {
      title: args.title,
      body: args.message,
      clickAction: args.actionUrl,
      data: { type: args.type, chamaId: args.chamaId ?? "" },
    });
  }

  // 5. Webhook (chama-level custom webhook if configured)
  if (channels.webhook && args.chamaId) {
    await dispatchWebhook(args.chamaId, `notification.${args.type}`, {
      userId: args.userId,
      title: args.title,
      message: args.message,
      actionUrl: args.actionUrl,
    });
  }
}
