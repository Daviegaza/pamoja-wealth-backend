import { authenticate, optionalAuth } from "../../../src/middleware/auth.js";
import { Request, Response, NextFunction } from "express";

jest.mock("../../../src/utils/jwt.js", () => ({
  verifyAccessToken: jest.fn(),
}));

describe("Auth Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {} };
    res = {};
    next = jest.fn();
  });

  describe("authenticate", () => {
    it("returns 401 when no auth header is present", () => {
      authenticate(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });

    it("returns 401 when auth header is malformed", () => {
      req.headers = { authorization: "InvalidFormat" };
      authenticate(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 })
      );
    });
  });

  describe("optionalAuth", () => {
    it("calls next without error when no token is present", () => {
      optionalAuth(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
