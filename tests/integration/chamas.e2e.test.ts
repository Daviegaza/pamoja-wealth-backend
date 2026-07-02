/**
 * chamas.e2e.test.ts — integration tests for /api/v1/chamas routes.
 *
 * The real code path imports Prisma from ../generated/prisma/client.js
 * so the global `@prisma/client` mock in tests/setup.ts does NOT reach the
 * `prisma` singleton exported from src/config/database.ts. We therefore mock
 * that module directly and fully control every Prisma call from each test.
 *
 * We also mock the email service (network) and rule-engine so evaluate() is a
 * no-op that never triggers ApiError.unprocessable.
 */

// Prisma singleton — this replaces src/config/database.ts entirely.
const mockPrisma: Record<string, any> = {
  chama: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  membership: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  inviteCode: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  invitation: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  joinRequest: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  loan: { count: jest.fn() },
  investment: { count: jest.fn() },
  donation: {
    findMany: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  chamaRule: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  analyticsCache: {
    findMany: jest.fn(),
  },
  plan: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
  $on: jest.fn(),
};

// Default transaction impl — pass the mockPrisma-as-tx to the callback.
mockPrisma.$transaction = jest.fn(async (fn: any) => {
  if (typeof fn === "function") return fn(mockPrisma);
  return Promise.all(fn);
});

jest.mock("../../src/config/database.js", () => ({
  prisma: mockPrisma,
}));

// Silence logger noise.
jest.mock("../../src/config/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Email service — network stub.
jest.mock("../../src/services/email.service.js", () => ({
  sendInvitation: jest.fn().mockResolvedValue(undefined),
  sendOtp: jest.fn().mockResolvedValue(undefined),
  sendWelcome: jest.fn().mockResolvedValue(undefined),
}));

// Rule engine — never block anything and expose the shapes chama.service uses.
jest.mock("../../src/services/rule-engine.service.js", () => ({
  evaluate: jest.fn().mockResolvedValue({ allowed: true, violations: [] }),
  isEnforcementEnabled: jest.fn().mockReturnValue(false),
  activeRule: jest.fn().mockResolvedValue(null),
  publishRuleVersion: jest.fn(),
}));

// Redis — rate-limit-redis needs `call`/`sendCommand`; global setup.ts mock
// omits them.
jest.mock("../../src/config/redis.js", () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue("PONG"),
    call: jest.fn().mockResolvedValue([1, 60]),
    sendCommand: jest.fn().mockResolvedValue([1, 60]),
    quit: jest.fn().mockResolvedValue(undefined),
  },
}));

// Rate-limit middleware — pass-through so rate-limit-redis doesn't try to
// SCRIPT LOAD against the redis mock.
jest.mock("../../src/middleware/rate-limit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    authLimiter: pass,
    aiLimiter: pass,
    standardLimiter: pass,
    uploadLimiter: pass,
    otpResendLimiter: pass,
  };
});

// BullMQ queues open real Redis TCP sockets at module load. Loaded via
// routes/webhooks/mpesa-c2b.routes.ts -> jobs/queue.ts.
jest.mock("../../src/jobs/queue.js", () => {
  const stubQueue = {
    add: jest.fn().mockResolvedValue({ id: "job-stub" }),
    close: jest.fn().mockResolvedValue(undefined),
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
    obliterate: jest.fn().mockResolvedValue(undefined),
  };
  return {
    connection: {},
    notificationsQueue: stubQueue,
    pruneNotificationsQueue: stubQueue,
    ledgerInvariantQueue: stubQueue,
    stkStatusPollQueue: stubQueue,
    billingQueue: stubQueue,
    allQueues: [stubQueue],
  };
});

import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/app.js";
import { config } from "../../src/config/index.js";

const USER = { userId: "user-1", email: "u1@test.dev" };
const OTHER_USER = { userId: "user-2", email: "u2@test.dev" };
const CHAMA_ID = "chama-abc";

function signAccessToken(payload: { userId: string; email: string }): string {
  return jwt.sign({ ...payload, type: "access" }, config.jwt.secret, {
    expiresIn: "5m",
  });
}

const authHeader = (userPayload = USER) =>
  ({ Authorization: `Bearer ${signAccessToken(userPayload)}` } as Record<string, string>);

function buildChamaRow(overrides: Record<string, any> = {}) {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: CHAMA_ID,
    name: "Test Chama",
    slug: "test-chama",
    description: "desc",
    category: "savings",
    type: "chama",
    privacy: "private",
    status: "active",
    logoUrl: null,
    coverImageUrl: null,
    location: "Nairobi",
    tags: [],
    monthlyContribution: 1000,
    totalFunds: 0,
    raisedAmount: 0,
    targetAmount: null,
    deadline: null,
    requireKyc: false,
    allowDiscovery: false,
    maxMembers: null,
    currentPlanCode: "free",
    nextMeetingDate: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default $transaction impl after clearAllMocks.
  mockPrisma.$transaction.mockImplementation(async (fn: any) => {
    if (typeof fn === "function") return fn(mockPrisma);
    return Promise.all(fn);
  });
});

describe("POST /api/v1/chamas", () => {
  it("401 without token", async () => {
    const res = await request(app)
      .post("/api/v1/chamas")
      .send({ name: "New Chama", category: "savings", monthlyContribution: 500 });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("400 when body is invalid", async () => {
    const res = await request(app)
      .post("/api/v1/chamas")
      .set(authHeader())
      .send({ name: "A" }); // too-short name, missing category
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("201 creates a chama on happy path", async () => {
    mockPrisma.chama.create.mockResolvedValue({
      ...buildChamaRow(),
      inviteCodes: [{ code: "ABCD1234" }],
    });

    const res = await request(app)
      .post("/api/v1/chamas")
      .set(authHeader())
      .send({
        name: "New Chama",
        category: "savings",
        monthlyContribution: 1000,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.chama.id).toBe(CHAMA_ID);
    expect(res.body.data.inviteCode).toBe("ABCD1234");
    expect(mockPrisma.chama.create).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/v1/chamas", () => {
  it("401 without token", async () => {
    const res = await request(app).get("/api/v1/chamas");
    expect(res.status).toBe(401);
  });

  it("200 lists chamas with pagination meta", async () => {
    mockPrisma.chama.findMany.mockResolvedValue([
      {
        ...buildChamaRow(),
        _count: { memberships: 3 },
      },
    ]);
    mockPrisma.chama.count.mockResolvedValue(1);

    const res = await request(app).get("/api/v1/chamas").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(CHAMA_ID);
    expect(res.body.data[0].memberCount).toBe(3);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1 });
  });
});

describe("GET /api/v1/chamas/:id", () => {
  it("401 without token", async () => {
    const res = await request(app).get(`/api/v1/chamas/${CHAMA_ID}`);
    expect(res.status).toBe(401);
  });

  it("404 when chama does not exist", async () => {
    mockPrisma.chama.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get(`/api/v1/chamas/${CHAMA_ID}`)
      .set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("200 returns chama with members and stats", async () => {
    mockPrisma.chama.findUnique
      // 1st call: getById
      .mockResolvedValueOnce({
        ...buildChamaRow(),
        memberships: [
          {
            id: "m1",
            userId: USER.userId,
            chamaId: CHAMA_ID,
            role: "owner",
            totalContributions: 500,
            shares: 1,
            status: "active",
            contributionStreak: 2,
            joinedAt: new Date("2025-01-02T00:00:00.000Z"),
            user: {
              id: USER.userId,
              fullName: "Alice",
              avatarUrl: null,
              email: USER.email,
              phone: null,
            },
          },
        ],
      })
      // 2nd call: getStats → chama select
      .mockResolvedValueOnce({ totalFunds: 0, monthlyContribution: 1000 });

    mockPrisma.membership.count.mockResolvedValue(1);
    mockPrisma.loan.count.mockResolvedValue(0);
    mockPrisma.investment.count.mockResolvedValue(0);

    const res = await request(app)
      .get(`/api/v1/chamas/${CHAMA_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.chama.id).toBe(CHAMA_ID);
    expect(res.body.data.members).toHaveLength(1);
    expect(res.body.data.members[0].role).toBe("owner");
    expect(res.body.data.stats.memberCount).toBe(1);
  });
});

describe("PATCH /api/v1/chamas/:id (authorization + happy path)", () => {
  it("403 when caller is not a member of the chama", async () => {
    // requirePermission("manage_settings") — no membership found.
    mockPrisma.membership.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/chamas/${CHAMA_ID}`)
      .set(authHeader())
      .send({ name: "Renamed" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("403 when member lacks manage_settings permission", async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({
      id: "m-99",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "member",
    });

    const res = await request(app)
      .patch(`/api/v1/chamas/${CHAMA_ID}`)
      .set(authHeader())
      .send({ name: "Renamed" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("200 owner can update name", async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({
      id: "m-1",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "owner",
    });
    mockPrisma.chama.findUnique.mockResolvedValue(buildChamaRow());
    mockPrisma.chama.update.mockResolvedValue(
      buildChamaRow({ name: "Renamed Chama" })
    );

    const res = await request(app)
      .patch(`/api/v1/chamas/${CHAMA_ID}`)
      .set(authHeader())
      .send({ name: "Renamed Chama" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Renamed Chama");
    expect(mockPrisma.chama.update).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/chamas/:id/join", () => {
  it("401 without token", async () => {
    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/join`)
      .send({});
    expect(res.status).toBe(401);
  });

  it("409 when caller is already a member", async () => {
    mockPrisma.chama.findUnique.mockResolvedValue(buildChamaRow());
    mockPrisma.membership.findUnique.mockResolvedValue({
      id: "existing",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "member",
    });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/join`)
      .set(authHeader())
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("201 public chama → direct membership", async () => {
    mockPrisma.chama.findUnique.mockResolvedValue(
      buildChamaRow({ privacy: "public", allowDiscovery: true })
    );
    mockPrisma.membership.findUnique.mockResolvedValue(null);
    mockPrisma.membership.create.mockResolvedValue({
      id: "new-mem",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "member",
    });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/join`)
      .set(authHeader())
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("approved");
    expect(res.body.data.membership.id).toBe("new-mem");
  });

  it("201 private chama with no invite → creates a pending join request", async () => {
    mockPrisma.chama.findUnique.mockResolvedValue(
      buildChamaRow({ privacy: "private" })
    );
    mockPrisma.membership.findUnique.mockResolvedValue(null);
    mockPrisma.joinRequest.findUnique.mockResolvedValue(null);
    mockPrisma.joinRequest.upsert.mockResolvedValue({
      id: "jr-1",
      chamaId: CHAMA_ID,
      userId: USER.userId,
      status: "pending",
      message: "please",
    });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/join`)
      .set(authHeader())
      .send({ message: "please" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.joinRequest.id).toBe("jr-1");
  });
});

describe("POST /api/v1/chamas/:id/invite", () => {
  it("403 when caller lacks manage_members", async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({
      id: "m-x",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "member", // members cannot manage_members
    });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/invite`)
      .set(authHeader())
      .send({ method: "email", email: "invitee@test.dev" });

    expect(res.status).toBe(403);
  });

  it("201 owner can invite by email", async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({
      id: "m-owner",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "owner",
    });
    mockPrisma.chama.findUnique.mockResolvedValue(buildChamaRow());
    mockPrisma.user.findUnique.mockResolvedValue(null); // no resolvable user
    mockPrisma.invitation.create.mockResolvedValue({
      id: "inv-1",
      chamaId: CHAMA_ID,
      method: "email",
      token: "tok-x",
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/invite`)
      .set(authHeader())
      .send({ method: "email", email: "invitee@test.dev" });

    expect(res.status).toBe(201);
    expect(res.body.data.invitationId).toBe("inv-1");
    expect(res.body.data.method).toBe("email");
    expect(mockPrisma.invitation.create).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/chamas/invitations/accept", () => {
  it("400 when body is missing token", async () => {
    const res = await request(app)
      .post("/api/v1/chamas/invitations/accept")
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("404 when invitation token does not exist", async () => {
    mockPrisma.invitation.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/chamas/invitations/accept")
      .set(authHeader())
      .send({ token: "does-not-exist" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /api/v1/chamas/:id/remove-member/:userId", () => {
  it("403 when caller is not admin/owner", async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({
      id: "m-plain",
      userId: USER.userId,
      chamaId: CHAMA_ID,
      role: "member",
    });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/remove-member/${OTHER_USER.userId}`)
      .set(authHeader());

    expect(res.status).toBe(403);
  });

  it("200 owner can remove a regular member", async () => {
    // requirePermission call — caller is owner.
    mockPrisma.membership.findUnique
      .mockResolvedValueOnce({
        id: "m-owner",
        userId: USER.userId,
        chamaId: CHAMA_ID,
        role: "owner",
      })
      // service call — target member row.
      .mockResolvedValueOnce({
        id: "m-target",
        userId: OTHER_USER.userId,
        chamaId: CHAMA_ID,
        role: "member",
      });
    mockPrisma.membership.delete.mockResolvedValue({ id: "m-target" });

    const res = await request(app)
      .post(`/api/v1/chamas/${CHAMA_ID}/remove-member/${OTHER_USER.userId}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true });
    expect(mockPrisma.membership.delete).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/v1/chamas/:id/rules (sub-route)", () => {
  it("401 without token", async () => {
    const res = await request(app).get(`/api/v1/chamas/${CHAMA_ID}/rules`);
    expect(res.status).toBe(401);
  });

  it("200 returns list of rule versions", async () => {
    mockPrisma.chamaRule.findMany.mockResolvedValue([
      {
        id: "r1",
        chamaId: CHAMA_ID,
        version: 2,
        ruleDoc: { version: 2 },
        sourceText: null,
        compiledBy: "human",
        effectiveAt: new Date("2025-02-01T00:00:00.000Z"),
        supersededAt: null,
        createdById: USER.userId,
        approvedByIds: [],
        prevHash: null,
        hash: Buffer.from("abcd", "hex"),
        createdAt: new Date("2025-02-01T00:00:00.000Z"),
      },
    ]);

    const res = await request(app)
      .get(`/api/v1/chamas/${CHAMA_ID}/rules`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].version).toBe(2);
    expect(res.body.data[0].hash).toBe("abcd");
  });

  it("200 returns null when no active rule is set", async () => {
    mockPrisma.chamaRule.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get(`/api/v1/chamas/${CHAMA_ID}/rules/active`)
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
