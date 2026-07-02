// Wallet routes end-to-end integration tests.
//
// These tests mount the real Express app (src/app.ts) via supertest and drive
// requests through the actual middleware chain (auth, validate, error-handler).
// External I/O is fully mocked:
//   - `src/config/database.js` (Prisma) — controlled per test
//   - `src/services/mpesa.service.js` — no outbound HTTP to Safaricom
//   - `src/services/stk-callback.service.js` — webhook fanout stub
//   - `src/services/ledger.service.js` — via the stk-callback mock
//   - `src/lib/rule-enforcer.js` — no chama rule friction on deposits
//   - `src/websocket/index.js` — no live socket needed
//
// The `@prisma/client` mock in tests/setup.ts is bypassed because the real
// code path imports PrismaClient from `../generated/prisma/client.js` (not
// `@prisma/client`), so we mock the singleton at `src/config/database.js`.

import request from "supertest";
import jwt from "jsonwebtoken";
import { config } from "../../src/config/index.js";

// ── Prisma singleton mock ────────────────────────────────────────────────
const mockPrisma = {
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  bankAccount: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  mpesaAccount: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};
mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
  if (typeof arg === "function") return (arg as (p: unknown) => unknown)(mockPrisma);
  return arg;
});

jest.mock("../../src/config/database.js", () => ({ prisma: mockPrisma }));

// Silence logger noise during tests.
jest.mock("../../src/config/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Extend the base redis mock (from tests/setup.ts) with the `.call` method
// used by rate-limit-redis. Without this, the auth rate limiter Lua script
// load throws asynchronously during app boot and flakes tests.
jest.mock("../../src/config/redis.js", () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue("PONG"),
    call: jest.fn().mockResolvedValue("OK"),
    sendCommand: jest.fn().mockResolvedValue("OK"),
  },
}));

// M-Pesa service: no outbound HTTP.
jest.mock("../../src/services/mpesa.service.js", () => ({
  stkPush: jest.fn().mockResolvedValue({
    checkoutRequestId: "ws_CO_mock_123",
    merchantRequestId: "mock_merchant_123",
  }),
  b2cPayment: jest.fn().mockResolvedValue({ conversationId: "mock_b2c_123" }),
  initiate: jest.fn().mockResolvedValue({
    checkoutRequestId: "ws_CO_mock_123",
    merchantRequestId: "mock_merchant_123",
  }),
  transactionStatus: jest.fn().mockResolvedValue({ status: "pending" }),
  queryStkStatus: jest.fn().mockResolvedValue({ resultCode: 1037, resultDesc: "pending" }),
  handleCallback: jest.fn().mockResolvedValue({ matched: false }),
  stkPushCallback: jest.fn().mockResolvedValue({ success: false }),
  getMeta: (items: Array<{ Name?: string; Value?: unknown }>, name: string) =>
    Array.isArray(items) ? items.find((i) => i?.Name === name)?.Value : undefined,
}));

// STK callback processor — the wallet controller calls it directly for the
// webhook. Return "not matched" so the controller falls through to the legacy
// processor (which uses our mocked prisma).
jest.mock("../../src/services/stk-callback.service.js", () => ({
  processStkCallback: jest.fn().mockResolvedValue({ matched: false, reason: "test-stub" }),
}));

// Rule enforcer — no-op so deposits with chamaId don't need real rule engine.
jest.mock("../../src/lib/rule-enforcer.js", () => ({
  enforceRule: jest.fn().mockResolvedValue(undefined),
}));

// Websocket emitters — stubs, we don't need a real socket server here.
jest.mock("../../src/websocket/index.js", () => ({
  initWebSocket: jest.fn(),
  emitToUser: jest.fn(),
  emitToChama: jest.fn(),
}));

// ── App import (AFTER mocks) ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require("../../src/app.js").default;

// ── Helpers ──────────────────────────────────────────────────────────────
const TEST_USER = { userId: "user-123", email: "user@test.dev" };

function signAccessToken(overrides: Partial<typeof TEST_USER> = {}): string {
  const payload = { ...TEST_USER, ...overrides, type: "access" as const };
  return jwt.sign(payload, config.jwt.secret, { expiresIn: "5m" });
}

function authHeader(token = signAccessToken()) {
  return { Authorization: `Bearer ${token}` };
}

// ── Tests ────────────────────────────────────────────────────────────────
describe("Wallet routes e2e (/api/v1/wallet)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-install $transaction default because clearAllMocks clears
    // implementations too.
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (p: unknown) => unknown)(mockPrisma);
      return arg;
    });
  });

  // ── GET /api/v1/wallet ─────────────────────────────────────────────
  describe("GET /api/v1/wallet", () => {
    it("returns 401 when no bearer token is provided", async () => {
      const res = await request(app).get("/api/v1/wallet");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe("UNAUTHORIZED");
    });

    it("returns the wallet for the authenticated user (happy path)", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: "w-1",
        userId: TEST_USER.userId,
        balance: 5000,
        currency: "KES",
        pendingBalance: 0,
        totalDeposits: 5000,
        totalWithdrawals: 0,
        lastTransactionAt: new Date("2024-01-01T00:00:00.000Z"),
      });

      const res = await request(app).get("/api/v1/wallet").set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: "w-1",
        userId: TEST_USER.userId,
        balance: 5000,
        currency: "KES",
      });
      expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId: TEST_USER.userId },
      });
    });

    it("auto-creates a wallet when the user has none yet", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        id: "w-new",
        userId: TEST_USER.userId,
        balance: 0,
        currency: "KES",
        pendingBalance: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
        lastTransactionAt: null,
      });

      const res = await request(app).get("/api/v1/wallet").set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(0);
      expect(mockPrisma.wallet.create).toHaveBeenCalled();
    });
  });

  // ── POST /api/v1/wallet/deposit ───────────────────────────────────
  describe("POST /api/v1/wallet/deposit", () => {
    it("initiates a pending deposit (happy path, mpesa)", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: "w-1",
        userId: TEST_USER.userId,
        balance: 1000,
        currency: "KES",
        pendingBalance: 0,
        totalDeposits: 1000,
        totalWithdrawals: 0,
        lastTransactionAt: null,
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-1",
        userId: TEST_USER.userId,
        chamaId: null,
        type: "contribution",
        amount: 500,
        balanceAfter: 1000,
        method: "mpesa",
        reference: "DPS123456",
        description: "Deposit via mpesa",
        status: "pending",
      });

      const res = await request(app)
        .post("/api/v1/wallet/deposit")
        .set(authHeader())
        .send({ amount: 500, method: "mpesa", destination: "254712345678" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transaction).toMatchObject({
        id: "tx-1",
        status: "pending",
        method: "mpesa",
      });
      expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mpesa = require("../../src/services/mpesa.service.js");
      expect(mpesa.stkPush).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when amount is missing / invalid (validation failure)", async () => {
      const res = await request(app)
        .post("/api/v1/wallet/deposit")
        .set(authHeader())
        .send({ method: "mpesa" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("returns 401 without a token", async () => {
      const res = await request(app)
        .post("/api/v1/wallet/deposit")
        .send({ amount: 100, method: "mpesa" });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/v1/wallet/withdraw ──────────────────────────────────
  describe("POST /api/v1/wallet/withdraw", () => {
    it("initiates a pending withdrawal (happy path, mpesa)", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: "w-1",
        userId: TEST_USER.userId,
        balance: 10_000,
        currency: "KES",
        pendingBalance: 0,
        totalDeposits: 10_000,
        totalWithdrawals: 0,
        lastTransactionAt: null,
      });
      mockPrisma.transaction.create.mockResolvedValue({
        id: "tx-w-1",
        userId: TEST_USER.userId,
        chamaId: null,
        type: "withdrawal",
        amount: -2000,
        balanceAfter: 10_000,
        method: "mpesa",
        reference: "WTH123456",
        description: "Withdrawal via mpesa to 254712345678",
        status: "pending",
      });

      const res = await request(app)
        .post("/api/v1/wallet/withdraw")
        .set(authHeader())
        .send({ amount: 2000, method: "mpesa", destination: "254712345678" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transaction).toMatchObject({
        id: "tx-w-1",
        status: "pending",
        method: "mpesa",
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mpesa = require("../../src/services/mpesa.service.js");
      expect(mpesa.b2cPayment).toHaveBeenCalledTimes(1);
    });

    it("returns 422 INSUFFICIENT_FUNDS when balance is too low", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: "w-1",
        userId: TEST_USER.userId,
        balance: 100,
        currency: "KES",
        pendingBalance: 0,
        totalDeposits: 100,
        totalWithdrawals: 0,
        lastTransactionAt: null,
      });

      const res = await request(app)
        .post("/api/v1/wallet/withdraw")
        .set(authHeader())
        .send({ amount: 5000, method: "mpesa", destination: "254712345678" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe("INSUFFICIENT_FUNDS");
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });

    it("returns 400 when destination is missing (validation failure)", async () => {
      const res = await request(app)
        .post("/api/v1/wallet/withdraw")
        .set(authHeader())
        .send({ amount: 100, method: "mpesa" });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });
  });

  // ── GET /api/v1/wallet/transactions ───────────────────────────────
  describe("GET /api/v1/wallet/transactions", () => {
    it("lists the user's transactions with pagination meta (happy path)", async () => {
      const now = new Date("2024-06-01T12:00:00.000Z");
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          userId: TEST_USER.userId,
          chamaId: null,
          type: "contribution",
          amount: 500,
          balanceAfter: 500,
          method: "mpesa",
          reference: "DPS111111",
          description: "Deposit via mpesa",
          status: "completed",
          createdAt: now,
        },
        {
          id: "tx-2",
          userId: TEST_USER.userId,
          chamaId: null,
          type: "withdrawal",
          amount: -100,
          balanceAfter: 400,
          method: "mpesa",
          reference: "WTH222222",
          description: "Withdrawal via mpesa to 254712345678",
          status: "completed",
          createdAt: now,
        },
      ]);
      mockPrisma.transaction.count.mockResolvedValue(2);

      const res = await request(app)
        .get("/api/v1/wallet/transactions?page=1&pageSize=20")
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({ id: "tx-1", status: "completed" });
      expect(res.body.meta).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/wallet/transactions");
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/v1/wallet/history ────────────────────────────────────
  describe("GET /api/v1/wallet/history", () => {
    it("returns daily balance history (happy path)", async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          userId: TEST_USER.userId,
          amount: 500,
          balanceAfter: 500,
          status: "completed",
          createdAt: new Date("2024-05-01T09:00:00.000Z"),
        },
      ]);

      const res = await request(app)
        .get("/api/v1/wallet/history?days=30")
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.history).toEqual([
        { date: "2024-05-01", balance: 500 },
      ]);
    });
  });

  // ── POST /api/v1/wallet/deposit/mpesa-callback (public webhook) ───
  describe("POST /api/v1/wallet/deposit/mpesa-callback", () => {
    it("always responds 200 with { ResultCode: 0 } — no auth required (smoke)", async () => {
      const payload = {
        Body: {
          stkCallback: {
            MerchantRequestID: "m-1",
            CheckoutRequestID: "ws_CO_mock_123",
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: 500 },
                { Name: "MpesaReceiptNumber", Value: "TEST123RCPT" },
                { Name: "PhoneNumber", Value: 254712345678 },
              ],
            },
          },
        },
      };

      // The legacy fallback processor uses these prisma calls if reached.
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/wallet/deposit/mpesa-callback")
        .set("Content-Type", "application/json")
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ResultCode: 0, ResultDesc: "Success" });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const stk = require("../../src/services/stk-callback.service.js");
      expect(stk.processStkCallback).toHaveBeenCalledTimes(1);
    });

    it("still returns 200 { ResultCode: 0 } when payload is malformed (Daraja contract)", async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/wallet/deposit/mpesa-callback")
        .set("Content-Type", "application/json")
        .send({ garbage: true });

      expect(res.status).toBe(200);
      expect(res.body.ResultCode).toBe(0);
    });
  });
});

// NOTE: Skipped scenarios and why:
//   - Signed Safaricom webhooks under /api/v1/webhooks/* are NOT covered here
//     — they require the real HMAC signing secret which is not available in
//     this test environment. The /wallet/deposit/mpesa-callback route is
//     Safaricom's Daraja STK callback, which is unsigned (relies on IP allow-
//     listing in prod), so it IS covered above as a smoke test.
//   - Bank / M-Pesa account CRUD (POST/GET/DELETE /bank-accounts,
//     /mpesa-accounts) are out of the "wallet routes core flow" scope for
//     this suite; the wallet, deposit, withdraw, transactions, history, and
//     callback paths are all exercised.
