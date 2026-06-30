import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { success } from "../utils/api-response.js";
import * as ruleEngine from "../services/rule-engine.service.js";

// GET /chamas/:id/rules → list all versions for the chama (newest first).
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.chamaRule.findMany({
      where: { chamaId: req.params.id },
      orderBy: { version: "desc" },
    });
    success(res, rows.map(serialize));
  } catch (err) {
    next(err);
  }
}

// GET /chamas/:id/rules/active → the current rule version.
export async function active(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await prisma.chamaRule.findFirst({
      where: { chamaId: req.params.id, supersededAt: null },
      orderBy: { version: "desc" },
    });
    if (!row) return success(res, null);
    success(res, serialize(row));
  } catch (err) {
    next(err);
  }
}

// GET /chamas/:id/rules/:version → a specific version.
export async function getVersion(req: Request, res: Response, next: NextFunction) {
  try {
    const version = parseInt(req.params.version, 10);
    if (Number.isNaN(version)) throw ApiError.validation("version must be a number");
    const row = await prisma.chamaRule.findUnique({
      where: { chamaId_version: { chamaId: req.params.id, version } },
    });
    if (!row) throw ApiError.notFound("ChamaRule");
    success(res, serialize(row));
  } catch (err) {
    next(err);
  }
}

// POST /chamas/:id/rules → publish a new version (manage_settings perm).
export async function publish(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as {
      ruleDoc: ruleEngine.RuleDoc;
      sourceText?: string;
      compiledBy: "human" | "claude-sonnet-4-5";
      approvedByIds: string[];
    };
    const result = await ruleEngine.publishRuleVersion({
      chamaId: req.params.id,
      ruleDoc: body.ruleDoc,
      sourceText: body.sourceText,
      compiledBy: body.compiledBy,
      createdById: req.user!.userId,
      approvedByIds: body.approvedByIds ?? [],
    });
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

type ChamaRuleRow = {
  id: string;
  chamaId: string;
  version: number;
  ruleDoc: unknown;
  sourceText: string | null;
  compiledBy: string;
  effectiveAt: Date;
  supersededAt: Date | null;
  createdById: string;
  approvedByIds: string[];
  prevHash: Uint8Array | null;
  hash: Uint8Array;
  createdAt: Date;
};

function serialize(row: ChamaRuleRow) {
  return {
    id: row.id,
    chamaId: row.chamaId,
    version: row.version,
    ruleDoc: row.ruleDoc,
    sourceText: row.sourceText,
    compiledBy: row.compiledBy,
    effectiveAt: row.effectiveAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdById: row.createdById,
    approvedByIds: row.approvedByIds,
    prevHash: row.prevHash ? Buffer.from(row.prevHash).toString("hex") : null,
    hash: Buffer.from(row.hash).toString("hex"),
    createdAt: row.createdAt.toISOString(),
  };
}
