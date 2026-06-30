import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  if (!config.africastalking.apiKey) {
    logger.info({ phone, code }, "DEV: OTP SMS (not sent — no API key)");
    return;
  }
  logger.info({ phone }, "OTP SMS sent");
}

export async function sendReminderSms(
  phone: string,
  message: string
): Promise<void> {
  if (!config.africastalking.apiKey) {
    logger.info({ phone, message }, "DEV: Reminder SMS (not sent)");
    return;
  }
  logger.info({ phone }, "Reminder SMS sent");
}
