/**
 * Idempotent plan seeder.
 *
 * Run from `prisma/seed.ts` (or standalone via `tsx prisma/seed.plans.ts`)
 * before the app needs to look up Plan rows. Upserts by `code` so price /
 * feature edits propagate via re-run; existing Subscriptions keep pointing
 * at the same `planId`.
 *
 * Pricing source: /home/davie/WebstormProjects/pamoja-wealth/docs build brief
 * (Revenue stream 1). Annual = 10× monthly (2 months free). RESEARCH_DOSSIER
 * §1: M-Changa fee backlash teaches us to keep tier prices visible + flat.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Type re-declared here to avoid an import cycle with billing.service.ts.
type PlanCode = "free" | "starter" | "pro" | "enterprise";

interface PlanSeed {
  code: PlanCode;
  name: string;
  monthlyPriceKes: number;
  annualPriceKes: number;
  memberCap: number | null;
  groupCap: number | null;
  features: Record<string, boolean>;
}

const PLANS: PlanSeed[] = [
  {
    code: "free",
    name: "Free",
    monthlyPriceKes: 0,
    annualPriceKes: 0,
    memberCap: 15,
    groupCap: 1,
    // Only memberCap is enforced. No transaction fees on any plan.
    features: {},
  },
  {
    code: "starter",
    name: "Starter",
    monthlyPriceKes: 499,
    annualPriceKes: 4_990, // 10× monthly = 2 months free
    memberCap: 30,
    groupCap: 3,
    // Only memberCap is enforced. No transaction fees on any plan.
    features: {},
  },
  {
    code: "pro",
    name: "Pro",
    monthlyPriceKes: 1_499,
    annualPriceKes: 14_990,
    memberCap: 100,
    groupCap: null, // unlimited
    // Only memberCap is enforced. No transaction fees on any plan.
    features: {},
  },
  {
    code: "enterprise",
    name: "Enterprise",
    monthlyPriceKes: 4_999,
    annualPriceKes: 49_990,
    memberCap: null,
    groupCap: null,
    // Only memberCap is enforced. No transaction fees on any plan.
    features: {},
  },
];

export async function seedPlans(): Promise<void> {
  const db = prisma;
  for (const p of PLANS) {
    await db.plan.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        monthlyPriceKes: p.monthlyPriceKes,
        annualPriceKes: p.annualPriceKes,
        memberCap: p.memberCap,
        groupCap: p.groupCap,
        features: p.features,
        isActive: true,
      },
      update: {
        name: p.name,
        monthlyPriceKes: p.monthlyPriceKes,
        annualPriceKes: p.annualPriceKes,
        memberCap: p.memberCap,
        groupCap: p.groupCap,
        features: p.features,
        isActive: true,
      },
    });
  }
  console.log(`Seeded ${PLANS.length} plans`);
}

// Standalone runner — only fires when invoked directly, not when imported.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seedPlans()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error(err);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}
