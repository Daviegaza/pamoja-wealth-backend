import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

/**
 * Send SMS via Africa's Talking API.
 * Falls back to logging in development if no API key is configured.
 */
async function sendSms(phoneNumber: string, message: string): Promise<void> {
  if (!config.africastalking.apiKey || !config.africastalking.username) {
    logger.warn({ phoneNumber }, "SMS not sent — Africa's Talking not configured");
    if (config.nodeEnv === "production") {
      throw new Error("SMS service not configured. Set AT_API_KEY and AT_USERNAME.");
    }
    return;
  }

  // Normalize phone number to international format
  const normalized = phoneNumber.startsWith("+")
    ? phoneNumber.slice(1)
    : phoneNumber.startsWith("254")
      ? phoneNumber
      : `254${phoneNumber.replace(/^0/, "")}`;

  try {
    const response = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        "ApiKey": config.africastalking.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        username: config.africastalking.username,
        to: `+${normalized}`,
        message,
        from: config.africastalking.senderId || "PamojaWealth",
      }).toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Africa's Talking API error ${response.status}: ${body}`);
    }

    const data = await response.json() as any;
    const recipients = data?.SMSMessageData?.Recipients || [];

    for (const recipient of recipients) {
      if (recipient.status !== "Success") {
        logger.warn({ recipient }, "SMS delivery failed for recipient");
      }
    }

    logger.info({ phoneNumber, messageLen: message.length }, "SMS sent successfully");
  } catch (error) {
    logger.error({ error, phoneNumber }, "Failed to send SMS");
    if (config.nodeEnv === "production") {
      throw error;
    }
  }
}

/** Send OTP via SMS — preserved function name for auth.service.ts compatibility */
export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const message = `Your Pamoja Wealth verification code is: ${code}. Valid for 10 minutes. Do not share this code.`;
  await sendSms(phone, message);
}

/** Send a generic reminder SMS — preserved function name */
export async function sendReminderSms(phone: string, message: string): Promise<void> {
  await sendSms(phone, message);
}

/** Send chama invitation via SMS */
export async function sendInvitationSms(
  phone: string,
  chamaName: string,
  inviteCode: string,
): Promise<void> {
  const message =
    `You've been invited to join "${chamaName}" on Pamoja Wealth! ` +
    `Use invite code: ${inviteCode} or visit https://pamojawealth.app/join`;
  await sendSms(phone, message);
}

/** Send contribution due reminder */
export async function sendContributionReminder(
  phone: string,
  chamaName: string,
  amount: number,
  dueDate: string,
): Promise<void> {
  const message =
    `Pamoja Wealth: Your KES ${amount.toLocaleString()} contribution to ` +
    `"${chamaName}" is due by ${dueDate}. Pay via M-Pesa in the app.`;
  await sendSms(phone, message);
}

/** Send loan repayment reminder */
export async function sendLoanRepaymentReminder(
  phone: string,
  amount: number,
  dueDate: string,
): Promise<void> {
  const message =
    `Pamoja Wealth: Your loan repayment of KES ${amount.toLocaleString()} is due on ${dueDate}. ` +
    `Pay on time to protect your credit standing.`;
  await sendSms(phone, message);
}

/** Notify user of referral reward */
export async function sendReferralRewardSms(phone: string, amount: number): Promise<void> {
  const message =
    `Congratulations! You've earned KES ${amount} in referral rewards on Pamoja Wealth. ` +
    `Check your wallet in the app.`;
  await sendSms(phone, message);
}
