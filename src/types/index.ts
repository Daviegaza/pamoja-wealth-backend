
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
  role?: string;
  type: "access" | "refresh";
}

// Permission system
export type Permission =
  | "view_dashboard"
  | "manage_members"
  | "manage_treasury"
  | "approve_loans"
  | "create_meetings"
  | "manage_votes"
  | "manage_settings"
  | "view_analytics"
  | "manage_billing";

export type Role = "owner" | "admin" | "chairperson" | "treasurer" | "secretary" | "member";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "view_dashboard", "manage_members", "manage_treasury",
    "approve_loans", "create_meetings", "manage_votes",
    "manage_settings", "view_analytics", "manage_billing",
  ],
  admin: [
    "view_dashboard", "manage_members", "manage_treasury",
    "approve_loans", "create_meetings", "manage_votes",
    "manage_settings", "view_analytics", "manage_billing",
  ],
  chairperson: [
    "view_dashboard", "manage_members", "approve_loans",
    "create_meetings", "manage_votes", "view_analytics",
  ],
  treasurer: [
    "view_dashboard", "manage_treasury", "view_analytics",
  ],
  secretary: [
    "view_dashboard", "create_meetings", "manage_votes",
  ],
  member: [
    "view_dashboard",
  ],
};
