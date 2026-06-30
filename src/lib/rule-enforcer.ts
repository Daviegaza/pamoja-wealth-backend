import { ApiError } from "../utils/api-error.js";
import { logger } from "../config/logger.js";
import * as ruleEngine from "../services/rule-engine.service.js";

/**
 * Phased rule-engine rollout (RESEARCH_DOSSIER §7.7):
 *   FEATURE_RULE_ENGINE_ENFORCE=false → shadow mode (log only)
 *   FEATURE_RULE_ENGINE_ENFORCE=true  → fail 422 with violations
 *
 * Evaluation errors are always swallowed (logged) so a buggy rule cannot
 * block real money movement. Once shadow-mode metrics show clean evaluation,
 * flip the flag in production.
 */
export async function enforceRule(
  point: ruleEngine.HookPoint,
  chamaId: string,
  ctx: ruleEngine.HookContext
): Promise<void> {
  try {
    const result = await ruleEngine.evaluate(point, chamaId, ctx);
    if (!result.allowed) {
      if (ruleEngine.isEnforcementEnabled()) {
        throw ApiError.unprocessable(result.violations);
      }
      logger.warn(
        { point, chamaId, violations: result.violations },
        "rule-engine: violations detected (shadow mode — not enforcing)"
      );
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn(
      { err, point, chamaId },
      "rule-engine: evaluation error (allowing operation)"
    );
  }
}
