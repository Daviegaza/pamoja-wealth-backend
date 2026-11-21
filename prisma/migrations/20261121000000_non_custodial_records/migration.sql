-- CreateEnum
CREATE TYPE "ContributionFrequency" AS ENUM ('weekly', 'monthly', 'one_off');

-- CreateEnum
CREATE TYPE "RecordMethod" AS ENUM ('mpesa', 'bank', 'cash', 'other');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('recorded', 'confirmed', 'disputed', 'voided');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'paystack';

-- AlterTable
ALTER TABLE "chamas" ADD COLUMN     "paymentInstructions" TEXT;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "agreedRepayable" DECIMAL(14,2),
ADD COLUMN     "issuedOn" DATE,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "recordedById" TEXT;

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "minutes" TEXT,
ADD COLUMN     "minutesAt" TIMESTAMPTZ,
ADD COLUMN     "minutesById" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "cadence" "BillingCadence",
ADD COLUMN     "planCode" "PlanCode",
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "contribution_schedules" (
    "id" TEXT NOT NULL,
    "chamaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "frequency" "ContributionFrequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "dueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contribution_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_records" (
    "id" TEXT NOT NULL,
    "chamaId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "RecordMethod" NOT NULL,
    "mpesaReceipt" TEXT,
    "note" TEXT,
    "scheduleId" TEXT,
    "goalId" TEXT,
    "status" "ContributionStatus" NOT NULL DEFAULT 'recorded',
    "disputeReason" TEXT,
    "voidReason" TEXT,
    "recordedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ,
    "disputedAt" TIMESTAMPTZ,
    "voidedAt" TIMESTAMPTZ,
    "voidedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contribution_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment_records" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "chamaId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "RecordMethod" NOT NULL,
    "mpesaReceipt" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contribution_schedules_chamaId_idx" ON "contribution_schedules"("chamaId");

-- CreateIndex
CREATE INDEX "contribution_records_chamaId_memberId_idx" ON "contribution_records"("chamaId", "memberId");

-- CreateIndex
CREATE INDEX "contribution_records_chamaId_paidOn_idx" ON "contribution_records"("chamaId", "paidOn");

-- CreateIndex
CREATE INDEX "contribution_records_chamaId_status_idx" ON "contribution_records"("chamaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_records_chamaId_mpesaReceipt_key" ON "contribution_records"("chamaId", "mpesaReceipt");

-- CreateIndex
CREATE INDEX "loan_repayment_records_loanId_idx" ON "loan_repayment_records"("loanId");

-- CreateIndex
CREATE INDEX "loan_repayment_records_chamaId_idx" ON "loan_repayment_records"("chamaId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_records_chamaId_mpesaReceipt_key" ON "loan_repayment_records"("chamaId", "mpesaReceipt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_reference_key" ON "invoices"("reference");

-- AddForeignKey
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "contribution_schedules_chamaId_fkey" FOREIGN KEY ("chamaId") REFERENCES "chamas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_schedules" ADD CONSTRAINT "contribution_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_records" ADD CONSTRAINT "contribution_records_chamaId_fkey" FOREIGN KEY ("chamaId") REFERENCES "chamas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_records" ADD CONSTRAINT "contribution_records_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_records" ADD CONSTRAINT "contribution_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_records" ADD CONSTRAINT "contribution_records_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "contribution_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_records" ADD CONSTRAINT "contribution_records_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_records" ADD CONSTRAINT "loan_repayment_records_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_records" ADD CONSTRAINT "loan_repayment_records_chamaId_fkey" FOREIGN KEY ("chamaId") REFERENCES "chamas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_records" ADD CONSTRAINT "loan_repayment_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

