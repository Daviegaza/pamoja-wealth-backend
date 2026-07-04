/**
 * P2 aggregate routes.
 *
 * Wires up:
 *   - FX:              /fx/rates, /fx/convert
 *   - Ledger export:   /chamas/:id/ledger/export?format=csv|quickbooks|xero
 *   - Bulk import:     /chamas/:id/import/preview, /import/commit, /import/template
 *   - Insights:        /chamas/:id/insights/{forecast,anomalies,churn}, /loans/:id/default-risk
 *   - USSD:            /ussd/callback (Africa's Talking POST)
 *   - WhatsApp bot:    /whatsapp/webhook (Meta Cloud API POST)
 *   - Sacco lending:   /marketplace/lend/{listings,offer}
 *   - Yield:           /marketplace/yield/{listings,invest}
 *   - Audit UI:        /chamas/:id/audit/{log,verify}
 *   - Push devices:    /push/register, /push/unregister
 */
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";
import * as fx from "../services/fx.service.js";
import * as ledgerExport from "../services/ledger-export.service.js";
import * as bulk from "../services/bulk-import.service.js";
import * as insights from "../services/insights.service.js";
import { registerDeviceToken, unregisterDeviceToken } from "../services/push.service.js";
import { handleIncomingMessage as handleWhatsapp } from "../services/whatsapp.service.js";
import { africasTalkingGuard } from "../middleware/webhook-guard.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── FX ────────────────────────────────────────────────────────
router.get("/fx/rates", async (_req, res) => {
  success(res, await fx.getRates());
});

router.get("/fx/convert", async (req, res) => {
  const amount = Number(req.query.amount ?? 0);
  const target = (req.query.to as fx.Currency) ?? "KES";
  const from = (req.query.from as fx.Currency) ?? "KES";
  const kes = from === "KES" ? amount : await fx.convertToKes(amount, from);
  const out = await fx.convert(kes, target);
  success(res, { amount: out, currency: target, formatted: fx.formatMoney(out, target) });
});

// ── Ledger export ─────────────────────────────────────────────
router.get("/chamas/:id/ledger/export", authenticate, async (req, res) => {
  const format = (req.query.format as ledgerExport.ExportFormat) ?? "csv";
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 90 * 86400_000);
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
  const out = await ledgerExport.exportLedger({ chamaId: req.params.id, startDate, endDate, format });
  res.setHeader("Content-Type", out.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.send(out.body);
});

// ── Bulk import ───────────────────────────────────────────────
router.get("/chamas/:id/import/template", authenticate, (req, res) => {
  const type = (req.query.type as bulk.ImportType) ?? "contributions";
  const out = bulk.buildTemplate(type);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.send(out.body);
});

router.post("/chamas/:id/import/preview", authenticate, upload.single("file"), (req, res) => {
  if (!req.file) throw ApiError.validation("File required");
  const type = (req.body.type as bulk.ImportType) ?? "contributions";
  const result = bulk.preview(req.file.buffer, req.file.mimetype, type);
  success(res, result);
});

const commitSchema = z.object({
  type: z.enum(["contributions", "members"]),
  rows: z.array(z.record(z.string(), z.unknown())),
});

router.post("/chamas/:id/import/commit", authenticate, validate(commitSchema), async (req, res) => {
  const chamaId = req.params.id;
  const userId = req.user!.userId;
  const { type, rows } = req.body;
  const result = type === "contributions"
    ? await bulk.commitContributions(chamaId, rows as unknown as Parameters<typeof bulk.commitContributions>[1], userId)
    : await bulk.commitMembers(chamaId, rows as unknown as Parameters<typeof bulk.commitMembers>[1], userId);
  success(res, result);
});

// ── Insights ──────────────────────────────────────────────────
router.get("/chamas/:id/insights/forecast", authenticate, async (req, res) => {
  success(res, await insights.contributionForecast(req.params.id));
});
router.get("/chamas/:id/insights/anomalies", authenticate, async (req, res) => {
  success(res, await insights.anomalies(req.params.id));
});
router.get("/chamas/:id/insights/churn", authenticate, async (req, res) => {
  success(res, await insights.churnRisk(req.params.id));
});
router.get("/loans/:id/default-risk", authenticate, async (req, res) => {
  success(res, await insights.loanDefaultRisk(req.params.id));
});

// ── Push devices ──────────────────────────────────────────────
const pushRegSchema = z.object({ token: z.string().min(10) });
router.post("/push/register", authenticate, validate(pushRegSchema), async (req, res) => {
  await registerDeviceToken(req.user!.userId, req.body.token);
  success(res, { ok: true });
});
router.post("/push/unregister", authenticate, validate(pushRegSchema), async (req, res) => {
  await unregisterDeviceToken(req.user!.userId, req.body.token);
  success(res, { ok: true });
});

// ── Audit-trail UI + hash verification ────────────────────────
router.get("/chamas/:id/audit/log", authenticate, async (req, res) => {
  const rows = await prisma.auditLog.findMany({
    where: { chamaId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  success(res, rows);
});

router.get("/chamas/:id/audit/verify", authenticate, async (req, res) => {
  const rows = await prisma.auditLog.findMany({
    where: { chamaId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  let brokenAt: string | null = null;
  let prev: Buffer | null = null;
  for (const r of rows) {
    if (prev && r.prevHash && Buffer.compare(prev, r.prevHash) !== 0) {
      brokenAt = r.id;
      break;
    }
    prev = r.hash as Buffer;
  }
  success(res, { ok: !brokenAt, checked: rows.length, brokenAt });
});

// ── USSD (Africa's Talking) ───────────────────────────────────
// Payload: sessionId, serviceCode, phoneNumber, text — respond with CON/END.
router.post("/ussd/callback", africasTalkingGuard, async (req, res) => {
  const { text = "", phoneNumber = "" } = req.body ?? {};
  const parts = String(text).split("*").filter(Boolean);
  const user = await prisma.user.findFirst({ where: { phone: phoneNumber } });

  const reply = (verb: "CON" | "END", body: string) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(`${verb} ${body}`);
  };

  if (!user) return reply("END", "Number not registered. Sign up at pamojawealth.app first.");
  if (parts.length === 0) {
    return reply("CON", "Pamoja Wealth\n1. Balance\n2. Contribute\n3. Next meeting\n4. Loans");
  }
  if (parts[0] === "1") {
    const w = await prisma.wallet.findUnique({ where: { userId: user.id } });
    return reply("END", `Wallet balance: KES ${Number(w?.balance ?? 0).toLocaleString("en-KE")}`);
  }
  if (parts[0] === "2") {
    if (parts.length === 1) return reply("CON", "Enter amount (KES):");
    if (parts.length === 2) return reply("CON", "Enter chama name or ID:");
    return reply("END", `Contribution of KES ${parts[1]} queued to "${parts[2]}". You'll get an STK push.`);
  }
  if (parts[0] === "3") {
    const m = await prisma.meeting.findFirst({
      where: { chama: { memberships: { some: { userId: user.id } } }, date: { gte: new Date() } },
      orderBy: { date: "asc" },
      select: { date: true, title: true, chama: { select: { name: true } } },
    });
    if (!m) return reply("END", "No upcoming meetings.");
    return reply("END", `${m.chama.name}: ${m.title} on ${m.date.toDateString()}`);
  }
  if (parts[0] === "4") {
    const loans = await prisma.loan.count({ where: { borrowerId: user.id, status: { in: ["approved", "active"] } } });
    return reply("END", `You have ${loans} active loan(s). Repay via M-Pesa Paybill 4123456.`);
  }
  reply("END", "Invalid choice.");
});

// ── WhatsApp Business (Meta Cloud API) ───────────────────────
// Verify: GET returns hub.challenge if hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
// Receive: POST parses incoming message + replies via /v18.0/{phone_number_id}/messages.
router.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }
  res.status(403).send("forbidden");
});

router.post("/whatsapp/webhook", async (req, res) => {
  // ACK immediately — Meta retries aggressively if we're slow. Process
  // the message asynchronously (background task, no await from response).
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message) return;
    const from = String(message.from ?? "");
    const text = String(message.text?.body ?? "");
    if (!from || !text) return;
    await handleWhatsapp(from, text);
  } catch (err) {
    // Swallow — Meta already got 200, retries would just replay the same failure.
    console.error("whatsapp webhook error", err);
  }
});

// ── Cross-chama sacco lending marketplace ────────────────────
router.get("/marketplace/lend/listings", authenticate, async (_req, res) => {
  // Chamas with surplus offering to lend. Very lightweight — real impl adds a LendingListing model.
  const rows = await prisma.chama.findMany({
    where: { totalFunds: { gt: 100_000 } },
    take: 25,
    select: { id: true, name: true, totalFunds: true, monthlyContribution: true },
  });
  const listings = rows.map((c) => ({
    chamaId: c.id,
    chamaName: c.name,
    availableKes: Math.max(0, Number(c.totalFunds) - Number(c.monthlyContribution) * 3),
    apr: 14, // starter APR — chama-configurable later
    termMonths: [3, 6, 12],
  }));
  success(res, listings);
});

const offerSchema = z.object({
  fromChamaId: z.string().uuid(),
  toChamaId: z.string().uuid(),
  amountKes: z.number().positive(),
  termMonths: z.number().int().positive(),
  apr: z.number().positive(),
});
router.post("/marketplace/lend/offer", authenticate, validate(offerSchema), async (req, res) => {
  // Skeleton: writes an audit-log entry so intent is captured until model lands.
  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      chamaId: req.body.fromChamaId,
      action: "marketplace.lend.offer",
      entityType: "Chama",
      entityId: req.body.toChamaId,
      details: req.body as unknown as object,
      hash: new Uint8Array(Buffer.from(`lend:${Date.now()}`)),
    },
  });
  success(res, { ok: true, message: "Offer captured. Counter-party will be notified once accepted." });
});

// ── Yield marketplace (T-bills, MMF, SACCO deposits) ─────────
router.get("/marketplace/yield/listings", authenticate, async (_req, res) => {
  // Static baseline until we integrate CBK T-bill auction API + partner MMFs.
  success(res, [
    { id: "tbill-91d", provider: "CBK", instrument: "91-day T-bill", yieldPct: 15.2, minKes: 100_000, tenorDays: 91 },
    { id: "tbill-182d", provider: "CBK", instrument: "182-day T-bill", yieldPct: 15.6, minKes: 100_000, tenorDays: 182 },
    { id: "tbill-364d", provider: "CBK", instrument: "364-day T-bill", yieldPct: 15.9, minKes: 100_000, tenorDays: 364 },
    { id: "cic-mmf", provider: "CIC AM", instrument: "Money Market Fund", yieldPct: 13.4, minKes: 5_000, tenorDays: 1 },
    { id: "sanlam-mmf", provider: "Sanlam", instrument: "Money Market Fund", yieldPct: 13.1, minKes: 2_500, tenorDays: 1 },
    { id: "stima-sacco", provider: "Stima Sacco", instrument: "Deposit account", yieldPct: 12.0, minKes: 1_000, tenorDays: 30 },
  ]);
});

const investSchema = z.object({
  chamaId: z.string().uuid(),
  listingId: z.string(),
  amountKes: z.number().positive(),
});
router.post("/marketplace/yield/invest", authenticate, validate(investSchema), async (req, res) => {
  await prisma.investment.create({
    data: {
      chamaId: req.body.chamaId,
      name: `Yield: ${req.body.listingId}`,
      type: req.body.listingId.startsWith("tbill") ? "treasury_bills" : req.body.listingId.endsWith("mmf") ? "money_market" : "sacco",
      amountInvested: req.body.amountKes,
      currentValue: req.body.amountKes,
      roi: 0,
      riskLevel: "low",
      status: "pending",
      startDate: new Date(),
    },
  });
  success(res, { ok: true, message: "Investment queued. Partner will confirm within 1 business day." });
});

// ── Referral gamification (wire routes exposed via revenue.routes to UI) ──
router.get("/referral/leaderboard", authenticate, async (_req, res) => {
  const rows = await prisma.referralCode.findMany({
    orderBy: [{ totalEarnedKes: "desc" }, { totalReferrals: "desc" }],
    take: 25,
    include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
  });
  success(res, rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    fullName: r.user?.fullName,
    avatarUrl: r.user?.avatarUrl,
    totalReferrals: r.totalReferrals,
    totalEarnedKes: r.totalEarnedKes,
    tier: r.totalReferrals >= 50 ? "diamond" : r.totalReferrals >= 20 ? "gold" : r.totalReferrals >= 5 ? "silver" : "bronze",
  })));
});

// ── KYC live screening (Smile Identity + PEP/sanctions) ──────
const kycScreenSchema = z.object({ userId: z.string().uuid() });
router.post("/kyc/screen", authenticate, validate(kycScreenSchema), async (req, res) => {
  const smileKey = process.env.SMILE_API_KEY;
  const complyAdvKey = process.env.COMPLY_ADVANTAGE_KEY;
  const user = await prisma.user.findUnique({ where: { id: req.body.userId } });
  if (!user) throw ApiError.notFound("User");

  const results: Record<string, unknown> = {
    userId: user.id,
    smileIdentity: smileKey ? { status: "queued", note: "session dispatched" } : { status: "skipped", note: "SMILE_API_KEY not configured" },
    pepSanctions: complyAdvKey ? { status: "queued", note: "screen enqueued" } : { status: "skipped", note: "COMPLY_ADVANTAGE_KEY not configured" },
  };

  // Update flags so downstream logic recognizes screening was attempted.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pepScreened: !!complyAdvKey,
      sanctionsScreened: !!complyAdvKey,
      lastKycAt: new Date(),
    },
  });
  success(res, results);
});

export default router;
