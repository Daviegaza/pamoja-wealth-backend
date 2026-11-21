import { describe, expect, it, jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { flutterwaveGuard, paystackGuard } from "../../../src/middleware/webhook-guard.js";
import { config } from "../../../src/config/index.js";

function mockRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & { status: jest.Mock };
}
const nextFn = () => jest.fn() as unknown as NextFunction;
const body = Buffer.from('{"event":"charge.success"}');

describe("flutterwaveGuard", () => {
  it("rejects a missing verif-hash", () => {
    const res = mockRes();
    const next = nextFn();
    flutterwaveGuard({ headers: {}, body } as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts the configured secret", () => {
    const next = nextFn();
    flutterwaveGuard({ headers: { "verif-hash": "flw-webhook-secret" }, body } as unknown as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("fails CLOSED when no secret is configured, in every environment", () => {
    const original = config.flutterwave.webhookSecret;
    config.flutterwave.webhookSecret = "";
    try {
      const res = mockRes();
      const next = nextFn();
      flutterwaveGuard({ headers: { "verif-hash": "" }, body } as unknown as Request, res, next);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    } finally {
      config.flutterwave.webhookSecret = original;
    }
  });

  it("requires the raw body", () => {
    const res = mockRes();
    flutterwaveGuard({ headers: { "verif-hash": "flw-webhook-secret" }, body: { parsed: true } } as unknown as Request, res, nextFn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("paystackGuard", () => {
  it("accepts a valid HMAC-SHA512 signature over the raw body", () => {
    const sig = crypto.createHmac("sha512", "sk_test_dummy").update(body).digest("hex");
    const next = nextFn();
    paystackGuard({ headers: { "x-paystack-signature": sig }, body } as unknown as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects a signature over a different body", () => {
    const sig = crypto.createHmac("sha512", "sk_test_dummy").update("tampered").digest("hex");
    const res = mockRes();
    paystackGuard({ headers: { "x-paystack-signature": sig }, body } as unknown as Request, res, nextFn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
