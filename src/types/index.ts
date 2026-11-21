
// API Response types
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiErrorResponse;

// JWT
export interface JwtPayload {
  userId: string;
  email: string;
  type: "access" | "refresh";
  jti?: string;
}

/**
 * Chama roles. "owner"/"admin" are legacy values still present in the DB enum;
 * they are treated exactly like "chairperson".
 */
export type Role = "owner" | "admin" | "chairperson" | "treasurer" | "secretary" | "member";

export const CHAIR_ROLES: readonly Role[] = ["owner", "admin", "chairperson"];
/** Officers who may record money movements (contributions, loans, repayments). */
export const MONEY_ROLES: readonly Role[] = [...CHAIR_ROLES, "treasurer"];
/** Officers who manage meetings/minutes and invitations. */
export const SECRETARY_ROLES: readonly Role[] = [...CHAIR_ROLES, "secretary"];
/** All officers (can see every member's records). */
export const OFFICER_ROLES: readonly Role[] = [...CHAIR_ROLES, "treasurer", "secretary"];

export function isOfficer(role: string): boolean {
  return (OFFICER_ROLES as readonly string[]).includes(role);
}
