import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { seedPlans } from "./seed.plans.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PASSWORD_PLAINTEXT = "Demo1234!";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function token(len = 16) {
  return crypto.randomBytes(len).toString("hex");
}

function inviteCode() {
  return "PW-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function daysFromNow(d: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt;
}

async function main() {
  console.log("🌱 Seeding Pamoja Wealth demo data...");

  // Plans are upserted (not wiped) — existing subscriptions keep pointing at
  // the same planId across re-seeds. Runs FIRST so any Chama defaults to free.
  await seedPlans();

  // Wipe in FK-safe order
  await prisma.donation.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.joinRequest.deleteMany();
  await prisma.voteBallot.deleteMany();
  await prisma.voteOption.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.meetingRsvp.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.loanRepayment.deleteMany();
  await prisma.loanGuarantor.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.investment.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.document.deleteMany();
  await prisma.savingsGoal.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.inviteCode.deleteMany();
  await prisma.analyticsCache.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.chama.deleteMany();
  await prisma.bankAccount.deleteMany();
  await prisma.mpesaAccount.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash(PASSWORD_PLAINTEXT, 10);

  // ─── Users ────────────────────────────────────────
  const userSeed = [
    { fullName: "Amara Okafor", username: "amara",   email: "amara@pamoja.app",   phone: "+254700100001", location: "Nairobi",  bio: "Founder, table-banking enthusiast" },
    { fullName: "Brian Otieno", username: "brian",   email: "brian@pamoja.app",   phone: "+254700100002", location: "Kisumu",   bio: "Chairperson @ Mwananchi Investors" },
    { fullName: "Caro Wanjiku", username: "caro",    email: "caro@pamoja.app",    phone: "+254700100003", location: "Nakuru",   bio: "Treasurer, loves spreadsheets" },
    { fullName: "Daniel Kiptoo", username: "daniel", email: "daniel@pamoja.app",  phone: "+254700100004", location: "Eldoret",  bio: "Real-estate chama member" },
    { fullName: "Esther Mumo", username: "esther",   email: "esther@pamoja.app",  phone: "+254700100005", location: "Mombasa",  bio: "Welfare group secretary" },
    { fullName: "Faraj Hassan", username: "faraj",   email: "faraj@pamoja.app",   phone: "+254700100006", location: "Lamu",     bio: "Diaspora member (UK)" },
    { fullName: "Grace Achieng", username: "grace",  email: "grace@pamoja.app",   phone: "+254700100007", location: "Kakamega", bio: "Merry-go-round veteran" },
    { fullName: "Hassan Ali",  username: "hassan",   email: "hassan@pamoja.app",  phone: "+254700100008", location: "Garissa",  bio: "M-Pesa power user" },
    { fullName: "Ivy Nyambura", username: "ivy",     email: "ivy@pamoja.app",     phone: "+254700100009", location: "Nairobi",  bio: "Tech worker, saves monthly" },
    { fullName: "James Mwangi", username: "james",   email: "james@pamoja.app",   phone: "+254700100010", location: "Thika",    bio: "Boda-boda SACCO" },
    { fullName: "Kendi Mutuma", username: "kendi",   email: "kendi@pamoja.app",   phone: "+254700100011", location: "Meru",     bio: "Maize-farmers chama" },
    { fullName: "Admin User",  username: "admin",    email: "admin@pamoja.app",   phone: "+254700100099", location: "Nairobi",  bio: "Platform administrator" },
  ];

  const users = await Promise.all(
    userSeed.map((u) =>
      prisma.user.create({
        data: {
          ...u,
          passwordHash: hash,
          isVerified: true,
          isActive: true,
          kycLevel: u.username === "admin" ? 3 : 2,
          avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${u.username}`,
          wallet: {
            create: {
              balance: 5000 + Math.floor(Math.random() * 95000),
              currency: "KES",
              totalDeposits: 50000,
            },
          },
        },
      })
    )
  );

  const byUsername = Object.fromEntries(users.map((u) => [u.username!, u]));
  console.log(`✓ Seeded ${users.length} users (password: ${PASSWORD_PLAINTEXT})`);

  // ─── Chamas + Fundraisers ──────────────────────────
  type ChamaSeed = {
    name: string;
    description: string;
    category: "savings" | "investment" | "welfare" | "mixed";
    type: "chama" | "fundraiser";
    privacy: "public" | "private" | "invite_only";
    monthlyContribution: number;
    totalFunds: number;
    targetAmount?: number;
    raisedAmount?: number;
    deadline?: Date;
    location: string;
    tags: string[];
    coverImageUrl: string;
    members: Array<{ username: string; role: "owner" | "admin" | "chairperson" | "treasurer" | "secretary" | "member"; contributions: number; streak?: number }>;
  };

  const chamaSeeds: ChamaSeed[] = [
    {
      name: "Mwananchi Savers Club",
      description: "Monthly savings + table banking for working professionals in Nairobi. Open to anyone with a steady income.",
      category: "savings",
      type: "chama",
      privacy: "public",
      monthlyContribution: 5000,
      totalFunds: 450000,
      location: "Nairobi",
      tags: ["savings", "table-banking", "monthly"],
      coverImageUrl: "https://images.unsplash.com/photo-1556742044-3c52d6e88c62?w=1200",
      members: [
        { username: "brian",  role: "owner",       contributions: 60000, streak: 12 },
        { username: "ivy",    role: "treasurer",   contributions: 60000, streak: 12 },
        { username: "amara",  role: "secretary",   contributions: 55000, streak: 11 },
        { username: "grace",  role: "member",      contributions: 50000, streak: 10 },
        { username: "james",  role: "member",      contributions: 45000, streak: 9 },
        { username: "kendi",  role: "member",      contributions: 40000, streak: 8 },
      ],
    },
    {
      name: "Westlands Real Estate Chama",
      description: "Pooling capital to buy land in Kiambu. Invite-only. Members must have KES 50k starter contribution.",
      category: "investment",
      type: "chama",
      privacy: "invite_only",
      monthlyContribution: 25000,
      totalFunds: 3200000,
      location: "Nairobi",
      tags: ["real-estate", "investment", "land"],
      coverImageUrl: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200",
      members: [
        { username: "amara",  role: "owner",      contributions: 500000, streak: 18 },
        { username: "caro",   role: "treasurer",  contributions: 480000, streak: 18 },
        { username: "daniel", role: "chairperson",contributions: 460000, streak: 17 },
        { username: "faraj",  role: "member",     contributions: 420000, streak: 16 },
        { username: "ivy",    role: "member",     contributions: 380000, streak: 15 },
      ],
    },
    {
      name: "Family Welfare Network",
      description: "Death benefit + hospital aid for extended-family members. Private — admin approves all joins.",
      category: "welfare",
      type: "chama",
      privacy: "private",
      monthlyContribution: 1000,
      totalFunds: 120000,
      location: "Kisumu",
      tags: ["welfare", "emergency", "family"],
      coverImageUrl: "https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=1200",
      members: [
        { username: "esther", role: "owner",      contributions: 12000, streak: 12 },
        { username: "grace",  role: "secretary",  contributions: 12000, streak: 12 },
        { username: "hassan", role: "member",     contributions: 11000, streak: 11 },
        { username: "james",  role: "member",     contributions: 10000, streak: 10 },
      ],
    },
    {
      name: "Coast Boda-Boda SACCO Pilot",
      description: "Riders pooling fuel + maintenance + loans. Mixed-mode: savings + investment + emergency.",
      category: "mixed",
      type: "chama",
      privacy: "public",
      monthlyContribution: 2000,
      totalFunds: 280000,
      location: "Mombasa",
      tags: ["transport", "boda-boda", "mixed"],
      coverImageUrl: "https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=1200",
      members: [
        { username: "hassan", role: "owner",      contributions: 24000, streak: 12 },
        { username: "james",  role: "chairperson",contributions: 22000, streak: 11 },
        { username: "daniel", role: "treasurer",  contributions: 20000, streak: 10 },
        { username: "kendi",  role: "member",     contributions: 18000, streak: 9 },
      ],
    },
    {
      name: "Mama Asha Cancer Treatment Appeal",
      description: "Help Mama Asha cover KES 850,000 in cancer treatment costs at MP Shah Hospital. Every shilling counts.",
      category: "welfare",
      type: "fundraiser",
      privacy: "public",
      monthlyContribution: 0,
      totalFunds: 0,
      targetAmount: 850000,
      raisedAmount: 412500,
      deadline: daysFromNow(45),
      location: "Nairobi",
      tags: ["medical", "fundraiser", "emergency"],
      coverImageUrl: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1200",
      members: [
        { username: "grace",  role: "owner",      contributions: 0 },
        { username: "esther", role: "treasurer",  contributions: 0 },
      ],
    },
    {
      name: "Wanjiru's Graduation Fund",
      description: "Family + close friends only. Pulling together for Wanjiru's KES 200k tuition for her final year.",
      category: "welfare",
      type: "fundraiser",
      privacy: "invite_only",
      monthlyContribution: 0,
      totalFunds: 0,
      targetAmount: 200000,
      raisedAmount: 65000,
      deadline: daysFromNow(60),
      location: "Nakuru",
      tags: ["education", "fundraiser", "family"],
      coverImageUrl: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200",
      members: [
        { username: "caro", role: "owner", contributions: 0 },
      ],
    },
  ];

  const chamas: Array<{ id: string; name: string; type: string; privacy: string }> = [];

  for (const cs of chamaSeeds) {
    const chama = await prisma.chama.create({
      data: {
        name: cs.name,
        slug: slugify(cs.name) + "-" + crypto.randomBytes(2).toString("hex"),
        description: cs.description,
        category: cs.category,
        type: cs.type,
        privacy: cs.privacy,
        monthlyContribution: cs.monthlyContribution,
        totalFunds: cs.totalFunds,
        targetAmount: cs.targetAmount,
        raisedAmount: cs.raisedAmount ?? 0,
        deadline: cs.deadline,
        location: cs.location,
        tags: cs.tags,
        coverImageUrl: cs.coverImageUrl,
        allowDiscovery: cs.privacy === "public",
        requireKyc: cs.privacy !== "public",
        memberships: {
          create: cs.members.map((m) => ({
            userId: byUsername[m.username].id,
            role: m.role,
            totalContributions: m.contributions,
            contributionStreak: m.streak ?? 0,
            shares: Math.floor(m.contributions / 1000),
          })),
        },
        inviteCodes: {
          create: [
            {
              code: inviteCode(),
              createdById: byUsername[cs.members[0].username].id,
              expiresAt: daysFromNow(30),
            },
          ],
        },
      },
    });
    chamas.push({ id: chama.id, name: chama.name, type: cs.type, privacy: cs.privacy });
  }
  console.log(`✓ Seeded ${chamas.length} chamas/fundraisers`);

  // ─── Transactions (contributions) ─────────────────
  const savingsChama = chamas[0];
  for (const m of chamaSeeds[0].members) {
    for (let i = 0; i < 3; i++) {
      await prisma.transaction.create({
        data: {
          userId: byUsername[m.username].id,
          chamaId: savingsChama.id,
          type: "contribution",
          amount: 5000,
          balanceAfter: 5000 * (i + 1),
          method: "mpesa",
          reference: "PW" + crypto.randomBytes(4).toString("hex").toUpperCase(),
          status: "completed",
          description: `Monthly contribution`,
          mpesaPhone: byUsername[m.username].phone,
          mpesaReceipt: "RJ" + crypto.randomBytes(3).toString("hex").toUpperCase(),
        },
      });
    }
  }

  // ─── Loans ────────────────────────────────────────
  const realEstateChama = chamas[1];
  await prisma.loan.create({
    data: {
      chamaId: realEstateChama.id,
      borrowerId: byUsername.daniel.id,
      amount: 150000,
      interestRate: 8.5,
      termMonths: 12,
      amountRepaid: 35000,
      purpose: "School fees — university",
      status: "active",
      approvedDate: daysFromNow(-40),
      approvedById: byUsername.amara.id,
      dueDate: daysFromNow(335),
      repayments: {
        create: [
          { amount: 13750, principal: 12500, interest: 1250, dueDate: daysFromNow(-10), paidDate: daysFromNow(-12), status: "paid" },
          { amount: 13750, principal: 12500, interest: 1250, dueDate: daysFromNow(20), status: "pending" },
          { amount: 13750, principal: 12500, interest: 1250, dueDate: daysFromNow(50), status: "pending" },
        ],
      },
      guarantors: {
        create: [
          { userId: byUsername.caro.id },
          { userId: byUsername.faraj.id },
        ],
      },
    },
  });

  // ─── Investment ───────────────────────────────────
  await prisma.investment.create({
    data: {
      chamaId: realEstateChama.id,
      name: "Kiambu Quarter-Acre Plot",
      type: "real_estate",
      amountInvested: 2500000,
      currentValue: 2900000,
      roi: 16.0,
      riskLevel: "medium",
      status: "active",
      startDate: daysFromNow(-180),
    },
  });

  // ─── Meeting + RSVPs ──────────────────────────────
  await prisma.meeting.create({
    data: {
      chamaId: savingsChama.id,
      createdById: byUsername.brian.id,
      title: "Q3 Review + Loan Approvals",
      description: "Quarterly performance review, approve pending loans, vote on next investment.",
      agenda: ["Treasurer report", "Loan approvals (2 pending)", "Vote on quarry investment", "AOB"],
      date: daysFromNow(7),
      time: "18:00",
      location: "Kileleshwa Community Hall",
      isVirtual: false,
      status: "scheduled",
      totalInvited: 6,
      attendeesCount: 4,
      rsvps: {
        create: [
          { userId: byUsername.brian.id,  status: "attending" },
          { userId: byUsername.ivy.id,    status: "attending" },
          { userId: byUsername.amara.id,  status: "attending" },
          { userId: byUsername.grace.id,  status: "tentative" },
        ],
      },
    },
  });

  // ─── Vote ─────────────────────────────────────────
  const vote = await prisma.vote.create({
    data: {
      chamaId: savingsChama.id,
      createdById: byUsername.brian.id,
      title: "Increase monthly contribution to KES 7,500?",
      description: "Proposal to raise the monthly contribution from KES 5,000 to KES 7,500 starting next quarter.",
      status: "open",
      closesAt: daysFromNow(5),
      options: {
        create: [
          { label: "Yes — increase to 7,500", count: 3 },
          { label: "No — keep at 5,000",      count: 2 },
          { label: "Yes — but to 6,500 only", count: 1 },
        ],
      },
    },
    include: { options: true },
  });

  await prisma.voteBallot.createMany({
    data: [
      { voteId: vote.id, optionId: vote.options[0].id, userId: byUsername.brian.id },
      { voteId: vote.id, optionId: vote.options[0].id, userId: byUsername.ivy.id },
      { voteId: vote.id, optionId: vote.options[0].id, userId: byUsername.amara.id },
      { voteId: vote.id, optionId: vote.options[1].id, userId: byUsername.kendi.id },
      { voteId: vote.id, optionId: vote.options[1].id, userId: byUsername.james.id },
      { voteId: vote.id, optionId: vote.options[2].id, userId: byUsername.grace.id },
    ],
  });

  // ─── Invitations (phone, username, email) ─────────
  const inviteOnlyChama = chamas[1];
  await prisma.invitation.createMany({
    data: [
      {
        chamaId: inviteOnlyChama.id,
        invitedById: byUsername.amara.id,
        inviteePhone: "+254700200001",
        method: "phone",
        token: token(),
        status: "pending",
        message: "Hi! Join our real-estate chama — pooling for Kiambu land.",
        expiresAt: daysFromNow(14),
      },
      {
        chamaId: inviteOnlyChama.id,
        invitedById: byUsername.amara.id,
        inviteeUsername: "kendi",
        inviteeUserId: byUsername.kendi.id,
        method: "username",
        token: token(),
        status: "pending",
        message: "Kendi — based on your savings record, we'd love to have you.",
        expiresAt: daysFromNow(14),
      },
      {
        chamaId: chamas[2].id,
        invitedById: byUsername.esther.id,
        inviteeEmail: "newcousin@example.com",
        method: "email",
        token: token(),
        status: "pending",
        expiresAt: daysFromNow(14),
      },
    ],
  });

  // ─── Join Requests ────────────────────────────────
  await prisma.joinRequest.create({
    data: {
      chamaId: chamas[2].id,
      userId: byUsername.ivy.id,
      message: "Cousin recommended — would love to join the welfare network.",
      status: "pending",
    },
  });

  // ─── Donations (to fundraisers) ───────────────────
  const fundraiser = chamas[4];
  const donors = [
    { username: "amara", amount: 5000, message: "Pole sana. Get well soon." },
    { username: "brian", amount: 10000, message: "Sending love" },
    { username: "ivy",   amount: 2500,  message: "Stay strong" },
    { username: "james", amount: 1500,  message: "" },
    { username: "hassan", amount: 5000, message: "From the Garissa crew" },
  ];
  for (const d of donors) {
    await prisma.donation.create({
      data: {
        chamaId: fundraiser.id,
        userId: byUsername[d.username].id,
        donorName: byUsername[d.username].fullName,
        donorEmail: byUsername[d.username].email,
        donorPhone: byUsername[d.username].phone,
        amount: d.amount,
        message: d.message,
        isAnonymous: false,
        paymentMethod: "mpesa",
        reference: "PW" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      },
    });
  }
  for (let i = 0; i < 2; i++) {
    await prisma.donation.create({
      data: {
        chamaId: fundraiser.id,
        donorName: "Anonymous",
        amount: 2000 + i * 500,
        message: "Stay strong",
        isAnonymous: true,
        paymentMethod: "mpesa",
        reference: "PW" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      },
    });
  }

  // ─── Notifications ────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { userId: byUsername.amara.id,  type: "wallet",   title: "Contribution received",  message: "KES 5,000 contribution to Mwananchi Savers Club confirmed." },
      { userId: byUsername.amara.id,  type: "meeting",  title: "Meeting in 7 days",      message: "Q3 Review on " + daysFromNow(7).toDateString() },
      { userId: byUsername.amara.id,  type: "vote",     title: "Active vote",            message: "Cast your vote on contribution increase." },
      { userId: byUsername.daniel.id, type: "loan",     title: "Loan repayment due",     message: "KES 13,750 due in 20 days." },
      { userId: byUsername.kendi.id,  type: "info",     title: "You've been invited",    message: "Amara invited you to Westlands Real Estate Chama." },
    ],
  });

  // ─── Chat messages ────────────────────────────────
  await prisma.chatMessage.createMany({
    data: [
      { chamaId: savingsChama.id, userId: byUsername.brian.id, content: "Karibu everyone — Q3 review is next Saturday." },
      { chamaId: savingsChama.id, userId: byUsername.ivy.id,   content: "Treasurer report ready. Total funds at KES 450k." },
      { chamaId: savingsChama.id, userId: byUsername.amara.id, content: "Asante Ivy. Let's also discuss the proposed contribution increase." },
      { chamaId: savingsChama.id, userId: byUsername.grace.id, content: "I'll come for sure." },
    ],
  });

  // ─── Savings Goals ────────────────────────────────
  await prisma.savingsGoal.createMany({
    data: [
      { userId: byUsername.amara.id,  name: "Emergency Fund",     targetAmount: 100000, currentAmount: 42000, targetDate: daysFromNow(180) },
      { userId: byUsername.ivy.id,    name: "Laptop Upgrade",     targetAmount: 120000, currentAmount: 65000, targetDate: daysFromNow(90) },
      { userId: byUsername.daniel.id, name: "Wedding Fund",       targetAmount: 500000, currentAmount: 180000, targetDate: daysFromNow(365) },
    ],
  });

  console.log("✓ Seeded transactions, loans, investments, meetings, votes, invitations, donations, notifications, chat, goals");

  console.log("\n🎉 Seed complete!");
  console.log("\nDemo login:");
  console.log("  email:    amara@pamoja.app  (or any seeded user)");
  console.log("  password: " + PASSWORD_PLAINTEXT);
  console.log("\nAdmin login:");
  console.log("  email:    admin@pamoja.app");
  console.log("  password: " + PASSWORD_PLAINTEXT);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
