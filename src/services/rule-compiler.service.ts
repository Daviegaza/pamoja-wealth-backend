// Rule Compiler — Claude-backed NL → RuleDoc translation.
// See RESEARCH_DOSSIER §6.10 (AI Rule-Engine Compiler).
//
// Two entry points:
//   - compileFromNaturalLanguage(sourceText) → typed RuleDoc + token usage
//   - backTranslate(ruleDoc, languages)      → plain EN/SW paragraphs
//
// All Claude calls redact MSISDN-looking strings from the source before
// transit (defence-in-depth per dossier §7.15). The compiled RuleDoc is
// validated against the same Zod schema the frontend uses — any mismatch
// throws RuleCompilationError so the caller can show a helpful error.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "../config/logger.js";
import { ruleDocSchema } from "../lib/rule-doc.schema.js";
import type { RuleDoc } from "./rule-engine.service.js";

// ─── Errors ──────────────────────────────────────────────────────────

export class RuleCompilationError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "RuleCompilationError";
  }
}

// ─── Anthropic client (lazy) ─────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new RuleCompilationError(
      "ANTHROPIC_API_KEY environment variable is required for rule compilation"
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// ─── PII redaction ───────────────────────────────────────────────────

// Catches +254XXXXXXXXX, 254XXXXXXXXX, and 07XXXXXXXX / 01XXXXXXXX. Rule
// text rarely contains MSISDNs in practice, but defence-in-depth (§7.15).
const MSISDN_RE = /(?:\+?254\d{9})|(?:\b0[17]\d{8}\b)/g;

function redactMsisdns(text: string): string {
  return text.replace(MSISDN_RE, "<MSISDN>");
}

// ─── Models ──────────────────────────────────────────────────────────

const COMPILER_MODEL = "claude-sonnet-4-5";
const BACK_TRANSLATE_MODEL = "claude-haiku-4-5";

// ─── Tool schema for structured output ───────────────────────────────
// Claude's tool-use pattern is the recommended way to get structured JSON
// out of the model. We declare a single `compile_rule` tool whose
// input_schema mirrors the RuleDoc JSON shape.

const compileRuleTool = {
  name: "compile_rule",
  description:
    "Emit a structured RuleDoc that captures every chama rule extracted from the secretary's natural-language description. Omit fields the source does not mention. If anything is ambiguous, return your best guess and list the uncertain field paths in `_uncertain`.",
  input_schema: {
    type: "object" as const,
    properties: {
      version: { type: "number", description: "Always 1 for a freshly compiled doc; the publisher reassigns it." },
      entryDeposit: {
        type: "object",
        properties: {
          amountKes: { type: "number" },
          refundableOnExit: { type: "boolean" },
          payableIn: { type: "number", description: "Number of installments (1-24)" },
        },
        required: ["amountKes", "refundableOnExit", "payableIn"],
      },
      contribution: {
        type: "object",
        properties: {
          amountKes: { type: "number" },
          cadence: { type: "string", enum: ["weekly", "biweekly", "monthly", "quarterly", "annual"] },
          dueDay: { type: "number", description: "1-31 for monthly; 1-7 for weekly (Mon=1)" },
          graceDays: { type: "number" },
        },
        required: ["amountKes", "cadence", "dueDay", "graceDays"],
      },
      eligibility: {
        type: "object",
        properties: {
          minAge: { type: "number" },
          maxAge: { type: "number" },
          genders: { type: "array", items: { type: "string", enum: ["male", "female", "any"] } },
          location: { type: "string" },
          employer: { type: "string" },
          custom: { type: "string" },
        },
      },
      vetting: {
        type: "object",
        properties: {
          sponsorRequired: { type: "boolean" },
          sponsorCount: { type: "number" },
          voteThresholdPct: { type: "number" },
          manualReviewByRoles: {
            type: "array",
            items: { type: "string", enum: ["owner", "admin", "chairperson", "treasurer", "secretary", "member"] },
          },
        },
        required: ["sponsorRequired", "sponsorCount", "voteThresholdPct", "manualReviewByRoles"],
      },
      voting: {
        type: "object",
        properties: {
          quorumPct: { type: "number" },
          passThresholdPct: { type: "number" },
          weightedByContribution: { type: "boolean" },
          weightedByTenureMonths: { type: "boolean" },
        },
        required: ["quorumPct", "passThresholdPct", "weightedByContribution", "weightedByTenureMonths"],
      },
      payoutOrder: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["rotational", "by_need", "by_vote", "lump_sum_at_term"] },
          rotationSeed: { type: "array", items: { type: "string" } },
        },
        required: ["mode"],
      },
      exit: {
        type: "object",
        properties: {
          trigger: {
            type: "object",
            properties: {
              missedContributions: { type: "number" },
              window: { type: "string", enum: ["rolling-6m", "rolling-12m", "absolute"] },
              manual: { type: "boolean" },
            },
          },
          penalty: {
            type: "object",
            properties: {
              forfeitEntryBond: { type: "boolean" },
              forfeitPctOfShares: { type: "number" },
              refundDelayDays: { type: "number" },
            },
          },
          proRated: { type: "boolean" },
        },
        required: ["trigger", "penalty", "proRated"],
      },
      dividend: {
        type: "object",
        properties: {
          policy: { type: "string", enum: ["equal", "by_shares", "by_contribution", "by_tenure", "reinvest"] },
          payoutCadence: { type: "string", enum: ["monthly", "quarterly", "annual", "at_term"] },
        },
        required: ["policy", "payoutCadence"],
      },
      _uncertain: {
        type: "array",
        items: { type: "string" },
        description: "Field paths (e.g. 'contribution.dueDay') the model was unsure about. Dropped before persistence — kept only for logging.",
      },
    },
    required: ["version", "contribution", "voting"],
  },
};

const SYSTEM_PROMPT = `You are a chama bylaw compiler for Pamoja Wealth, a Kenyan group-savings platform. Your job: read a secretary's natural-language description of a chama's rules and emit a typed structured rule document by calling the \`compile_rule\` tool.

Rules:
- Extract every rule you can find: contribution amounts/cadence, eligibility (age, gender, location, employer), vetting (sponsors, votes), voting thresholds, payout order, exit penalties, dividend policy, entry deposit.
- If the source does not mention a section, OMIT that section entirely — do not invent defaults.
- The \`contribution\` and \`voting\` sections are required; if missing from the source, pick the most conservative sensible defaults (e.g. monthly KES 1000 on day 1, 50% quorum, 50% pass).
- Currency is always KES.
- If anything is ambiguous, return your best guess AND add the dotted field path to the \`_uncertain\` array so a human can confirm.
- Always set \`version\` to 1 — the persistence layer reassigns the real version.
- Never include personally identifying information in your output.`;

// ─── compileFromNaturalLanguage ─────────────────────────────────────

export async function compileFromNaturalLanguage(
  sourceText: string
): Promise<{ ruleDoc: RuleDoc; modelUsed: string; tokensUsed: number }> {
  const client = getClient();
  const redacted = redactMsisdns(sourceText);

  const response = await client.messages.create({
    model: COMPILER_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [compileRuleTool],
    tool_choice: { type: "tool", name: compileRuleTool.name },
    messages: [{ role: "user", content: redacted }],
  });

  // Find the tool_use block. With tool_choice forcing this tool, Claude
  // returns exactly one tool_use; we still defend against malformed output.
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === compileRuleTool.name
  );
  if (!toolUse) {
    throw new RuleCompilationError(
      "Compiler did not return a tool_use block",
      { content: response.content }
    );
  }

  const rawInput = toolUse.input as Record<string, unknown>;

  // Strip the side-channel _uncertain array before validation; surface it
  // to logs so operators can review compiler confidence.
  const uncertain = Array.isArray(rawInput._uncertain) ? (rawInput._uncertain as string[]) : [];
  if (uncertain.length > 0) {
    logger.info({ uncertain, model: COMPILER_MODEL }, "rule-compiler: model flagged uncertain fields");
  }
  delete rawInput._uncertain;

  const parsed = ruleDocSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new RuleCompilationError(
      "Compiler output failed schema validation",
      formatZodError(parsed.error)
    );
  }

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
  return {
    ruleDoc: parsed.data as RuleDoc,
    modelUsed: COMPILER_MODEL,
    tokensUsed,
  };
}

function formatZodError(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.join(".") || "<root>";
    if (!out[path]) out[path] = [];
    out[path].push(issue.message);
  }
  return out;
}

// ─── backTranslate ───────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<"en" | "sw", string> = {
  en: "English",
  sw: "Swahili (Kiswahili)",
};

export async function backTranslate(
  ruleDoc: RuleDoc,
  languages: ("en" | "sw")[]
): Promise<Record<"en" | "sw", string>> {
  const client = getClient();

  // Strip any custom block defensively — we don't trust it to be PII-free.
  const safeDoc = { ...ruleDoc, custom: undefined };
  const docJson = JSON.stringify(safeDoc, null, 2);

  const out: Partial<Record<"en" | "sw", string>> = {};

  for (const lang of languages) {
    const language = LANGUAGE_NAMES[lang];
    if (!language) continue;

    const prompt = `Render this chama rule as 2-3 plain sentences in ${language}. Be specific about amounts and timing. Do not invent details that are not in the JSON. Do not include any code blocks — return only the natural-language sentences.\n\nRule JSON:\n${docJson}`;

    const response = await client.messages.create({
      model: BACK_TRANSLATE_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    out[lang] = text;
  }

  return out as Record<"en" | "sw", string>;
}
