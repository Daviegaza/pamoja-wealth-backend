import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type {
  ChamaCategory,
  InvestmentType,
  LoanStatus,
  NotificationType,
  PaymentMethod,
  RiskLevel,
  Role,
  RsvpStatus,
  TransactionStatus,
  TransactionType,
  VoteStatus,
  MeetingStatus,
  InvestmentStatus,
  DocumentType,
} from "../src/generated/prisma/enums.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_INFO_PATH = path.resolve(
  __dirname,
  "../../pamoja-wealth/e2e/.auth/user-info.json",
);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type UserInfo = {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  password: string;
  accessToken?: string;
  refreshToken?: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function daysAgo(d: number): Date {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt;
}

function daysFromNow(d: number): Date {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt;
}

async function ensureDemoMember(
  index: number,
  passwordHash: string,
): Promise<{ id: string }> {
  const email = `demo-member-${index}@pamoja.test`;
  const phone = `+2547000000${String(index).padStart(2, "0")}`;
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      phone,
      fullName: `Demo Member ${index}`,
      passwordHash,
      isVerified: true,
    },
  });
  return { id: user.id };
}

async function ensureChama(params: {
  slug: string;
  name: string;
  description: string;
  category: ChamaCategory;
  monthlyContribution: number;
  totalFunds: number;
}): Promise<{ id: string }> {
  const chama = await prisma.chama.upsert({
    where: { slug: params.slug },
    update: {
      name: params.name,
      description: params.description,
      category: params.category,
      monthlyContribution: params.monthlyContribution,
      totalFunds: params.totalFunds,
    },
    create: {
      name: params.name,
      slug: params.slug,
      description: params.description,
      category: params.category,
      monthlyContribution: params.monthlyContribution,
      totalFunds: params.totalFunds,
    },
  });
  return { id: chama.id };
}

async function ensureMembership(
  userId: string,
  chamaId: string,
  role: Role,
): Promise<void> {
  await prisma.membership.upsert({
    where: { userId_chamaId: { userId, chamaId } },
    update: { role },
    create: { userId, chamaId, role },
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(USER_INFO_PATH)) {
    console.error(
      `[seed-e2e-user] user-info.json not found at ${USER_INFO_PATH}. ` +
        "Run the Playwright global setup first (npx playwright test).",
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(USER_INFO_PATH, "utf-8");
  const info: UserInfo = JSON.parse(raw);

  const user = await prisma.user.findUnique({ where: { email: info.email } });
  if (!user) {
    console.error(
      `[seed-e2e-user] User with email ${info.email} not found in DB. ` +
        "Ensure Playwright global setup registered the user against this backend.",
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash("Demo1234!", 10);

  // Members
  const members = await Promise.all([
    ensureDemoMember(1, passwordHash),
    ensureDemoMember(2, passwordHash),
    ensureDemoMember(3, passwordHash),
  ]);

  // Chamas (owned by the e2e user)
  const savingsChama = await ensureChama({
    slug: `e2e-savings-${user.id.slice(0, 8)}`,
    name: "E2E Savings Circle",
    description: "Monthly savings pool for the Playwright demo user.",
    category: "savings",
    monthlyContribution: 5000,
    totalFunds: 120000,
  });

  const investmentChama = await ensureChama({
    slug: `e2e-invest-${user.id.slice(0, 8)}`,
    name: "E2E Investment Club",
    description: "Group investment vehicle for the Playwright demo user.",
    category: "investment",
    monthlyContribution: 10000,
    totalFunds: 450000,
  });

  // Memberships: user is owner, demo members belong too
  await ensureMembership(user.id, savingsChama.id, "owner");
  await ensureMembership(user.id, investmentChama.id, "owner");
  for (const m of members) {
    await ensureMembership(m.id, savingsChama.id, "member");
    await ensureMembership(m.id, investmentChama.id, "member");
  }

  // Wallet
  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { balance: 15000 },
    create: { userId: user.id, balance: 15000, currency: "KES" },
  });

  // Transactions (6, deterministic refs so idempotent via unique @reference)
  type TxSeed = {
    ref: string;
    type: TransactionType;
    amount: number;
    balanceAfter: number;
    method: PaymentMethod;
    description: string;
    daysBack: number;
    chamaId?: string;
  };
  const txSeeds: TxSeed[] = [
    {
      ref: `E2E-TX-${user.id.slice(0, 8)}-1`,
      type: "contribution",
      amount: 5000,
      balanceAfter: 5000,
      method: "mpesa",
      description: "Monthly contribution to E2E Savings Circle",
      daysBack: 28,
      chamaId: savingsChama.id,
    },
    {
      ref: `E2E-TX-${user.id.slice(0, 8)}-2`,
      type: "contribution",
      amount: 10000,
      balanceAfter: 15000,
      method: "mpesa",
      description: "Monthly contribution to E2E Investment Club",
      daysBack: 22,
      chamaId: investmentChama.id,
    },
    {
      ref: `E2E-TX-${user.id.slice(0, 8)}-3`,
      type: "withdrawal",
      amount: 2000,
      balanceAfter: 13000,
      method: "mpesa",
      description: "Emergency withdrawal",
      daysBack: 16,
    },
    {
      ref: `E2E-TX-${user.id.slice(0, 8)}-4`,
      type: "loan_disbursement",
      amount: 8000,
      balanceAfter: 21000,
      method: "bank",
      description: "Loan disbursement from E2E Savings Circle",
      daysBack: 10,
      chamaId: savingsChama.id,
    },
    {
      ref: `E2E-TX-${user.id.slice(0, 8)}-5`,
      type: "dividend",
      amount: 1200,
      balanceAfter: 22200,
      method: "mpesa",
      description: "Q1 dividend payout",
      daysBack: 5,
      chamaId: investmentChama.id,
    },
    {
      ref: `E2E-TX-${user.id.slice(0, 8)}-6`,
      type: "withdrawal",
      amount: 7200,
      balanceAfter: 15000,
      method: "mpesa",
      description: "Payout to M-Pesa",
      daysBack: 1,
    },
  ];

  for (const t of txSeeds) {
    const status: TransactionStatus = "completed";
    await prisma.transaction.upsert({
      where: { reference: t.ref },
      update: {},
      create: {
        userId: user.id,
        chamaId: t.chamaId,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        method: t.method,
        reference: t.ref,
        description: t.description,
        status,
        createdAt: daysAgo(t.daysBack),
      },
    });
  }

  // Loans (idempotent via chamaId+borrower+purpose lookup)
  const loanSeeds: Array<{
    chamaId: string;
    amount: number;
    interestRate: number;
    termMonths: number;
    purpose: string;
    status: LoanStatus;
    dueDate: Date;
    appliedDaysBack: number;
    approvedDaysBack?: number;
  }> = [
    {
      chamaId: savingsChama.id,
      amount: 50000,
      interestRate: 10,
      termMonths: 12,
      purpose: "Business capital for E2E demo user",
      status: "active",
      dueDate: daysFromNow(300),
      appliedDaysBack: 45,
      approvedDaysBack: 40,
    },
    {
      chamaId: investmentChama.id,
      amount: 25000,
      interestRate: 8,
      termMonths: 6,
      purpose: "School fees loan",
      status: "pending",
      dueDate: daysFromNow(180),
      appliedDaysBack: 3,
    },
  ];

  for (const ln of loanSeeds) {
    const existing = await prisma.loan.findFirst({
      where: {
        chamaId: ln.chamaId,
        borrowerId: user.id,
        purpose: ln.purpose,
      },
    });
    if (existing) continue;
    await prisma.loan.create({
      data: {
        chamaId: ln.chamaId,
        borrowerId: user.id,
        amount: ln.amount,
        interestRate: ln.interestRate,
        termMonths: ln.termMonths,
        purpose: ln.purpose,
        status: ln.status,
        appliedDate: daysAgo(ln.appliedDaysBack),
        approvedDate: ln.approvedDaysBack
          ? daysAgo(ln.approvedDaysBack)
          : null,
        approvedById: ln.approvedDaysBack ? user.id : null,
        dueDate: ln.dueDate,
      },
    });
  }

  // Investments (idempotent via chamaId+name)
  const investmentSeeds: Array<{
    name: string;
    type: InvestmentType;
    amountInvested: number;
    currentValue: number;
    roi: number;
    riskLevel: RiskLevel;
    status: InvestmentStatus;
    daysBack: number;
  }> = [
    {
      name: "Treasury Bill 91-day",
      type: "treasury_bills",
      amountInvested: 100000,
      currentValue: 105500,
      roi: 5.5,
      riskLevel: "low",
      status: "active",
      daysBack: 60,
    },
    {
      name: "NSE Blue Chip Basket",
      type: "stocks",
      amountInvested: 150000,
      currentValue: 168000,
      roi: 12,
      riskLevel: "medium",
      status: "active",
      daysBack: 120,
    },
  ];

  for (const inv of investmentSeeds) {
    const existing = await prisma.investment.findFirst({
      where: { chamaId: investmentChama.id, name: inv.name },
    });
    if (existing) continue;
    await prisma.investment.create({
      data: {
        chamaId: investmentChama.id,
        name: inv.name,
        type: inv.type,
        amountInvested: inv.amountInvested,
        currentValue: inv.currentValue,
        roi: inv.roi,
        riskLevel: inv.riskLevel,
        status: inv.status,
        startDate: daysAgo(inv.daysBack),
      },
    });
  }

  // Meetings (idempotent via chamaId+title)
  const meetingSeeds: Array<{
    title: string;
    description: string;
    daysOffset: number;
    time: string;
    location: string;
    isVirtual: boolean;
    status: MeetingStatus;
  }> = [
    {
      title: "E2E Monthly AGM",
      description: "Review contributions and vote on next investment.",
      daysOffset: 14,
      time: "18:00",
      location: "Zoom",
      isVirtual: true,
      status: "scheduled",
    },
    {
      title: "E2E Q1 Retrospective",
      description: "Recap of Q1 performance.",
      daysOffset: -14,
      time: "17:00",
      location: "Nairobi Community Hall",
      isVirtual: false,
      status: "completed",
    },
  ];

  for (const m of meetingSeeds) {
    const existing = await prisma.meeting.findFirst({
      where: { chamaId: savingsChama.id, title: m.title },
    });
    let meetingId: string;
    if (existing) {
      meetingId = existing.id;
    } else {
      const created = await prisma.meeting.create({
        data: {
          chamaId: savingsChama.id,
          createdById: user.id,
          title: m.title,
          description: m.description,
          date: daysFromNow(m.daysOffset),
          time: m.time,
          location: m.location,
          isVirtual: m.isVirtual,
          status: m.status,
          totalInvited: 4,
        },
      });
      meetingId = created.id;
    }
    const rsvp: RsvpStatus = "attending";
    await prisma.meetingRsvp.upsert({
      where: { meetingId_userId: { meetingId, userId: user.id } },
      update: { status: rsvp },
      create: { meetingId, userId: user.id, status: rsvp },
    });
  }

  // Vote (idempotent via chamaId+title)
  const voteTitle = "E2E: Approve new investment allocation";
  const existingVote = await prisma.vote.findFirst({
    where: { chamaId: investmentChama.id, title: voteTitle },
  });
  if (!existingVote) {
    const created = await prisma.vote.create({
      data: {
        chamaId: investmentChama.id,
        createdById: user.id,
        title: voteTitle,
        description: "Should we allocate 30% to money market funds?",
        status: "open" satisfies VoteStatus,
        closesAt: daysFromNow(7),
      },
    });
    await prisma.voteOption.createMany({
      data: [
        { voteId: created.id, label: "Yes, approve" },
        { voteId: created.id, label: "No, reject" },
      ],
    });
  }

  // Notifications (idempotent via user + title lookup)
  const notificationSeeds: Array<{
    type: NotificationType;
    title: string;
    message: string;
    isRead: boolean;
  }> = [
    {
      type: "wallet",
      title: "Wallet credited",
      message: "KES 1,200 dividend received.",
      isRead: false,
    },
    {
      type: "loan",
      title: "Loan approved",
      message: "Your KES 50,000 loan has been approved.",
      isRead: true,
    },
    {
      type: "meeting",
      title: "Upcoming meeting",
      message: "E2E Monthly AGM starts in 14 days.",
      isRead: false,
    },
  ];

  for (const n of notificationSeeds) {
    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, title: n.title },
    });
    if (existing) continue;
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
      },
    });
  }

  // Document
  const docName = "E2E Chama Constitution.pdf";
  const existingDoc = await prisma.document.findFirst({
    where: { chamaId: savingsChama.id, name: docName },
  });
  if (!existingDoc) {
    await prisma.document.create({
      data: {
        chamaId: savingsChama.id,
        uploadedById: user.id,
        name: docName,
        type: "pdf" satisfies DocumentType,
        sizeKb: 245,
        storageKey: `demo/e2e/${user.id}/constitution.pdf`,
      },
    });
  }

  console.log(
    "seeded: 2 chamas, wallet=" +
      wallet.balance.toString() +
      ", 6 tx, 2 loans, 2 investments, 2 meetings, 1 vote, 3 notifications, 1 document",
  );
}

main()
  .catch((err) => {
    console.error("[seed-e2e-user] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
