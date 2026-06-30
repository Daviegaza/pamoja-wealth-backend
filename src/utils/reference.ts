import crypto from "crypto";

export function generateReference(prefix = "PW"): string {
  const digits = crypto.randomInt(100000, 999999).toString();
  return `${prefix}${digits}`;
}

export function generateOtpCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
