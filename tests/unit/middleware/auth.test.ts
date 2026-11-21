import { describe, expect, it, jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { authenticate, optionalAuth } from "../../../src/middleware/auth.js";
import { generateAccessToken } from "../../../src/utils/jwt.js";

const res = {} as Response;
const reqWith = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as Request;
const nextFn = () => jest.fn() as unknown as NextFunction;

describe("authenticate", () => {
  it("rejects a missing header", () => {
    const next = nextFn();
    authenticate(reqWith(), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("rejects a token signed with another secret", () => {
    const next = nextFn();
    const forged = jwt.sign({ userId: "u", email: "e", type: "access" }, "attacker-secret-attacker-secret!!");
    authenticate(reqWith(`Bearer ${forged}`), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("rejects alg=none tokens", () => {
    const next = nextFn();
    const none = jwt.sign({ userId: "u", email: "e", type: "access" }, "", { algorithm: "none" });
    authenticate(reqWith(`Bearer ${none}`), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("accepts a valid access token", () => {
    const next = nextFn();
    const req = reqWith(`Bearer ${generateAccessToken({ userId: "u1", email: "a@b.c" })}`);
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user?.userId).toBe("u1");
  });
});

describe("optionalAuth", () => {
  it("continues without a token", () => {
    const next = nextFn();
    optionalAuth(reqWith(), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
