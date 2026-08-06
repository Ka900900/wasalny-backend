-- ─────────────────────────────────────────────────────────────
-- إشعارات الأدمن → الكباتن (بث إعلانات) (2026-08-06)
-- 1) audience: الجمهور المستهدف (ALL_CAPTAINS | CAPTAIN | USER)
-- 2) createdBy: معرف الأدمن الذي أرسل الإشعار (للإشعارات من اللوحة)
-- ─────────────────────────────────────────────────────────────

-- AlterTable: إضافة حقول جديدة لجدول الإشعارات
ALTER TABLE "public"."Notification" ADD COLUMN     "audience" TEXT DEFAULT 'USER';
ALTER TABLE "public"."Notification" ADD COLUMN     "createdBy" TEXT;

-- فهرس لتصفية الإشعارات حسب الجمهور
CREATE INDEX "Notification_audience_idx" ON "public"."Notification"("audience");
