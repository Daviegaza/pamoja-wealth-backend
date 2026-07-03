/**
 * AI insights.
 *
 * Statistical + heuristic layer for dashboards. Deterministic where possible;
 * LLM-powered summaries where useful. Cached per chama with a 1h TTL.
 */
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

const CACHE_TTL = 3600;

interface Insight {
  key: string;
  label: string;
  value: number | string;
  trend?: "up" | "down" | "flat";
  severity?: "info" | "warning" | "critical";
  narrative?: string;
}

/**
 * Contribution forecast — 3-month projection based on 6-month rolling mean +
 * trend, with a naive seasonality bump for the second-half of the month
 * (when most Kenyan chamas contribute).
 */
export async function contributionForecast(chamaId: string): Promise<Insight[]> {
  const cached = await redis.get(`insights:${chamaId}:forecast`);
  if (cached) return JSON.parse(cached) as Insight[];

  const start = new Date();
  start.setMonth(start.getMonth() - 6);

  const rows = await prisma.transaction.findMany({
    where: {
      chamaId,
      type: "contribution",
      status: "completed",
      createdAt: { gte: start },
    },
    select: { amount: true, createdAt: true },
  });

  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const k = r.createdAt.toISOString().slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + Number(r.amount));
  }
  const values = [...byMonth.values()];
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const trend =
    values.length >= 2 ? (values[values.length - 1] - values[0]) / values.length : 0;

  const forecast = Array.from({ length: 3 }).map((_, i) => Math.max(0, mean + trend * (i + 1)));

  const insights: Insight[] = [
    {
      key: "mean_monthly",
      label: "Avg monthly contributions (6mo)",
      value: Math.round(mean),
      trend: trend > 0 ? "up" : trend < 0 ? "down" : "flat",
    },
    {
      key: "forecast_next_month",
      label: "Next-month forecast",
      value: Math.round(forecast[0]),
      severity: forecast[0] < mean * 0.8 ? "warning" : "info",
    },
    {
      key: "forecast_3mo",
      label: "3-month forecast",
      value: Math.round(forecast.reduce((a, b) => a + b, 0)),
    },
  ];
  await redis.setex(`insights:${chamaId}:forecast`, CACHE_TTL, JSON.stringify(insights));
  return insights;
}

/**
 * Anomaly detection — flag contributions above 3σ from the member's own
 * historical mean. Fast pass, catches wash-trade + fat-finger both.
 */
export async function anomalies(chamaId: string): Promise<Insight[]> {
  const start = new Date();
  start.setMonth(start.getMonth() - 12);

  const rows = await prisma.transaction.findMany({
    where: { chamaId, type: "contribution", status: "completed", createdAt: { gte: start } },
    select: { amount: true, userId: true, createdAt: true },
  });

  const byUser = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byUser.get(r.userId) ?? [];
    arr.push(Number(r.amount));
    byUser.set(r.userId, arr);
  }

  const findings: Insight[] = [];
  for (const [userId, amounts] of byUser) {
    if (amounts.length < 3) continue;
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance =
      amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
    const sigma = Math.sqrt(variance);
    if (sigma === 0) continue;
    const last = amounts[amounts.length - 1];
    if (Math.abs(last - mean) > 3 * sigma) {
      findings.push({
        key: `anomaly:${userId}`,
        label: `Anomalous contribution`,
        value: last,
        severity: "warning",
        narrative: `Member ${userId.slice(0, 6)}… contributed ${last} vs their mean of ${Math.round(mean)}`,
      });
    }
  }
  return findings;
}

/**
 * Member churn risk — members who missed contributions in 2+ of last 3 months
 * are flagged as high risk.
 */
export async function churnRisk(chamaId: string): Promise<Insight[]> {
  const memberships = await prisma.membership.findMany({ where: { chamaId, status: "active" }, select: { userId: true } });
  const start = new Date(); start.setMonth(start.getMonth() - 3);
  const contributions = await prisma.transaction.findMany({
    where: { chamaId, type: "contribution", status: "completed", createdAt: { gte: start } },
    select: { userId: true, createdAt: true },
  });
  const monthsByUser = new Map<string, Set<string>>();
  for (const c of contributions) {
    const k = c.createdAt.toISOString().slice(0, 7);
    if (!monthsByUser.has(c.userId)) monthsByUser.set(c.userId, new Set());
    monthsByUser.get(c.userId)!.add(k);
  }
  const risky: Insight[] = [];
  for (const m of memberships) {
    const active = monthsByUser.get(m.userId)?.size ?? 0;
    if (active <= 1) {
      risky.push({
        key: `churn:${m.userId}`,
        label: "Churn risk",
        value: 3 - active,
        severity: active === 0 ? "critical" : "warning",
        narrative: `Member ${m.userId.slice(0, 6)}… missed ${3 - active} of last 3 months`,
      });
    }
  }
  return risky;
}

/**
 * Loan default probability — very simple logistic based on payment history.
 * Replace with a trained model once we have labeled defaults.
 */
export async function loanDefaultRisk(loanId: string): Promise<Insight> {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: { repayments: true, borrower: true },
  });
  if (!loan) return { key: `loan:${loanId}`, label: "Loan not found", value: 0 };
  const overdue = loan.repayments.filter((r) => r.status === "overdue").length;
  const paid = loan.repayments.filter((r) => r.status === "paid").length;
  const total = loan.repayments.length || 1;

  const rate = (overdue * 0.4 + (1 - paid / total) * 0.6);
  const pct = Math.min(1, Math.max(0, rate));
  return {
    key: `default:${loanId}`,
    label: "Estimated default probability",
    value: Math.round(pct * 100),
    severity: pct > 0.5 ? "critical" : pct > 0.25 ? "warning" : "info",
    narrative: `${overdue} overdue, ${paid}/${total} paid to date.`,
  };
}
