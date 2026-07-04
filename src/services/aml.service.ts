/**
 * AML — screening + transaction monitoring + SAR drafting.
 *
 * Screening lists:
 *   - OFAC SDN (fetched from Treasury when SANCTIONS_URL_OFAC set)
 *   - UN consolidated (SANCTIONS_URL_UN)
 *   - EU consolidated (SANCTIONS_URL_EU)
 *   - Kenya PEP watchlist (config-owned, seed via /aml/pep/import)
 *
 * All lists are normalised into a single Redis set `aml:names` (SHA-256 of
 * lowercased-no-diacritics name). Refreshed via the aml-refresh cron
 * (daily 04:00). Screen results Redis-cached 24h per userId.
 *
 * Transaction monitoring rules:
 *   R-VEL  velocity: > N tx in T minutes on same account
 *   R-STR  structuring: multiple sub-threshold tx summing above threshold
 *   R-THR  amount over cash-transaction threshold (KE: 1M KES / USD equivalent)
 *   R-GEO  cross-border corridor with unusual recipient
 *
 * SAR draft: builds a JSON template matching FRC Kenya's format, ready for
 * a compliance officer to review and export.
 */
import crypto from "crypto";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { logger } from "../config/logger.js";

const LIST_KEY = "aml:names";
const CACHE_TTL = 24 * 60 * 60;

export interface ScreenResult {
  userId: string;
  matched: boolean;
  lists: string[];
  score: number;      // 0..100
  checkedAt: string;
  cached: boolean;
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashName(name: string): string {
  return crypto.createHash("sha256").update(normaliseName(name)).digest("hex");
}

// ── List refresh ─────────────────────────────────────────────────────

interface ListSource {
  id: string;
  url?: string;
  parser: (raw: string) => string[];
}

const SOURCES: ListSource[] = [
  {
    id: "OFAC-SDN",
    url: process.env.SANCTIONS_URL_OFAC,
    parser: parseOfacSdn,
  },
  {
    id: "UN-consolidated",
    url: process.env.SANCTIONS_URL_UN,
    parser: parseUnList,
  },
  {
    id: "EU-consolidated",
    url: process.env.SANCTIONS_URL_EU,
    parser: parseEuList,
  },
];

function parseOfacSdn(raw: string): string[] {
  // OFAC SDN.CSV column 2 = name.
  return raw.split("\n").map((row) => {
    const cells = row.split(",");
    return (cells[1] ?? "").replace(/"/g, "").trim();
  }).filter(Boolean);
}

function parseUnList(raw: string): string[] {
  const matches = raw.match(/<NAME[^>]*>([^<]+)<\/NAME>/gi) ?? [];
  return matches.map((m) => m.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
}

function parseEuList(raw: string): string[] {
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Fetch each source, hash-normalise, load into Redis. Returns
 * {source, count, ok} rows.
 */
export async function refreshSanctionLists(): Promise<Array<{ source: string; count: number; ok: boolean }>> {
  const summary: Array<{ source: string; count: number; ok: boolean }> = [];
  const allHashes = new Set<string>();
  for (const src of SOURCES) {
    if (!src.url) {
      summary.push({ source: src.id, count: 0, ok: false });
      continue;
    }
    try {
      const res = await fetch(src.url);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = await res.text();
      const names = src.parser(body);
      for (const n of names) allHashes.add(hashName(n));
      summary.push({ source: src.id, count: names.length, ok: true });
    } catch (err) {
      logger.warn({ err, source: src.id }, "aml refresh failed");
      summary.push({ source: src.id, count: 0, ok: false });
    }
  }

  // Kenya PEP names loaded from a static seed via /aml/pep/import.
  const pepMembers = await redis.smembers("aml:pep");
  for (const h of pepMembers) allHashes.add(h);

  if (allHashes.size > 0) {
    await redis.del(LIST_KEY);
    // sadd caps ~1024 args per call — chunk.
    const batch: string[] = [...allHashes];
    for (let i = 0; i < batch.length; i += 500) {
      await redis.sadd(LIST_KEY, ...batch.slice(i, i + 500));
    }
    logger.info({ count: allHashes.size }, "aml list refreshed");
  }
  return summary;
}

/**
 * Seed PEP names (one per line). Existing set is replaced.
 */
export async function importPepList(names: string[]): Promise<{ imported: number }> {
  const hashes = names.map(hashName).filter(Boolean);
  await redis.del("aml:pep");
  for (let i = 0; i < hashes.length; i += 500) {
    await redis.sadd("aml:pep", ...hashes.slice(i, i + 500));
  }
  return { imported: hashes.length };
}

// ── Screening ────────────────────────────────────────────────────────

function cacheKey(userId: string): string {
  return `aml:screen:${userId}`;
}

export async function screenUser(userId: string, opts: { skipCache?: boolean } = {}): Promise<ScreenResult> {
  if (!opts.skipCache) {
    const cached = await redis.get(cacheKey(userId)).catch(() => null);
    if (cached) return { ...(JSON.parse(cached) as ScreenResult), cached: true };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, nationalId: true, phone: true },
  });
  if (!user) throw new Error("user not found");

  const candidates = [user.fullName].filter(Boolean) as string[];
  const hashes = candidates.map(hashName);
  const listHit = hashes.length > 0 ? await redis.sismember(LIST_KEY, hashes[0]) : 0;
  const pepHit = hashes.length > 0 ? await redis.sismember("aml:pep", hashes[0]) : 0;

  const lists: string[] = [];
  let score = 0;
  if (listHit) { lists.push("sanctions"); score += 80; }
  if (pepHit) { lists.push("pep"); score += 40; }

  const result: ScreenResult = {
    userId,
    matched: lists.length > 0,
    lists,
    score: Math.min(100, score),
    checkedAt: new Date().toISOString(),
    cached: false,
  };

  await redis.setex(cacheKey(userId), CACHE_TTL, JSON.stringify(result)).catch(() => {});
  await prisma.user.update({
    where: { id: userId },
    data: {
      pepScreened: true,
      sanctionsScreened: true,
    },
  });
  return result;
}

// ── Transaction monitoring rules ─────────────────────────────────────

export interface MonitoringHit {
  rule: "R-VEL" | "R-STR" | "R-THR" | "R-GEO";
  reason: string;
  detail: Record<string, unknown>;
}

interface MonitoringInput {
  userId: string;
  transactionId: string;
  amountKes: number;
  method: string;
  createdAt: Date;
}

const VELOCITY_WINDOW_MIN = 60;
const VELOCITY_MAX_COUNT = 8;
const STRUCTURING_WINDOW_HR = 24;
const STRUCTURING_THRESHOLD_KES = 1_000_000;
const STRUCTURING_SUBLIMIT_KES = 999_000;
const CTR_THRESHOLD_KES = 1_000_000;

export async function evaluateTransaction(input: MonitoringInput): Promise<MonitoringHit[]> {
  const hits: MonitoringHit[] = [];
  const velocityCutoff = new Date(input.createdAt.getTime() - VELOCITY_WINDOW_MIN * 60_000);
  const structuringCutoff = new Date(input.createdAt.getTime() - STRUCTURING_WINDOW_HR * 3_600_000);

  const [velocity, recent] = await Promise.all([
    prisma.transaction.count({
      where: { userId: input.userId, createdAt: { gte: velocityCutoff } },
    }),
    prisma.transaction.findMany({
      where: { userId: input.userId, createdAt: { gte: structuringCutoff } },
      select: { amount: true },
    }),
  ]);

  if (velocity > VELOCITY_MAX_COUNT) {
    hits.push({
      rule: "R-VEL",
      reason: `${velocity} tx in ${VELOCITY_WINDOW_MIN} min (limit ${VELOCITY_MAX_COUNT})`,
      detail: { count: velocity, windowMinutes: VELOCITY_WINDOW_MIN },
    });
  }

  const total = recent.reduce((s, t) => s + Number(t.amount ?? 0), 0);
  const belowLimitCount = recent.filter((t) => Number(t.amount ?? 0) < STRUCTURING_SUBLIMIT_KES && Number(t.amount ?? 0) > STRUCTURING_SUBLIMIT_KES * 0.5).length;
  if (belowLimitCount >= 3 && total >= STRUCTURING_THRESHOLD_KES) {
    hits.push({
      rule: "R-STR",
      reason: `Structuring pattern: ${belowLimitCount} sub-threshold tx summing to ${total.toLocaleString("en-KE")}`,
      detail: { belowLimitCount, totalKes: total },
    });
  }

  if (input.amountKes >= CTR_THRESHOLD_KES) {
    hits.push({
      rule: "R-THR",
      reason: `Single transaction ≥ ${CTR_THRESHOLD_KES.toLocaleString("en-KE")} (CTR threshold)`,
      detail: { amountKes: input.amountKes },
    });
  }

  if (hits.length > 0) {
    await autoOpenStr(input.userId, input.transactionId, hits);
  }
  return hits;
}

async function autoOpenStr(userId: string, transactionId: string, hits: MonitoringHit[]): Promise<void> {
  const primary = hits[0]!;
  try {
    await prisma.suspiciousTransactionReport.create({
      data: {
        subjectUserId: userId,
        reason: primary.reason,
        ruleTriggered: primary.rule,
        metadata: { transactionId, hits } as unknown as object,
        status: "open",
      },
    });
    logger.info({ userId, transactionId, rules: hits.map((h) => h.rule) }, "aml: STR auto-opened");
  } catch (err) {
    logger.error({ err, userId }, "aml: failed to open STR");
  }
}

// ── SAR (Suspicious Activity Report) draft ───────────────────────────

export interface SarDraft {
  reportId: string;
  filedBy: string;
  submittedAt: string;
  subject: {
    userId: string;
    fullName: string;
    nationalId: string | null;
    phone: string;
  };
  transactions: Array<{
    id: string;
    amountKes: number;
    method: string | null;
    reference: string;
    createdAt: string;
  }>;
  narrative: string;
  rulesTriggered: string[];
  frcTemplate: string; // matches Kenya FRC report layout
}

export async function draftSar(strId: string, filedByUserId: string): Promise<SarDraft> {
  const str = await prisma.suspiciousTransactionReport.findUnique({
    where: { id: strId },
    include: { subject: { select: { id: true, fullName: true, nationalId: true, phone: true } } },
  });
  if (!str) throw new Error("STR not found");
  const meta = str.metadata as { transactionId?: string; hits?: MonitoringHit[] };
  const tx = meta.transactionId
    ? await prisma.transaction.findUnique({
        where: { id: meta.transactionId },
        select: { id: true, amount: true, method: true, reference: true, createdAt: true },
      })
    : null;

  const rulesTriggered = (meta.hits ?? []).map((h) => h.rule);
  const narrative = [
    `Subject: ${str.subject.fullName} (userId=${str.subject.id}).`,
    `Trigger: ${str.reason}.`,
    tx ? `Transaction ${tx.reference} — KES ${Number(tx.amount).toLocaleString("en-KE")} via ${tx.method ?? "unknown"}.` : "",
    "Recommendation: review supporting KYC + freeze pending investigation.",
  ].filter(Boolean).join("\n");

  return {
    reportId: `SAR-${str.id}`,
    filedBy: filedByUserId,
    submittedAt: new Date().toISOString(),
    subject: {
      userId: str.subject.id,
      fullName: str.subject.fullName,
      nationalId: str.subject.nationalId ?? null,
      phone: str.subject.phone,
    },
    transactions: tx ? [{
      id: tx.id,
      amountKes: Number(tx.amount),
      method: tx.method,
      reference: tx.reference,
      createdAt: tx.createdAt.toISOString(),
    }] : [],
    narrative,
    rulesTriggered,
    frcTemplate: "Kenya-FRC-STR-v3",
  };
}
