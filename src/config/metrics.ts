import { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";

/**
 * Prometheus-compatible metrics endpoint.
 *
 * Exposes a minimal set of business + runtime metrics on GET /metrics.
 * For a full Prometheus setup, replace this manual registry with `prom-client`:
 *
 *   npm install prom-client
 *
 * Then use `collectDefaultMetrics()` for Node.js runtime metrics and
 * `new Counter()`, `new Histogram()`, `new Gauge()` for business metrics.
 *
 * Current implementation provides a lightweight text format scrape endpoint
 * that any Prometheus-compatible scraper can consume.
 */

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  value: number;
  labels?: Record<string, string>;
}

const registry: Metric[] = [];

function formatLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  return `{${parts.join(",")}}`;
}

function renderMetrics(): string {
  const lines: string[] = [];
  for (const m of registry) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    lines.push(`${m.name}${formatLabels(m.labels)} ${m.value}`);
  }
  return lines.join("\n") + "\n";
}

// ── Public API ──────────────────────────────────────────────────────────

export function incCounter(name: string, help: string, labels?: Record<string, string>) {
  const existing = registry.find((m) => m.name === name && JSON.stringify(m.labels) === JSON.stringify(labels));
  if (existing) {
    existing.value += 1;
  } else {
    registry.push({ name, help, type: "counter", value: 1, labels });
  }
}

export function setGauge(name: string, help: string, value: number, labels?: Record<string, string>) {
  const existing = registry.find((m) => m.name === name && JSON.stringify(m.labels) === JSON.stringify(labels));
  if (existing) {
    existing.value = value;
  } else {
    registry.push({ name, help, type: "gauge", value, labels });
  }
}

export function observeHistogram(name: string, help: string, value: number, labels?: Record<string, string>) {
  // Simple histogram: store sum and count as separate metrics.
  incCounter(`${name}_count`, `${help} (count)`, labels);
  const sumKey = `${name}_sum`;
  const existing = registry.find((m) => m.name === sumKey && JSON.stringify(m.labels) === JSON.stringify(labels));
  if (existing) {
    existing.value += value;
  } else {
    registry.push({ name: sumKey, help: `${help} (sum)`, type: "counter", value, labels });
  }
}

/**
 * Express middleware that serves /metrics in Prometheus text format.
 */
export function metricsEndpoint(req: Request, res: Response, _next: NextFunction) {
  try {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(renderMetrics());
  } catch (err) {
    logger.error({ err }, "metrics: render failed");
    res.status(500).send("# metrics error\n");
  }
}

/**
 * Express middleware that tracks HTTP request metrics.
 * Attach BEFORE routes to capture all requests.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const route = req.route?.path ?? req.path ?? "unknown";

  res.on("finish", () => {
    const duration = Date.now() - start;
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    incCounter("http_requests_total", "Total HTTP requests", labels);
    observeHistogram("http_request_duration_ms", "HTTP request duration in ms", duration, labels);
  });

  next();
}
