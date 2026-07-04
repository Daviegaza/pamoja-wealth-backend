/**
 * Sentry init — backend.
 *
 * Wired via dynamic import so the module is only loaded when
 * SENTRY_DSN is set AND `@sentry/node` is installed. Neither
 * condition being true no-ops silently — dev + local envs stay
 * dependency-free.
 *
 * Install:
 *   npm i @sentry/node @sentry/profiling-node
 *
 * Env:
 *   SENTRY_DSN=https://...ingest.sentry.io/...
 *   SENTRY_TRACES_RATE=0.1    # optional, default 0.1
 *   SENTRY_ENV=production     # optional, defaults to NODE_ENV
 */
import { logger } from "./logger.js";

let sentryModule: unknown = null;

export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry disabled — SENTRY_DSN not set");
    return;
  }
  try {
    // Dynamic import gated by DSN presence — silence type check because
    // @sentry/node is intentionally an optional peer dep.
    // @ts-expect-error optional peer dependency
    const mod = await import("@sentry/node");
    const Sentry = mod as unknown as {
      init: (opts: Record<string, unknown>) => void;
      captureException: (err: unknown) => void;
    };
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0.1),
    });
    sentryModule = Sentry;
    logger.info("Sentry initialised");

    process.on("unhandledRejection", (err) => Sentry.captureException(err));
    process.on("uncaughtException", (err) => Sentry.captureException(err));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Sentry init failed — install @sentry/node to enable");
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const s = sentryModule as { captureException?: (e: unknown, ctx?: unknown) => void } | null;
  if (s?.captureException) s.captureException(err);
  else logger.error({ err, context }, "captureError (no Sentry)");
}
