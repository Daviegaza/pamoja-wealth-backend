/**
 * WhatsApp bot service (Meta Cloud API).
 *
 * Multi-turn FSM keyed by phone. States:
 *   idle              → waiting for a command
 *   awaiting_amount   → after "contribute", ask for KES amount
 *   awaiting_chama    → after amount, ask which chama
 *   awaiting_confirm  → before firing STK, ask YES/NO
 *
 * Global commands reset state: "help", "cancel", "menu".
 * Auto-timeout: sessions older than SESSION_TIMEOUT_MS reset to idle.
 *
 * All persistence lives in `whatsapp_sessions` (Prisma). Replies are
 * dispatched via `sendReply`, which posts to Graph API when env vars
 * are present; in dev without keys it no-ops so tests stay silent.
 */
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { contribute } from "./contribute.service.js";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const GRAPH_URL = "https://graph.facebook.com/v18.0";

type State = "idle" | "awaiting_amount" | "awaiting_chama" | "awaiting_confirm";

interface SessionContext {
  amount?: number;
  chamaId?: string;
  chamaName?: string;
  chamaList?: Array<{ id: string; name: string }>;
}

const HELP_TEXT = [
  "Pamoja Wealth bot commands:",
  "• balance — wallet balance",
  "• contribute — start a contribution",
  "• meeting — next chama meeting",
  "• loans — active loans",
  "• groups — your chamas",
  "• cancel — abort current step",
  "• help — this menu",
].join("\n");

export async function sendReply(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    logger.debug({ to, body }, "whatsapp: missing creds — skipping send");
    return;
  }
  try {
    const res = await fetch(`${GRAPH_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body },
      }),
    });
    if (!res.ok) {
      logger.warn({ to, status: res.status }, "whatsapp: reply failed");
    }
  } catch (err) {
    logger.error({ err, to }, "whatsapp: reply error");
  }
}

async function loadSession(phone: string) {
  const existing = await prisma.whatsappSession.findUnique({ where: { phone } });
  if (existing) {
    // Auto-timeout stale sessions back to idle.
    if (Date.now() - existing.lastMessageAt.getTime() > SESSION_TIMEOUT_MS && existing.state !== "idle") {
      return prisma.whatsappSession.update({
        where: { phone },
        data: { state: "idle", context: {} },
      });
    }
    return existing;
  }
  return prisma.whatsappSession.create({ data: { phone } });
}

async function updateSession(phone: string, state: State, context: SessionContext, userId?: string | null) {
  return prisma.whatsappSession.update({
    where: { phone },
    data: {
      state,
      context: context as unknown as object,
      lastMessageAt: new Date(),
      ...(userId !== undefined ? { userId } : {}),
    },
  });
}

async function resolveUser(phone: string) {
  // Meta strips the leading +; user records store +2547... or 07... — try
  // both to stay tolerant of stored formats.
  return prisma.user.findFirst({
    where: {
      OR: [
        { phone },
        { phone: `+${phone}` },
        { phone: `0${phone.slice(3)}` },
      ],
    },
    select: { id: true, phone: true, fullName: true },
  });
}

async function listUserChamas(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "active" },
    select: { chama: { select: { id: true, name: true, status: true } } },
    take: 10,
  });
  return memberships
    .map((m) => m.chama)
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));
}

function parseAmount(text: string): number | null {
  const digits = text.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 1 || n > 250_000) return null;
  return Math.round(n);
}

// ── Public entrypoint ────────────────────────────────────────────────

export async function handleIncomingMessage(from: string, rawText: string): Promise<void> {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const user = await resolveUser(from);

  if (!user) {
    await sendReply(from, "You're not registered. Sign up at pamojawealth.app and add this number to your profile.");
    return;
  }

  const session = await loadSession(from);
  const ctx = (session.context as SessionContext) ?? {};

  // Global resets first — always work regardless of state.
  if (["cancel", "menu", "stop"].includes(lower)) {
    await updateSession(from, "idle", {}, user.id);
    await sendReply(from, "Cancelled. Type 'help' for options.");
    return;
  }
  if (lower === "help" || lower === "hi" || lower === "hello") {
    await updateSession(from, "idle", {}, user.id);
    await sendReply(from, `Hi ${user.fullName.split(" ")[0]}!\n\n${HELP_TEXT}`);
    return;
  }

  // FSM routing.
  switch (session.state as State) {
    case "awaiting_amount": {
      const amount = parseAmount(text);
      if (!amount) {
        await sendReply(from, "Please reply with a number between 1 and 250,000.");
        return;
      }
      const chamas = await listUserChamas(user.id);
      if (chamas.length === 0) {
        await updateSession(from, "idle", {}, user.id);
        await sendReply(from, "You're not in any active chamas. Join one on the app first.");
        return;
      }
      if (chamas.length === 1) {
        const c = chamas[0]!;
        await updateSession(from, "awaiting_confirm", { amount, chamaId: c.id, chamaName: c.name }, user.id);
        await sendReply(from, `Send KES ${amount.toLocaleString("en-KE")} to ${c.name}?\nReply YES to confirm or NO to cancel.`);
        return;
      }
      const menu = chamas.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
      await updateSession(from, "awaiting_chama", { amount, chamaList: chamas }, user.id);
      await sendReply(from, `Which chama?\n${menu}\nReply with the number or name.`);
      return;
    }

    case "awaiting_chama": {
      const list = ctx.chamaList ?? [];
      let chosen: { id: string; name: string } | undefined;
      const asNum = Number(text);
      if (Number.isInteger(asNum) && asNum >= 1 && asNum <= list.length) {
        chosen = list[asNum - 1];
      } else {
        chosen = list.find((c) => c.name.toLowerCase() === lower)
          ?? list.find((c) => c.name.toLowerCase().startsWith(lower));
      }
      if (!chosen) {
        await sendReply(from, "Not found. Reply with the number from the menu or the exact chama name.");
        return;
      }
      await updateSession(from, "awaiting_confirm", { amount: ctx.amount, chamaId: chosen.id, chamaName: chosen.name }, user.id);
      await sendReply(from, `Send KES ${(ctx.amount ?? 0).toLocaleString("en-KE")} to ${chosen.name}?\nReply YES to confirm or NO to cancel.`);
      return;
    }

    case "awaiting_confirm": {
      if (["yes", "y", "ndio", "ndiyo"].includes(lower)) {
        if (!ctx.amount || !ctx.chamaId) {
          await updateSession(from, "idle", {}, user.id);
          await sendReply(from, "Session expired. Start again with 'contribute'.");
          return;
        }
        try {
          await contribute({ userId: user.id, chamaId: ctx.chamaId, amount: ctx.amount });
          await updateSession(from, "idle", {}, user.id);
          await sendReply(from, `Sent! Check your phone for the M-Pesa prompt to send KES ${ctx.amount.toLocaleString("en-KE")} to ${ctx.chamaName ?? "your chama"}.`);
        } catch (err) {
          await updateSession(from, "idle", {}, user.id);
          const msg = err instanceof Error ? err.message : "Something went wrong.";
          await sendReply(from, `Could not start payment: ${msg}`);
        }
        return;
      }
      if (["no", "n", "hapana"].includes(lower)) {
        await updateSession(from, "idle", {}, user.id);
        await sendReply(from, "Cancelled. Type 'contribute' to try again.");
        return;
      }
      await sendReply(from, "Please reply YES or NO.");
      return;
    }

    case "idle":
    default: {
      // Command dispatch.
      if (lower === "balance") {
        const w = await prisma.wallet.findUnique({ where: { userId: user.id } });
        await sendReply(from, `Wallet balance: KES ${Number(w?.balance ?? 0).toLocaleString("en-KE")}`);
        return;
      }
      if (lower === "contribute") {
        await updateSession(from, "awaiting_amount", {}, user.id);
        await sendReply(from, "How much (KES)? Reply with a number, e.g. 500.");
        return;
      }
      if (lower === "meeting" || lower === "meetings") {
        const m = await prisma.meeting.findFirst({
          where: {
            chama: { memberships: { some: { userId: user.id } } },
            date: { gte: new Date() },
          },
          orderBy: { date: "asc" },
          select: { date: true, title: true, chama: { select: { name: true } } },
        });
        await sendReply(from, m
          ? `${m.chama.name}: ${m.title}\n${m.date.toDateString()} at ${m.date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}`
          : "No upcoming meetings.");
        return;
      }
      if (lower === "loans" || lower === "loan") {
        const loans = await prisma.loan.findMany({
          where: { borrowerId: user.id, status: { in: ["approved", "active"] } },
          select: { amount: true, amountRepaid: true, dueDate: true },
          take: 5,
        });
        if (loans.length === 0) {
          await sendReply(from, "No active loans.");
          return;
        }
        const lines = loans.map((l, i) => {
          const outstanding = Math.max(0, Number(l.amount) - Number(l.amountRepaid));
          return `${i + 1}. Outstanding KES ${outstanding.toLocaleString("en-KE")}, due ${l.dueDate.toDateString()}`;
        });
        await sendReply(from, `Active loans:\n${lines.join("\n")}`);
        return;
      }
      if (lower === "groups" || lower === "chamas") {
        const chamas = await listUserChamas(user.id);
        if (chamas.length === 0) { await sendReply(from, "You're not in any active chamas."); return; }
        await sendReply(from, `Your chamas:\n${chamas.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}`);
        return;
      }
      await sendReply(from, HELP_TEXT);
      return;
    }
  }
}
