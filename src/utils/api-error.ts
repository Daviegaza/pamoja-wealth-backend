import { ErrorCode } from "./error-codes.js";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }

  static notFound(entity: string, id?: string): ApiError {
    const msg = id ? `${entity} with id '${id}' not found` : `${entity} not found`;
    return new ApiError(ErrorCode.NOT_FOUND, msg, 404);
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError(ErrorCode.UNAUTHORIZED, message, 401);
  }

  static forbidden(message = "Insufficient permissions"): ApiError {
    return new ApiError(ErrorCode.FORBIDDEN, message, 403);
  }

  static conflict(message: string): ApiError {
    return new ApiError(ErrorCode.CONFLICT, message, 409);
  }

  static validation(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(ErrorCode.VALIDATION_ERROR, message, 400, details);
  }

  static insufficientFunds(balance: number, requested: number): ApiError {
    return new ApiError(
      ErrorCode.INSUFFICIENT_FUNDS,
      `Your balance of ${balance.toLocaleString()} is insufficient for this ${requested.toLocaleString()} withdrawal.`,
      422,
      { balance, requested }
    );
  }

  static rateLimited(message = "Too many requests"): ApiError {
    return new ApiError(ErrorCode.RATE_LIMITED, message, 429);
  }

  // Used by the rule engine to surface enforcement violations: the request
  // was syntactically valid but the chama's rule doc forbids it. The
  // `violations` array goes into `details.violations` so clients can render
  // each `{ code, message, hint }` to the user.
  static unprocessable(
    violations: { code: string; message: string; hint?: string }[],
    message = "Operation violates chama rules"
  ): ApiError {
    return new ApiError("RULE_VIOLATION", message, 422, { violations });
  }

  static internal(message = "Internal server error"): ApiError {
    return new ApiError(ErrorCode.INTERNAL_ERROR, message, 500);
  }
}
