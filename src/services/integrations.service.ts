/**
 * Integrations service.
 *
 * Stores per-chama connections to external providers (Slack, Google Calendar,
 * Zoom, Zapier, custom webhooks, WhatsApp Business, QuickBooks, Xero).
 *
 * Credentials are encrypted at rest via encryption.service. OAuth is delegated
 * to provider-specific route handlers that redirect to their consent screens
 * and complete via a callback endpoint.
 *
 * Persistence uses the existing Document table repurposed for integration
 * blobs — the DB schema does not yet have a dedicated Integration model. A
 * migration will land in the P2 sweep (see task #26 audit UI).
 *
 * For now, integrations are stored in Redis keyed by
 *   integration:{chamaId}:{provider}  = JSON payload (encrypted credentials)
 * to unblock the FE without waiting on a Prisma migration.
 */
import { redis } from "../config/redis.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import crypto from "crypto";
import { logger } from "../config/logger.js";

export type ProviderId =
  | "slack" | "google_calendar" | "zoom" | "zapier" | "webhook"
  | "whatsapp_business" | "quickbooks" | "xero";

export interface Integration {
  id: string;
  provider: ProviderId;
  chamaId: string;
  connected: boolean;
  connectedAt: string;
  displayName?: string;
  scopes?: string[];
}

interface StoredPayload extends Integration {
  encryptedCredentials?: string;
}

function key(chamaId: string, provider: ProviderId): string {
  return `integration:${chamaId}:${provider}`;
}

function indexKey(chamaId: string): string {
  return `integration:${chamaId}:_index`;
}

export async function listForChama(chamaId: string): Promise<Integration[]> {
  const providers = await redis.smembers(indexKey(chamaId));
  const items: Integration[] = [];
  for (const p of providers) {
    const raw = await redis.get(key(chamaId, p as ProviderId));
    if (!raw) continue;
    const parsed = JSON.parse(raw) as StoredPayload;
    items.push({
      id: parsed.id,
      provider: parsed.provider,
      chamaId: parsed.chamaId,
      connected: parsed.connected,
      connectedAt: parsed.connectedAt,
      displayName: parsed.displayName,
      scopes: parsed.scopes,
    });
  }
  return items;
}

export async function connect(
  chamaId: string,
  provider: ProviderId,
  credentials?: Record<string, string>,
  displayName?: string,
  scopes?: string[],
): Promise<Integration> {
  const id = crypto.randomBytes(12).toString("hex");
  const payload: StoredPayload = {
    id,
    provider,
    chamaId,
    connected: true,
    connectedAt: new Date().toISOString(),
    displayName,
    scopes,
    encryptedCredentials: credentials ? encrypt(JSON.stringify(credentials)) : undefined,
  };
  await redis.set(key(chamaId, provider), JSON.stringify(payload));
  await redis.sadd(indexKey(chamaId), provider);
  logger.info({ chamaId, provider, id }, "integration connected");
  return {
    id: payload.id,
    provider: payload.provider,
    chamaId: payload.chamaId,
    connected: payload.connected,
    connectedAt: payload.connectedAt,
    displayName: payload.displayName,
    scopes: payload.scopes,
  };
}

export async function disconnect(chamaId: string, provider: ProviderId): Promise<void> {
  await redis.del(key(chamaId, provider));
  await redis.srem(indexKey(chamaId), provider);
  logger.info({ chamaId, provider }, "integration disconnected");
}

export async function getCredentials(chamaId: string, provider: ProviderId): Promise<Record<string, string> | null> {
  const raw = await redis.get(key(chamaId, provider));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as StoredPayload;
  if (!parsed.encryptedCredentials) return null;
  try {
    return JSON.parse(decrypt(parsed.encryptedCredentials)) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Dispatch an event to all custom-webhook integrations for a chama.
 * Signs the payload with HMAC-SHA256 using the stored secret so the
 * receiver can verify authenticity.
 */
export async function dispatchWebhook(chamaId: string, event: string, data: unknown): Promise<void> {
  const creds = await getCredentials(chamaId, "webhook");
  if (!creds?.url) return;
  const body = JSON.stringify({ event, data, chamaId, ts: Date.now() });
  const sig = crypto.createHmac("sha256", creds.secret ?? creds.apiKey ?? "").update(body).digest("hex");
  try {
    await fetch(creds.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pamoja-Signature": sig,
        "X-Pamoja-Event": event,
      },
      body,
    });
  } catch (err) {
    logger.warn({ err, chamaId, event }, "webhook dispatch failed");
  }
}
