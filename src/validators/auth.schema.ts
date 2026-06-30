import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number too short").max(20),
  fullName: z.string().min(2, "Name must be at least 2 characters").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const verifyOtpSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  code: z.string().length(6, "OTP must be 6 digits"),
});

export const resendOtpSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const enable2faSchema = z.object({
  password: z.string().min(1, "Password is required to enable 2FA"),
});

export const verify2faSchema = z.object({
  code: z.string().length(6, "2FA code must be 6 digits"),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  phone: z.string().min(10).max(20).optional(),
  location: z.string().max(255).optional(),
  avatarUrl: z.string().url().optional(),
  nationalId: z.string().max(50).optional(),
});
