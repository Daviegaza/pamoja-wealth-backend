import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function loadGuard() {
  const mod = await import("../../../src/middleware/webhook-guard.js");
  return mod;
}

function mockRes(): Response {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as unknown as Response["status"],
    json: jest.fn().mockReturnThis() as unknown as Response["json"],
  };
  return res as Response;
}

describe("darajaGuard", () => {
  it("passes through in non-production", async () => {
    process.env.NODE_ENV = "development";
    const { darajaGuard } = await loadGuard();
    const next = jest.fn() as NextFunction;
    darajaGuard({ headers: {}, params: {}, query: {}, socket: { remoteAddress: "1.2.3.4" } } as unknown as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects requests with invalid secret", async () => {
    process.env.NODE_ENV = "production";
    process.env.MPESA_WEBHOOK_SECRET = "topsecret";
    process.env.DARAJA_ALLOWED_IPS = "196.201.214.200";
    const { darajaGuard } = await loadGuard();
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    darajaGuard(
      { headers: {}, params: { secret: "wrong" }, query: {}, socket: { remoteAddress: "196.201.214.200" }, path: "/x" } as unknown as Request,
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("flutterwaveGuard", () => {
  it("rejects when verif-hash header missing", async () => {
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = "flw-secret";
    const { flutterwaveGuard } = await loadGuard();
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    flutterwaveGuard({ headers: {} } as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
  it("passes with correct verif-hash", async () => {
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = "flw-secret";
    const { flutterwaveGuard } = await loadGuard();
    const next = jest.fn() as NextFunction;
    flutterwaveGuard({ headers: { "verif-hash": "flw-secret" } } as unknown as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe("stripeGuard", () => {
  it("verifies stripe signature", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const { stripeGuard } = await loadGuard();
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const timestamp = "1700000000";
    const sig = crypto.createHmac("sha256", "whsec_test").update(`${timestamp}.${body.toString("utf8")}`).digest("hex");
    const next = jest.fn() as NextFunction;
    stripeGuard(
      { headers: { "stripe-signature": `t=${timestamp},v1=${sig}` }, body } as unknown as Request,
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
