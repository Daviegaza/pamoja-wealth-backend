import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { hashPassword, comparePassword } from "../utils/crypto.js";
import {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  verifyRefreshToken,
  invalidateRefreshTokens,
} from "../utils/jwt.js";
import { generateOtp, verifyOtp, canResendOtp } from "./otp.service.js";
import { sendOtp, sendPasswordReset } from "./email.service.js";
import { sendOtpSms } from "./sms.service.js";
import { ApiError } from "../utils/api-error.js";
import { generateReference } from "../utils/reference.js";
import { authenticator } from "otplib";
import QRCode from "qrcode";

const LOGIN_ATTEMPTS_KEY = "login_attempts:";
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION = 1800; // 30 min

export async function register(data: {
  email: string;
  phone: string;
  fullName: string;
  password: string;
}) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: data.email }, { phone: data.phone }] },
  });
  if (existing) {
    const field = existing.email === data.email ? "email" : "phone";
    throw ApiError.conflict(`A user with this ${field} already exists`);
  }

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      phone: data.phone,
      fullName: data.fullName,
      passwordHash,
    },
  });

  await prisma.wallet.create({
    data: { userId: user.id, currency: "KES" },
  });

  const otp = await generateOtp(user.id);
  await sendOtp(user.email, otp);
  await sendOtpSms(user.phone, otp);

  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function login(email: string, password: string) {
  // Check lockout
  const attemptsKey = `${LOGIN_ATTEMPTS_KEY}${email.toLowerCase()}`;
  const attempts = parseInt((await redis.get(attemptsKey)) || "0", 10);
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    throw ApiError.rateLimited(
      "Account temporarily locked due to too many failed attempts. Try again in 30 minutes."
    );
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, LOCKOUT_DURATION);
    throw ApiError.unauthorized("Invalid email or password");
  }

  if (!user.isActive) {
    throw ApiError.forbidden("Account is deactivated");
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, LOCKOUT_DURATION);
    throw ApiError.unauthorized("Invalid email or password");
  }

  // Clear attempts on success
  await redis.del(attemptsKey);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function verifyOtpFlow(userId: string, code: string) {
  const valid = await verifyOtp(userId, code);
  if (!valid) {
    throw ApiError.validation("Invalid or expired OTP code");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isVerified: true },
  });

  return { verified: true };
}

export async function resendOtpFlow(userId: string) {
  const allowed = await canResendOtp(userId);
  if (!allowed) {
    throw ApiError.rateLimited("Please wait 30 seconds before requesting another OTP");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User");

  const otp = await generateOtp(userId);
  await sendOtp(user.email, otp);
  await sendOtpSms(user.phone, otp);

  return { message: "OTP resent" };
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    // Return success even if user not found (security best practice)
    return { message: "If the email exists, reset instructions have been sent" };
  }

  const token = generateReference("RST");
  await redis.set(`reset:${token}`, user.id, "EX", 3600); // 1 hour

  await sendPasswordReset(user.email, token);

  return { message: "If the email exists, reset instructions have been sent" };
}

export async function resetPassword(token: string, newPassword: string) {
  const userId = await redis.get(`reset:${token}`);
  if (!userId) {
    throw ApiError.validation("Invalid or expired reset token");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  await redis.del(`reset:${token}`);
  await invalidateRefreshTokens(userId);

  return { message: "Password reset successfully" };
}

export async function refresh(refreshToken: string) {
  const tokens = await rotateRefreshToken(refreshToken);
  if (!tokens) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }
  return tokens;
}

export async function logout(userId: string) {
  await invalidateRefreshTokens(userId);
  return { success: true };
}

export async function enable2fa(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User");

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("Invalid password");

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email, "Pamoja Wealth", secret);
  const qrCode = await QRCode.toDataURL(otpauth);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  });

  return { secret, qrCode };
}

export async function verify2fa(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) {
    throw ApiError.validation("2FA has not been set up");
  }

  const valid = authenticator.verify({ token: code, secret: user.twoFactorSecret });
  if (!valid) throw ApiError.validation("Invalid 2FA code");

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });

  return { enabled: true };
}

function sanitizeUser(user: {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  avatarUrl: string | null;
  location: string | null;
  isVerified: boolean;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  nationalId: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    location: user.location,
    isVerified: user.isVerified,
    isActive: user.isActive,
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() || null,
    nationalId: user.nationalId,
    createdAt: user.createdAt.toISOString(),
  };
}
