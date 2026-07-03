/**
 * KYC (Know Your Customer) Service
 *
 * Implements tiered KYC requirements for Pamoja Wealth users:
 *
 *   Tier 0: Phone number verified (on registration)
 *   Tier 1: National ID + name match (basic, required for contributions > KES 10K)
 *   Tier 2: Selfie liveness + ID photo match (required for contributions > KES 100K)
 *   Tier 3: Proof of address + enhanced due diligence (required for loans/credit)
 *
 * Compliance references:
 *   - CBK DCP Regulations 2025
 *   - Kenya DPA 2019
 *   - POCAMLA 2009 (AML/CFT)
 *   - SACCO Societies Act
 */

import { prisma } from "../config/database.js";
import { storage } from "../config/storage.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";
import { encrypt, decrypt } from "../utils/crypto.js";

// ── Types ────────────────────────────────────────────────────────────

export type KycTier = 0 | 1 | 2 | 3;

export interface KycStatus {
  userId: string;
  tier: KycTier;
  idVerified: boolean;
  selfieVerified: boolean;
  addressVerified: boolean;
  pepScreened: boolean;
  sanctionsScreened: boolean;
  maxContributionLimit: number;
  canApplyForLoan: boolean;
}

export interface KycUploadResult {
  documentType: "national_id" | "passport" | "selfie" | "proof_of_address";
  storageKey: string;
  verified: boolean;
  verificationNotes?: string;
}

// ── Tier Limits ──────────────────────────────────────────────────────

const KYC_TIER_LIMITS: Record<KycTier, {
  maxContributionPerTx: number;
  maxMonthlyContribution: number;
  canApplyForLoan: boolean;
  canWithdraw: boolean;
  canCreateChama: boolean;
}> = {
  0: {
    maxContributionPerTx: 10000, // KES
    maxMonthlyContribution: 50000,
    canApplyForLoan: false,
    canWithdraw: false,
    canCreateChama: true,
  },
  1: {
    maxContributionPerTx: 100000,
    maxMonthlyContribution: 500000,
    canApplyForLoan: false,
    canWithdraw: true,
    canCreateChama: true,
  },
  2: {
    maxContributionPerTx: 1000000,
    maxMonthlyContribution: 5000000,
    canApplyForLoan: true,
    canWithdraw: true,
    canCreateChama: true,
  },
  3: {
    maxContributionPerTx: Infinity,
    maxMonthlyContribution: Infinity,
    canApplyForLoan: true,
    canWithdraw: true,
    canCreateChama: true,
  },
};

// ── KYC Status ───────────────────────────────────────────────────────

/**
 * Get current KYC status for a user.
 */
export async function getKycStatus(userId: string): Promise<KycStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      kycLevel: true,
      idVerified: true,
      selfieVerified: true,
      addressVerified: true,
      pepScreened: true,
      sanctionsScreened: true,
    },
  });

  if (!user) throw ApiError.notFound("User not found");

  const tier = (user.kycLevel || 0) as KycTier;
  const limits = KYC_TIER_LIMITS[tier];

  return {
    userId: user.id,
    tier,
    idVerified: user.idVerified,
    selfieVerified: user.selfieVerified,
    addressVerified: user.addressVerified,
    pepScreened: user.pepScreened,
    sanctionsScreened: user.sanctionsScreened,
    maxContributionLimit: limits.maxContributionPerTx,
    canApplyForLoan: limits.canApplyForLoan,
  };
}

/**
 * Check if a user can make a contribution of the given amount.
 */
export async function canContribute(
  userId: string,
  amountKes: number,
): Promise<{ allowed: boolean; reason?: string; requiredTier?: KycTier }> {
  const status = await getKycStatus(userId);
  const limits = KYC_TIER_LIMITS[status.tier];

  if (amountKes > limits.maxContributionPerTx) {
    const nextTier = (status.tier + 1) as KycTier;
    return {
      allowed: false,
      reason: `Amount exceeds Tier ${status.tier} limit of KES ${limits.maxContributionPerTx.toLocaleString()}. Upgrade to Tier ${nextTier} required.`,
      requiredTier: nextTier,
    };
  }

  // Check monthly aggregate
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyTotal = await prisma.transaction.aggregate({
    where: {
      userId,
      type: "contribution",
      status: "completed",
      createdAt: { gte: monthStart },
    },
    _sum: { amount: true },
  });

  const monthAmount = Number(monthlyTotal._sum.amount || 0) + amountKes;
  if (monthAmount > limits.maxMonthlyContribution) {
    const nextTier = (status.tier + 1) as KycTier;
    return {
      allowed: false,
      reason: `Monthly total would exceed Tier ${status.tier} limit. Upgrade to Tier ${nextTier} required.`,
      requiredTier: nextTier,
    };
  }

  return { allowed: true };
}

// ── KYC Upload & Verification ────────────────────────────────────────

/**
 * Upload KYC document (ID, selfie, or proof of address).
 */
export async function uploadKycDocument(
  userId: string,
  file: Buffer,
  fileName: string,
  documentType: "national_id" | "passport" | "selfie" | "proof_of_address",
  mimeType: string,
): Promise<KycUploadResult> {
  // Validate file size (max 10MB)
  if (file.length > 10 * 1024 * 1024) {
    throw ApiError.badRequest("File too large. Maximum 10MB.");
  }

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/heic", "application/pdf"];
  if (!allowedTypes.includes(mimeType)) {
    throw ApiError.badRequest("Invalid file type. Accepted: JPEG, PNG, HEIC, PDF.");
  }

  // Encrypt document before storage
  const encrypted = encrypt(file.toString("base64"));
  const storageKey = `kyc/${userId}/${documentType}/${Date.now()}-${fileName}`;

  // Upload to S3/MinIO
  await storage.upload(storageKey, Buffer.from(encrypted, "utf-8"), mimeType);

  // Record in database
  const record = await prisma.kycDocument.create({
    data: {
      userId,
      documentType,
      storageKey,
      fileName,
      mimeType,
      fileSizeBytes: file.length,
      status: "pending_verification",
    },
  });

  logger.info({ userId, documentType, storageKey }, "KYC document uploaded");

  // Auto-flag for manual verification
  await prisma.kycVerificationQueue.create({
    data: {
      documentId: record.id,
      userId,
      documentType,
      priority: documentType === "national_id" ? "high" : "normal",
    },
  });

  return {
    documentType,
    storageKey,
    verified: false,
    verificationNotes: "Document uploaded. Pending manual verification.",
  };
}

/**
 * Manually verify a KYC document (admin action).
 */
export async function verifyKycDocument(
  documentId: string,
  adminId: string,
  decision: "approved" | "rejected",
  notes?: string,
): Promise<void> {
  const doc = await prisma.kycDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw ApiError.notFound("KYC document not found");

  await prisma.kycDocument.update({
    where: { id: documentId },
    data: {
      status: decision === "approved" ? "verified" : "rejected",
      verifiedAt: decision === "approved" ? new Date() : null,
      verifiedBy: adminId,
      verificationNotes: notes || null,
    },
  });

  // Update user's verification flags
  if (decision === "approved") {
    const updateData: any = {};
    if (doc.documentType === "national_id" || doc.documentType === "passport") {
      updateData.idVerified = true;
    }
    if (doc.documentType === "selfie") {
      updateData.selfieVerified = true;
    }
    if (doc.documentType === "proof_of_address") {
      updateData.addressVerified = true;
    }

    await prisma.user.update({
      where: { id: doc.userId },
      data: updateData,
    });

    // Auto-upgrade KYC tier
    await recalculateKycTier(doc.userId);
  }

  // Remove from queue
  await prisma.kycVerificationQueue.deleteMany({
    where: { documentId },
  });

  logger.info(
    { documentId, userId: doc.userId, decision, adminId },
    "KYC document verified",
  );
}

/**
 * Recalculate user's KYC tier based on verified documents.
 */
export async function recalculateKycTier(userId: string): Promise<KycTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { idVerified: true, selfieVerified: true, addressVerified: true },
  });

  if (!user) throw ApiError.notFound("User not found");

  let newTier: KycTier = 0;

  if (user.idVerified) {
    newTier = 1;
  }
  if (user.idVerified && user.selfieVerified) {
    newTier = 2;
  }
  if (user.idVerified && user.selfieVerified && user.addressVerified) {
    newTier = 3;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { kycLevel: newTier },
  });

  logger.info({ userId, newTier, previousTier: user.kycLevel }, "KYC tier recalculated");

  return newTier;
}

// ── PEP & Sanctions Screening ────────────────────────────────────────

/**
 * Screen a user against PEP and sanctions lists.
 * Stub implementation — integrate with WorldCheck, LexisNexis, or similar.
 */
export async function screenUser(
  userId: string,
): Promise<{ pepMatch: boolean; sanctionsMatch: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, nationalId: true, dateOfBirth: true },
  });

  if (!user) throw ApiError.notFound("User not found");

  // TODO: Integrate with real screening API
  // For now, assume clean
  const pepMatch = false;
  const sanctionsMatch = false;

  await prisma.user.update({
    where: { id: userId },
    data: { pepScreened: true, sanctionsScreened: true },
  });

  return { pepMatch, sanctionsMatch };
}

// ── Data Privacy (Kenya DPA 2019) ─────────────────────────────────────

/**
 * Export all user data (right of access / data portability).
 */
export async function exportUserData(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: true,
      wallet: true,
      transactions: { take: 1000, orderBy: { createdAt: "desc" } },
      notifications: { take: 500 },
      kycDocuments: { select: { id: true, documentType: true, status: true, createdAt: true } },
    },
  });

  if (!user) throw ApiError.notFound("User not found");

  // Remove sensitive fields
  const { passwordHash, refreshTokenHash, ...safeUser } = user as any;
  delete safeUser.passwordHash;
  delete safeUser.refreshTokenHash;

  return {
    exportedAt: new Date().toISOString(),
    user: safeUser,
    requestType: "GDPR/DPA Data Portability Request",
  };
}

/**
 * Delete all user data (right to erasure).
 */
export async function eraseUserData(userId: string): Promise<void> {
  logger.warn({ userId }, "User data erasure requested");

  // Anonymize user record (preserve for audit trail)
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: `erased-${userId}@deleted.pamojawealth.app`,
      phone: null,
      firstName: "[Deleted]",
      lastName: "[Deleted]",
      nationalId: null,
      dateOfBirth: null,
      passwordHash: "erased",
      refreshTokenHash: null,
      isActive: false,
      deletedAt: new Date(),
    },
  });

  // Delete KYC documents from storage
  const kycDocs = await prisma.kycDocument.findMany({
    where: { userId },
  });

  for (const doc of kycDocs) {
    try {
      await storage.delete(doc.storageKey);
    } catch (e) {
      logger.error({ storageKey: doc.storageKey, error: e }, "Failed to delete KYC document");
    }
  }

  await prisma.kycDocument.deleteMany({ where: { userId } });

  logger.info({ userId }, "User data erased (anonymized)");
}
