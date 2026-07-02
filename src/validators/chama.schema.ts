import { z } from "zod";

export const createChamaSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(["savings", "investment", "welfare", "mixed"]),
  type: z.enum(["chama", "fundraiser"]).default("chama"),
  privacy: z.enum(["public", "private", "invite_only"]).default("private"),
  monthlyContribution: z.number().min(0).default(0),
  location: z.string().max(255).optional(),
  tags: z.array(z.string()).optional(),
  coverImageUrl: z.string().url().optional(),
  targetAmount: z.number().min(0).optional(),
  deadline: z.string().datetime().optional(),
  requireKyc: z.boolean().optional(),
  maxMembers: z.number().int().positive().optional(),
});

export const updateChamaSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).optional(),
  privacy: z.enum(["public", "private", "invite_only"]).optional(),
  monthlyContribution: z.number().min(0).optional(),
  location: z.string().max(255).optional(),
  status: z.enum(["active", "dormant", "archived"]).optional(),
  coverImageUrl: z.string().url().optional(),
  targetAmount: z.number().min(0).optional(),
  deadline: z.string().datetime().optional(),
  requireKyc: z.boolean().optional(),
  maxMembers: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  paybillAccountNumber: z.string().min(1).max(64).optional(),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "chairperson", "secretary", "treasurer", "member"]),
  customTitle: z.string().min(1).max(64).optional().nullable(),
});

export const joinChamaSchema = z.object({
  inviteCode: z.string().min(1).optional(),
  invitationToken: z.string().optional(),
  message: z.string().max(500).optional(),
});

export const inviteMemberSchema = z.object({
  method: z.enum(["phone", "email", "username", "link", "qr"]),
  phone: z.string().min(7).optional(),
  email: z.string().email().optional(),
  username: z.string().min(2).optional(),
  message: z.string().max(500).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(14),
}).refine(
  (v) => (v.method === "link" || v.method === "qr") || !!(v.phone || v.email || v.username),
  { message: "phone, email, or username required for direct invites" }
);

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export const discoverChamaQuerySchema = z.object({
  search: z.string().optional(),
  category: z.enum(["savings", "investment", "welfare", "mixed"]).optional(),
  type: z.enum(["chama", "fundraiser"]).optional(),
  location: z.string().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export const decideJoinRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
});

export const donationSchema = z.object({
  amount: z.number().positive(),
  message: z.string().max(500).optional(),
  isAnonymous: z.boolean().default(false),
  donorName: z.string().optional(),
  donorEmail: z.string().email().optional(),
  donorPhone: z.string().optional(),
  paymentMethod: z.enum(["mpesa", "bank", "card", "cash"]).default("mpesa"),
});

export const chamaQuerySchema = z.object({
  search: z.string().optional(),
  category: z.enum(["savings", "investment", "welfare", "mixed"]).optional(),
  status: z.enum(["active", "dormant", "archived"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export const memberQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(["owner", "admin", "chairperson", "treasurer", "secretary", "member"]).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export const analyticsQuerySchema = z.object({
  period: z.enum(["daily", "monthly", "yearly"]).default("monthly"),
  from: z.string().optional(),
  to: z.string().optional(),
});

// Zero-friction contribute — body has ONLY amount. Routing tokens
// (paybill, account ref) never appear in the request.
export const contributeSchema = z.object({
  amount: z.number().min(1).max(250_000),
});

// Zero-friction harambee donation. If the caller is authed, only `amount`
// is required (phone is resolved from their MpesaAccount). If anonymous,
// `phone` must be supplied so the STK Push has a target.
export const donateNowSchema = z.object({
  amount: z.number().min(1).max(250_000),
  phone: z.string().min(7).max(20).optional(),
  name: z.string().max(120).optional(),
  message: z.string().max(500).optional(),
  isAnonymous: z.boolean().optional(),
});
