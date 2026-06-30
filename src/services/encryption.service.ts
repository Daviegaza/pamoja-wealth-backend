import { encrypt, decrypt } from "../utils/crypto.js";

export function encryptPii(value: string): string {
  return encrypt(value);
}

export function decryptPii(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-3);
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (name.length <= 2) return `***@${domain}`;
  return name[0] + "***" + name[name.length - 1] + "@" + domain;
}
