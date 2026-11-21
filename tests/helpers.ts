import crypto from "crypto";
import request from "supertest";
import app from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { redis } from "../src/config/redis.js";
import { generateAccessToken } from "../src/utils/jwt.js";

export { app, prisma, redis };
export const api = () => request(app);

const TABLES = [
  "audit_logs",
  "loan_repayment_records",
  "contribution_records",
  "contribution_schedules",
  "loan_repayments",
  "loan_guarantors",
  "loans",
  "meeting_rsvps",
  "meetings",
  "savings_goals",
  "invoices",
  "subscriptions",
  "plans",
  "invite_codes",
  "notifications",
  "memberships",
  "chamas",
  "users",
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await prisma.plan.createMany({
    data: [
      { code: "free", name: "Free", monthlyPriceKes: 0, annualPriceKes: 0, memberCap: 3, groupCap: 1, features: {} },
      { code: "starter", name: "Starter", monthlyPriceKes: 499, annualPriceKes: 4990, memberCap: 30, groupCap: 3, features: {} },
    ],
  });
}

export interface TestUser {
  id: string;
  email: string;
  fullName: string;
  token: string;
}

export async function createUser(name: string): Promise<TestUser> {
  const suffix = crypto.randomBytes(4).toString("hex");
  const user = await prisma.user.create({
    data: {
      email: `${name.toLowerCase()}-${suffix}@example.test`,
      phone: `+2547${crypto.randomInt(10_000_000, 99_999_999)}`,
      fullName: name,
      passwordHash: "x",
    },
  });
  return { id: user.id, email: user.email, fullName: user.fullName, token: generateAccessToken({ userId: user.id, email: user.email }) };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

/** Creates a chama via the API (creator = chairperson) and adds members with roles directly. */
export async function createChama(
  chair: TestUser,
  members: { user: TestUser; role: "treasurer" | "secretary" | "member" }[] = [],
  name = "Test Chama",
): Promise<string> {
  const res = await api().post("/api/v1/chamas").set(auth(chair)).send({ name, category: "savings" });
  if (res.status !== 201) throw new Error(`createChama failed: ${res.status} ${JSON.stringify(res.body)}`);
  const chamaId: string = res.body.data.id;
  for (const m of members) {
    await prisma.membership.create({ data: { chamaId, userId: m.user.id, role: m.role } });
  }
  return chamaId;
}

export async function closeConnections() {
  await prisma.$disconnect();
  redis.disconnect();
}
