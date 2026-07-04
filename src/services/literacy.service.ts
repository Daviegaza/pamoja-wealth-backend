/**
 * Financial literacy micro-lessons.
 *
 * 90-second reads modelled on the Duolingo micro-learning pattern +
 * behavioural-nudge framing. Content stored in-process for now; migrate
 * to a Prisma model when translations / A/B variants ship.
 *
 * Every lesson has: title, 60-90s read time, 3 key points, 1 practical
 * action the user can take today. Bilingual EN + SW.
 */
import { prisma } from "../config/database.js";

export interface Lesson {
  slug: string;
  title: string;
  titleSw: string;
  minutes: number;
  category: "basics" | "chama" | "loans" | "investing" | "safety";
  body: string;
  bodySw: string;
  keyPoints: string[];
  action: string;
}

const LESSONS: Lesson[] = [
  {
    slug: "why-chamas-work",
    title: "Why chamas work",
    titleSw: "Kwa nini chama hufaulu",
    minutes: 1,
    category: "chama",
    body: "A chama is a commitment device — you promise your future self, in front of witnesses, that you'll save every month. Behavioural economists (Ariely, Thaler) call this a pre-commitment strategy. It works because breaking a promise to your community costs more than breaking a promise to yourself.",
    bodySw: "Chama ni njia ya kujitolea — unaahidi mwenyewe wa baadaye, mbele ya mashahidi, kwamba utaweka akiba kila mwezi. Wachumi wa tabia (Ariely, Thaler) wanaita hii mkakati wa kujitolea mapema. Hufanya kazi kwa sababu kuvunja ahadi kwa jamii yako inagharimu zaidi kuliko kuvunja ahadi kwako mwenyewe.",
    keyPoints: [
      "Peer accountability > individual willpower",
      "Chamas grow money 3-5x faster than solo saving in East Africa (World Bank 2023)",
      "You get emergency loans without collateral",
    ],
    action: "Contribute to your chama today — even the minimum keeps your streak alive.",
  },
  {
    slug: "rule-of-72",
    title: "The Rule of 72",
    titleSw: "Kanuni ya 72",
    minutes: 1,
    category: "investing",
    body: "Want to know how long it takes to double your money? Divide 72 by your annual interest rate. At 12% CBR-linked deposit, your KES 10,000 doubles in 6 years. At 8%, it takes 9 years. Compound interest is the fastest legal wealth builder.",
    bodySw: "Unataka kujua muda unachukua kudouble pesa yako? Gawa 72 kwa kiwango cha riba cha mwaka. Katika amana ya 12% inayohusiana na CBR, KES 10,000 yako inadouble katika miaka 6.",
    keyPoints: [
      "72 ÷ interest rate = years to double",
      "12% → 6 years · 8% → 9 years · 5% → 14 years",
      "Time in market beats timing the market",
    ],
    action: "Move at least 20% of your chama surplus into a T-bill or MMF this quarter.",
  },
  {
    slug: "loan-cost-truth",
    title: "The real cost of a loan",
    titleSw: "Gharama halisi ya mkopo",
    minutes: 2,
    category: "loans",
    body: "The 'interest rate' isn't the full price. Add processing fees, insurance, mobile-money charges. A KES 10,000 mobile loan advertised at 'only 15%' can cost KES 12,500-14,000 by the time you repay. Always ask for the APR (annual percentage rate) — it bundles everything.",
    bodySw: "Kiwango cha 'riba' si bei kamili. Ongeza ada za usindikaji, bima, malipo ya pesa ya simu. Mkopo wa KES 10,000 unaotangazwa kwa '15% tu' unaweza kugharimu KES 12,500-14,000 wakati unarudisha.",
    keyPoints: [
      "APR > headline rate always",
      "Mobile loans in Kenya average 60-140% APR when fees are included",
      "Chama loans typically 12-24% APR — cheapest reliable source",
    ],
    action: "Before your next non-chama loan, calculate total repayment ÷ principal ÷ months × 12 to get true APR.",
  },
  {
    slug: "50-30-20-budget",
    title: "50/30/20 budgeting",
    titleSw: "Bajeti ya 50/30/20",
    minutes: 1,
    category: "basics",
    body: "Split every KES you earn: 50% needs (rent, food, transport, school), 30% wants (data, entertainment, treats), 20% savings + debt payoff. If chama contribution is 10%, that leaves 10% for emergency + retirement. Adjust as needed but always save something.",
    bodySw: "Gawa kila KES unayopata: 50% mahitaji, 30% matakwa, 20% akiba + kulipa deni.",
    keyPoints: [
      "50% needs · 30% wants · 20% future",
      "Automate the 20% first — pay yourself before bills",
      "Chama contributions count toward the 20%",
    ],
    action: "Enable auto-contribute to your chama on payday so the 20% moves before you see it.",
  },
  {
    slug: "spot-a-scam",
    title: "How to spot a financial scam",
    titleSw: "Jinsi ya kutambua ulaghai wa kifedha",
    minutes: 2,
    category: "safety",
    body: "Red flags: (1) guaranteed returns above 20% APR, (2) pressure to invite family fast, (3) opaque leadership, (4) no CBK/SASRA/CMA license, (5) withdrawals require 'clearing fees'. Pamoja shows hash-chained audit + all licenses on every chama page. Legitimate cooperatives publish annual audited accounts.",
    bodySw: "Ishara za hatari: kurudi kulikohakikishwa juu ya 20%, shinikizo la kualika familia haraka, uongozi usio wazi, hakuna leseni ya CBK/SASRA/CMA.",
    keyPoints: [
      "No legit investment guarantees > 15-20% APR sustainably",
      "Real cooperatives publish audited accounts",
      "'Clearing fee' before withdrawal = scam, always",
    ],
    action: "Check your chama's audit trail (Ledger & Audit tab) — the hash chain proves nobody has edited past entries.",
  },
  {
    slug: "emergency-fund",
    title: "Building an emergency fund",
    titleSw: "Kujenga akiba ya dharura",
    minutes: 2,
    category: "basics",
    body: "Target: 3-6 months of essential expenses in a fast-access account. Keep it separate from your chama pool (which locks funds). A KES 30,000/mo lifestyle needs KES 90k-180k emergency. Start with KES 500/week — that's KES 26k in a year without noticing.",
    bodySw: "Lengo: miezi 3-6 ya gharama muhimu katika akaunti ya haraka.",
    keyPoints: [
      "3 months minimum, 6 months ideal",
      "M-Shwari / KCB M-Pesa or bank savings — not chama",
      "KES 500/week = KES 26k/year with no lifestyle change",
    ],
    action: "Set up a weekly Ratiba to move KES 500 into a separate savings account. Do it now, forget it exists.",
  },
  {
    slug: "voting-in-a-chama",
    title: "How to vote effectively in your chama",
    titleSw: "Jinsi ya kupiga kura vizuri katika chama chako",
    minutes: 1,
    category: "chama",
    body: "Quorum × threshold determines if a motion passes. If your chama sets quorum at 50% and threshold at 66%, you need half the members present AND two-thirds of them agreeing. Missing votes count as 'no'. Read the motion before the meeting — WhatsApp is not the place for last-minute homework.",
    bodySw: "Idadi × kizingiti huamua kama pendekezo linapita.",
    keyPoints: [
      "Missing votes count as 'no' — always vote",
      "Quorum without threshold means nothing passes",
      "Post-vote appeals are hard — engage before the vote",
    ],
    action: "Open your chama's Voting tab and review any open motions right now.",
  },
  {
    slug: "when-to-take-a-loan",
    title: "When to take a chama loan",
    titleSw: "Wakati wa kuchukua mkopo wa chama",
    minutes: 2,
    category: "loans",
    body: "Good reasons: capital for income-generating activity, medical emergency, school fees. Bad reasons: consumer goods, weddings above budget, gambling. Rule of thumb — only borrow if the loan generates more return than it costs, or if the alternative (like a hospital bill you can't pay) is worse.",
    bodySw: "Sababu nzuri: mtaji wa shughuli inayozalisha kipato, dharura ya matibabu, ada za shule.",
    keyPoints: [
      "Income-generating > lifestyle",
      "Never borrow for depreciating consumer goods",
      "If you can't explain how you'll repay, don't borrow",
    ],
    action: "Before applying, write down the exact monthly repayment and next 6 months' income sources. If they don't match, wait.",
  },
];

const INDEX = LESSONS.map((l) => ({
  slug: l.slug,
  title: l.title,
  titleSw: l.titleSw,
  minutes: l.minutes,
  category: l.category,
  action: l.action,
}));

export function getLessonIndex() {
  return INDEX;
}

export function getLesson(slug: string): Lesson | null {
  return LESSONS.find((l) => l.slug === slug) ?? null;
}

export async function recordCompletion(userId: string, slug: string): Promise<void> {
  // Persist as an audit-log entry — no dedicated model needed for MVP.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.auditLog.create({
      data: {
        userId,
        action: "literacy.lesson.completed",
        entityType: "lesson",
        entityId: slug,
      } as any,
    });
  } catch { /* swallow */ }
}
