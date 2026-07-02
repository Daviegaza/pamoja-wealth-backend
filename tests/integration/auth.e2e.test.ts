import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Mock external side-effect modules BEFORE importing the app.
// The setup file already mocks `@prisma/client` and `../src/config/redis.js`,
// but the real app imports Prisma from `../generated/prisma/client.js` (which
// bypasses the `@prisma/client` mock). We therefore mock the config/database
// singleton directly, plus provide a richer redis mock that supports `call`
// (needed by the express-rate-limit RedisStore) and returns the sentinel
// values the store expects.
// ---------------------------------------------------------------------------

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  wallet: {
    create: jest.fn(),
  },
};

jest.mock("../../src/config/database.js", () => ({
  prisma: mockPrisma,
}));

// Fake redis client: `call` returns a valid SHA1 string (for SCRIPT LOAD) and
// an [totalHits, timeToExpire] tuple for EVALSHA. Enough to let authLimiter
// (rate-limit-redis) work end-to-end.
const fakeSha = "0000000000000000000000000000000000000000";
const redisStore: Record<string, string> = {};
const mockRedis = {
  get: jest.fn(async (k: string) => redisStore[k] ?? null),
  set: jest.fn(async (k: string, v: string) => {
    redisStore[k] = v;
    return "OK";
  }),
  del: jest.fn(async (k: string) => {
    delete redisStore[k];
    return 1;
  }),
  incr: jest.fn(async (k: string) => {
    const next = (parseInt(redisStore[k] || "0", 10) || 0) + 1;
    redisStore[k] = String(next);
    return next;
  }),
  expire: jest.fn(async () => 1),
  call: jest.fn(async (...args: string[]) => {
    const cmd = (args[0] || "").toUpperCase();
    if (cmd === "SCRIPT" && (args[1] || "").toUpperCase() === "LOAD") {
      return fakeSha;
    }
    if (cmd === "EVALSHA") {
      // [totalHits, timeToExpire] — return small values so limiter allows.
      return [1, 60_000];
    }
    return null;
  }),
  ping: jest.fn().mockResolvedValue("PONG"),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
};

jest.mock("../../src/config/redis.js", () => ({
  redis: mockRedis,
}));

// Silence email/SMS side effects.
jest.mock("../../src/services/email.service.js", () => ({
  sendOtp: jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  sendWelcome: jest.fn().mockResolvedValue(undefined),
  sendInvitation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../src/services/sms.service.js", () => ({
  sendOtpSms: jest.fn().mockResolvedValue(undefined),
  sendReminderSms: jest.fn().mockResolvedValue(undefined),
}));

// Quiet logger noise.
jest.mock("../../src/config/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require("../../src/app.js").default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { config } = require("../../src/config/index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "jane@example.com",
    phone: "+254700000001",
    fullName: "Jane Doe",
    passwordHash: bcrypt.hashSync("Password123", 8),
    avatarUrl: null,
    location: null,
    isVerified: false,
    isActive: true,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    lastLoginAt: null,
    nationalId: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function signAccess(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: "access" },
    config.jwt.secret,
    { expiresIn: "5m" }
  );
}

function signRefresh(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: "refresh" },
    config.jwt.refreshSecret,
    { expiresIn: "7d" }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth routes (e2e)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(redisStore)) delete redisStore[k];
  });

  // -----------------------------------------------------------------------
  describe("POST /api/v1/auth/register", () => {
    it("creates a user and returns access + refresh tokens (201)", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const created = makeUser();
      mockPrisma.user.create.mockResolvedValue(created);
      mockPrisma.wallet.create.mockResolvedValue({ id: "w-1", userId: created.id });

      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "jane@example.com",
          phone: "+254700000001",
          fullName: "Jane Doe",
          password: "Password123",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe("jane@example.com");
      expect(typeof res.body.data.accessToken).toBe("string");
      expect(typeof res.body.data.refreshToken).toBe("string");
      // Sanity: the access token verifies against the configured secret.
      const decoded = jwt.verify(res.body.data.accessToken, config.jwt.secret) as {
        userId: string;
        type: string;
      };
      expect(decoded.userId).toBe(created.id);
      expect(decoded.type).toBe("access");
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.wallet.create).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for an invalid body (weak password / bad email)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: "not-an-email",
          phone: "123",
          fullName: "X",
          password: "weak",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  describe("POST /api/v1/auth/login", () => {
    it("returns tokens on correct credentials (200)", async () => {
      const user = makeUser({
        passwordHash: await bcrypt.hash("Password123", 8),
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "jane@example.com", password: "Password123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(user.id);
      expect(typeof res.body.data.accessToken).toBe("string");
      expect(typeof res.body.data.refreshToken).toBe("string");
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: user.id },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        })
      );
    });

    it("returns 401 on wrong password", async () => {
      const user = makeUser({
        passwordHash: await bcrypt.hash("CorrectHorseBattery1", 8),
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "jane@example.com", password: "WrongPassword1" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  describe("POST /api/v1/auth/refresh", () => {
    it("rotates tokens for a valid refresh token (200)", async () => {
      const user = makeUser();
      const refreshToken = signRefresh(user.id, user.email);

      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.accessToken).toBe("string");
      expect(typeof res.body.data.refreshToken).toBe("string");
      // rotateRefreshToken() has no jti/nonce, so if issued in the same
      // wall-clock second as the input the token can be byte-identical.
      // Verify structure instead of byte inequality.
      const decodedRefresh = jwt.verify(
        res.body.data.refreshToken,
        config.jwt.refreshSecret
      ) as { userId: string; type: string };
      expect(decodedRefresh.userId).toBe(user.id);
      expect(decodedRefresh.type).toBe("refresh");

      const decoded = jwt.verify(
        res.body.data.accessToken,
        config.jwt.secret
      ) as { userId: string; type: string };
      expect(decoded.userId).toBe(user.id);
      expect(decoded.type).toBe("access");
    });

    it("returns 401 for a bad/forged refresh token", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "definitely.not.a.valid.jwt" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -----------------------------------------------------------------------
  describe("POST /api/v1/auth/logout (protected)", () => {
    it("invalidates refresh tokens for the authenticated user (200)", async () => {
      const user = makeUser();
      const access = signAccess(user.id, user.email);

      const res = await request(app)
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${access}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ success: true });
      // The service calls invalidateRefreshTokens, which does redis.del on
      // the user's blocked-refresh key.
      expect(mockRedis.del).toHaveBeenCalledWith(
        `blocked:refresh:${user.id}`
      );
    });

    it("returns 401 without a bearer token", async () => {
      const res = await request(app).post("/api/v1/auth/logout").send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Protected "who am I" endpoint. `auth.routes.ts` does not expose /me
  // itself, but the users router does (GET /api/v1/users/me) and is
  // guarded by the same `authenticate` middleware, so it exercises the
  // same auth contract end-to-end.
  describe("GET /api/v1/users/me (protected)", () => {
    it("returns the authenticated user's profile with a valid bearer", async () => {
      const user = makeUser();
      const access = signAccess(user.id, user.email);

      mockPrisma.user.findUnique.mockResolvedValue({
        ...user,
        wallet: { id: "w-1", balance: "0", currency: "KES" },
        memberships: [],
      });
      // getProfile also calls prisma.loan.aggregate — add it lazily.
      (mockPrisma as unknown as { loan: unknown }).loan = {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      };

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${access}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(user.id);
      expect(res.body.data.user.email).toBe(user.email);
    });

    it("returns 401 with no bearer token", async () => {
      const res = await request(app).get("/api/v1/users/me");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 with a malformed/invalid bearer token", async () => {
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", "Bearer not.a.real.jwt");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
