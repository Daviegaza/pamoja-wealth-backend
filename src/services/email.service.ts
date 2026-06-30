import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

export async function sendOtp(email: string, code: string): Promise<void> {
  if (!config.sendgrid.apiKey) {
    logger.info({ email, code }, "DEV: OTP email (not sent — no API key)");
    return;
  }
  // TODO: SendGrid integration
  logger.info({ email }, "OTP email sent");
}

export async function sendPasswordReset(email: string, token: string): Promise<void> {
  if (!config.sendgrid.apiKey) {
    logger.info({ email, token }, "DEV: Password reset email (not sent)");
    return;
  }
  logger.info({ email }, "Password reset email sent");
}

export async function sendWelcome(email: string, name: string): Promise<void> {
  if (!config.sendgrid.apiKey) {
    logger.info({ email, name }, "DEV: Welcome email (not sent)");
    return;
  }
  logger.info({ email }, "Welcome email sent");
}

export async function sendInvitation(
  email: string,
  chamaName: string,
  inviteCode: string
): Promise<void> {
  if (!config.sendgrid.apiKey) {
    logger.info({ email, chamaName, inviteCode }, "DEV: Invitation email (not sent)");
    return;
  }
  logger.info({ email, chamaName }, "Invitation email sent");
}
