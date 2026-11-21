/** Prisma Decimal | number | null -> number (KES, 2dp). */
export function toAmount(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Math.round(n * 100) / 100;
}

export function toAmountOrNull(value: { toString(): string } | number | null | undefined): number | null {
  return value === null || value === undefined ? null : toAmount(value);
}

/** Date -> "YYYY-MM-DD" (UTC, matching Postgres DATE columns). */
export function toDateOnly(value: Date): string;
export function toDateOnly(value: Date | null | undefined): string | null;
export function toDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" -> Date at UTC midnight. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
