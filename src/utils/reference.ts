import crypto from "crypto";

// Crockford base32 alphabet — no ambiguous chars (0/O, 1/I/L).
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 0x1f];
  return out;
}

// 128 bits of entropy — collision-resistant.
export function generateReference(prefix = "PW"): string {
  return `${prefix}${base32(crypto.randomBytes(16))}`;
}

export function generateOtpCode(): string {
  // 6-digit numeric — this is a delivered-to-user code, not a security token
  // by itself (rate-limited + short TTL upstream). Keep 6 digits for UX.
  return crypto.randomInt(100000, 999999).toString();
}

// 128 bits, base32 — collision-resistant + readable.
export function generateInviteCode(): string {
  return base32(crypto.randomBytes(16)).slice(0, 12);
}
