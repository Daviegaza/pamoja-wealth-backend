/**
 * WebAuthn — passkey ceremony for payout signing.
 *
 * Uses `@simplewebauthn/server` when installed (optional peer dep). When
 * missing, endpoints return 503 so the FE can fall back to the placeholder
 * biometric-token flow gracefully.
 *
 * Install:
 *   npm i @simplewebauthn/server
 *
 * Env:
 *   WEBAUTHN_RP_ID=pamojawealth.app   # domain (no scheme)
 *   WEBAUTHN_RP_NAME="Pamoja Wealth"
 *   WEBAUTHN_ORIGIN=https://pamojawealth.app
 *
 * Challenge storage: Redis, 5-min TTL, keyed by userId.
 *
 * Public API:
 *   generateRegistrationOptions(userId)  → PublicKeyCredentialCreationOptions
 *   verifyRegistration(userId, response) → { verified, credentialId }
 *   generateAuthenticationOptions(userId?) → PublicKeyCredentialRequestOptions
 *   verifyAuthentication(userId, response) → { verified, credential }
 */
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

const CHALLENGE_TTL_SECONDS = 300;
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Pamoja Wealth";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173";

interface SimpleWebAuthn {
  generateRegistrationOptions: (opts: Record<string, unknown>) => Promise<unknown>;
  verifyRegistrationResponse: (opts: Record<string, unknown>) => Promise<{
    verified: boolean;
    registrationInfo?: {
      credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] };
      credentialBackedUp?: boolean;
      credentialDeviceType?: string;
    };
  }>;
  generateAuthenticationOptions: (opts: Record<string, unknown>) => Promise<unknown>;
  verifyAuthenticationResponse: (opts: Record<string, unknown>) => Promise<{
    verified: boolean;
    authenticationInfo?: { newCounter: number };
  }>;
}

let cached: SimpleWebAuthn | null | undefined;

async function getLib(): Promise<SimpleWebAuthn | null> {
  if (cached !== undefined) return cached;
  try {
    // @ts-expect-error optional peer dependency
    const mod = await import("@simplewebauthn/server");
    cached = mod as unknown as SimpleWebAuthn;
    return cached;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "webauthn: @simplewebauthn/server not installed");
    cached = null;
    return null;
  }
}

function challengeKey(userId: string, ceremony: "reg" | "auth"): string {
  return `webauthn:challenge:${ceremony}:${userId}`;
}

async function saveChallenge(userId: string, ceremony: "reg" | "auth", challenge: string): Promise<void> {
  await redis.setex(challengeKey(userId, ceremony), CHALLENGE_TTL_SECONDS, challenge);
}

async function popChallenge(userId: string, ceremony: "reg" | "auth"): Promise<string | null> {
  const key = challengeKey(userId, ceremony);
  const value = await redis.get(key).catch(() => null);
  if (value) await redis.del(key).catch(() => 0);
  return value;
}

export async function isEnabled(): Promise<boolean> {
  return (await getLib()) !== null;
}

export async function buildRegistrationOptions(userId: string, userName: string): Promise<unknown> {
  const lib = await getLib();
  if (!lib) throw new Error("WebAuthn not installed");
  const existing = await prisma.webauthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  const options = await lib.generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(userId),
    userName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((c) => ({
      id: Buffer.from(c.credentialId).toString("base64url"),
      transports: (c.transports?.split(",").filter(Boolean) ?? []) as string[],
    })),
  });
  const challenge = (options as { challenge: string }).challenge;
  await saveChallenge(userId, "reg", challenge);
  return options;
}

export async function verifyRegistration(userId: string, response: unknown): Promise<{ verified: boolean; credentialId?: string }> {
  const lib = await getLib();
  if (!lib) throw new Error("WebAuthn not installed");
  const expectedChallenge = await popChallenge(userId, "reg");
  if (!expectedChallenge) throw new Error("challenge expired or missing");

  const result = await lib.verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!result.verified || !result.registrationInfo) return { verified: false };
  const info = result.registrationInfo;
  const rawId = Buffer.from(info.credential.id, "base64url");

  await prisma.webauthnCredential.create({
    data: {
      userId,
      credentialId: rawId,
      publicKey: Buffer.from(info.credential.publicKey),
      counter: BigInt(info.credential.counter ?? 0),
      transports: info.credential.transports?.join(",") ?? null,
      deviceType: info.credentialDeviceType ?? "singleDevice",
      backedUp: info.credentialBackedUp ?? false,
    },
  });
  return { verified: true, credentialId: info.credential.id };
}

export async function buildAuthenticationOptions(userId: string): Promise<unknown> {
  const lib = await getLib();
  if (!lib) throw new Error("WebAuthn not installed");
  const creds = await prisma.webauthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  const options = await lib.generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: Buffer.from(c.credentialId).toString("base64url"),
      transports: (c.transports?.split(",").filter(Boolean) ?? []) as string[],
    })),
  });
  const challenge = (options as { challenge: string }).challenge;
  await saveChallenge(userId, "auth", challenge);
  return options;
}

export async function verifyAuthentication(userId: string, response: { id?: string }): Promise<{ verified: boolean }> {
  const lib = await getLib();
  if (!lib) throw new Error("WebAuthn not installed");
  const expectedChallenge = await popChallenge(userId, "auth");
  if (!expectedChallenge) throw new Error("challenge expired or missing");
  const credId = response.id;
  if (!credId) throw new Error("credential id missing from response");

  const stored = await prisma.webauthnCredential.findFirst({
    where: { userId, credentialId: Buffer.from(credId, "base64url") },
  });
  if (!stored) throw new Error("unknown credential");

  const result = await lib.verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: Buffer.from(stored.credentialId).toString("base64url"),
      publicKey: new Uint8Array(stored.publicKey),
      counter: Number(stored.counter),
      transports: (stored.transports?.split(",").filter(Boolean) ?? []) as string[],
    },
  });

  if (!result.verified) return { verified: false };

  await prisma.webauthnCredential.update({
    where: { id: stored.id },
    data: {
      counter: BigInt(result.authenticationInfo?.newCounter ?? Number(stored.counter) + 1),
      lastUsedAt: new Date(),
    },
  });
  return { verified: true };
}
