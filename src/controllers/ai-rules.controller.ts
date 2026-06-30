import { Request, Response, NextFunction } from "express";
import * as compiler from "../services/rule-compiler.service.js";
import { ApiError } from "../utils/api-error.js";
import { success } from "../utils/api-response.js";
import { logger } from "../config/logger.js";

export async function compile(req: Request, res: Response, next: NextFunction) {
  try {
    const { sourceText } = req.body as { sourceText: string };
    const result = await compiler.compileFromNaturalLanguage(sourceText);
    success(res, result);
  } catch (err) {
    if (err instanceof compiler.RuleCompilationError) {
      logger.warn({ err, details: err.details }, "rule-compiler: compilation failed");
      return next(ApiError.validation(err.message, { details: err.details ?? {} }));
    }
    next(err);
  }
}

export async function backTranslate(req: Request, res: Response, next: NextFunction) {
  try {
    const { ruleDoc, languages } = req.body as {
      ruleDoc: Parameters<typeof compiler.backTranslate>[0];
      languages: ("en" | "sw")[];
    };
    const result = await compiler.backTranslate(ruleDoc, languages);
    success(res, result);
  } catch (err) {
    if (err instanceof compiler.RuleCompilationError) {
      return next(ApiError.validation(err.message));
    }
    next(err);
  }
}
