import { z } from "zod";
import { ruleDocSchema } from "../lib/rule-doc.schema.js";

// POST /api/v1/ai/rules/compile
export const compileRuleSchema = z.object({
  sourceText: z.string().min(10, "Source text must be at least 10 characters").max(10_000),
});

// POST /api/v1/ai/rules/back-translate
export const backTranslateRuleSchema = z.object({
  ruleDoc: ruleDocSchema,
  languages: z
    .array(z.enum(["en", "sw"]))
    .min(1, "At least one language required")
    .max(2),
});

// POST /api/v1/chamas/:id/rules
export const publishRuleSchema = z.object({
  ruleDoc: ruleDocSchema,
  sourceText: z.string().max(10_000).optional(),
  compiledBy: z.enum(["human", "claude-sonnet-4-5"]),
  approvedByIds: z.array(z.string()).default([]),
});
