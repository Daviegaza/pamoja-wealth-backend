import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

/**
 * Send an email via SendGrid API.
 * Falls back to logging in development if no API key is configured.
 */
async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  if (!config.sendgrid.apiKey) {
    logger.warn({ to, subject }, "Email not sent — SendGrid API key not configured");
    if (config.nodeEnv === "production") {
      throw new Error("Email service not configured. Set SENDGRID_API_KEY.");
    }
    return;
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.sendgrid.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: config.sendgrid.from, name: "Pamoja Wealth" },
        subject,
        content: [{ type: "text/html", value: htmlBody }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SendGrid API error ${response.status}: ${body}`);
    }

    logger.info({ to, subject }, "Email sent successfully");
  } catch (error) {
    logger.error({ error, to, subject }, "Failed to send email");
    if (config.nodeEnv === "production") {
      throw error;
    }
  }
}

export async function sendOtp(email: string, code: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #059669;">Pamoja Wealth</h1>
      <p>Your verification code is:</p>
      <h2 style="font-size: 32px; letter-spacing: 8px; color: #1a1a2e; background: #f0fdf4; padding: 16px; text-align: center; border-radius: 8px;">${code}</h2>
      <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Pamoja Wealth — From Chama to Wealth</p>
    </div>
  `;
  await sendEmail(email, `Your Pamoja Wealth verification code: ${code}`, html);
}

export async function sendPasswordReset(email: string, resetLink: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #059669;">Pamoja Wealth</h1>
      <p>You requested a password reset. Click below to reset your password:</p>
      <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #059669; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">Reset Password</a>
      <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Pamoja Wealth — From Chama to Wealth</p>
    </div>
  `;
  await sendEmail(email, "Reset your Pamoja Wealth password", html);
}

export async function sendWelcome(email: string, name: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #059669;">Welcome to Pamoja Wealth, ${name}!</h1>
      <p>You're now part of East Africa's smartest chama and fundraising platform.</p>
      <p>Here's what you can do:</p>
      <ul>
        <li>Create or join a chama</li>
        <li>Start a fundraiser (harambee)</li>
        <li>Track contributions and loans</li>
        <li>Earn KES 500 per referral</li>
      </ul>
      <a href="https://pamojawealth.app/dashboard" style="display: inline-block; padding: 12px 24px; background: #059669; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">Go to Dashboard</a>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Pamoja Wealth — From Chama to Wealth</p>
    </div>
  `;
  await sendEmail(email, "Welcome to Pamoja Wealth!", html);
}

export async function sendInvitation(
  email: string,
  chamaName: string,
  inviteLink: string,
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #059669;">You're Invited!</h1>
      <p>You've been invited to join <strong>${chamaName}</strong> on Pamoja Wealth.</p>
      <a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background: #059669; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">Join ${chamaName}</a>
      <p style="color: #666; font-size: 14px;">Pamoja Wealth helps chamas manage contributions, loans, investments, and fundraisers — all in one place.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Pamoja Wealth — From Chama to Wealth</p>
    </div>
  `;
  await sendEmail(email, `You're invited to join ${chamaName} on Pamoja Wealth`, html);
}

export async function sendAuditReportReady(
  email: string,
  chamaName: string,
  downloadUrl: string,
  range: { start: string; end: string },
  expiresInMinutes: number,
): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #059669;">Your audit report is ready</h1>
      <p><strong>${chamaName}</strong></p>
      <p style="color: #666; font-size: 14px;">Reporting period: ${range.start} → ${range.end}</p>
      <a href="${downloadUrl}" style="display: inline-block; padding: 12px 24px; background: #059669; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">Download PDF</a>
      <p style="color: #666; font-size: 14px;">This secure link expires in ${expiresInMinutes} minutes. Save the PDF once opened.</p>
      <p style="color: #666; font-size: 13px;">The report includes: financial summary, ledger hash verification, active-member list, and an external-auditor signature line — suitable for SACCO regulators and accountants.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">Pamoja Wealth — From Chama to Wealth</p>
    </div>
  `;
  await sendEmail(email, `Audit report ready — ${chamaName}`, html);
}
