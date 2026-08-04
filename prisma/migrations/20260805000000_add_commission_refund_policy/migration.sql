-- ─────────────────────────────────────────────────────────────
-- سياسة العمولة / الإلغاء / غرامة التأخير (2026-08-05)
-- 1) أنواع حركات محفظة جديدة: COMMISSION_REFUND (استرداد العمولة المؤجل)
--    + LATE_FEE (خصم غرامة تأخير من الراكب) + LATE_FEE_CREDIT (إضافة للكابتن)
-- 2) حقول جديدة على RideRequest لتتبع القبول/الوصول/الاسترداد/الغرامة
-- ─────────────────────────────────────────────────────────────

-- CreateEnum (إضافة قيم جديدة لنوع حركة المحفظة)
ALTER TYPE "public"."WalletTransactionType" ADD VALUE 'COMMISSION_REFUND';
ALTER TYPE "public"."WalletTransactionType" ADD VALUE 'LATE_FEE';
ALTER TYPE "public"."WalletTransactionType" ADD VALUE 'LATE_FEE_CREDIT';

-- AlterTable: حقول RideRequest الجديدة
ALTER TABLE "public"."RideRequest" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "commissionDeductedAtAccept" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingCommissionRefundAt" TIMESTAMP(3),
ADD COLUMN     "commissionRefundedAt" TIMESTAMP(3),
ADD COLUMN     "lateFeeApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateFeeAppliedAt" TIMESTAMP(3),
ADD COLUMN     "lateFeeAmount" DECIMAL(10,2),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- فهارس تساعد عمال الخلفية (worker) على فحص الرحلات المستحقة
CREATE INDEX "RideRequest_pendingRefund_idx" ON "public"."RideRequest"("pendingCommissionRefundAt", "commissionRefundedAt", "status");
CREATE INDEX "RideRequest_lateFee_idx" ON "public"."RideRequest"("arrivedAt", "lateFeeApplied", "status");
