/**
 * Development seed: billing plans + one small demo chama with RECORDED
 * contributions and a loan-register entry. Refuses to run in production.
 *
 *   npm run db:seed
 *
 * Demo logins (password Demo1234!): chair@demo.pamoja.test,
 * treasurer@demo.pamoja.test, member@demo.pamoja.test
 */
import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedPlans } from "./seed.plans.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const PASSWORD = "Demo1234!";

async function upsertUser(email: string, fullName: string, phone: string, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, fullName, phone, passwordHash, isVerified: true },
  });
}

async function main() {
  await seedPlans();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const chair = await upsertUser("chair@demo.pamoja.test", "Amina Otieno", "+254700000001", passwordHash);
  const treasurer = await upsertUser("treasurer@demo.pamoja.test", "Brian Mwangi", "+254700000002", passwordHash);
  const member = await upsertUser("member@demo.pamoja.test", "Cynthia Wanjiku", "+254700000003", passwordHash);

  const existing = await prisma.chama.findFirst({ where: { name: "Demo Savers Group", memberships: { some: { userId: chair.id } } } });
  if (existing) {
    console.log("Demo chama already exists — skipping records.");
    return;
  }

  const chama = await prisma.chama.create({
    data: {
      name: "Demo Savers Group",
      slug: `demo-savers-${crypto.randomBytes(3).toString("hex")}`,
      category: "savings",
      privacy: "private",
      allowDiscovery: false,
      monthlyContribution: 1000,
      paymentInstructions: "Pay to the group's own M-Pesa Paybill (example only), account: your phone number.",
      memberships: {
        create: [
          { userId: chair.id, role: "chairperson" },
          { userId: treasurer.id, role: "treasurer" },
          { userId: member.id, role: "member" },
        ],
      },
    },
  });

  await prisma.contributionSchedule.create({
    data: { chamaId: chama.id, name: "Monthly savings", amount: 1000, frequency: "monthly", startDate: new Date("2026-01-01"), dueDay: 5, createdById: treasurer.id },
  });

  await prisma.contributionRecord.createMany({
    data: [
      { chamaId: chama.id, memberId: member.id, amount: 1000, paidOn: new Date("2026-10-05"), method: "mpesa", mpesaReceipt: "DEMO000001", recordedById: treasurer.id, status: "confirmed", confirmedAt: new Date() },
      { chamaId: chama.id, memberId: chair.id, amount: 1000, paidOn: new Date("2026-10-04"), method: "cash", recordedById: treasurer.id },
    ],
  });

  await prisma.loan.create({
    data: {
      chamaId: chama.id,
      borrowerId: member.id,
      amount: 5000,
      agreedRepayable: 5000,
      interestRate: 0,
      termMonths: 0,
      purpose: "School fees (demo)",
      status: "active",
      issuedOn: new Date("2026-10-10"),
      dueDate: new Date("2027-01-10"),
      recordedById: treasurer.id,
      approvedById: chair.id,
    },
  });

  console.log(`Seeded demo chama ${chama.id}. Password for demo users: ${PASSWORD}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
