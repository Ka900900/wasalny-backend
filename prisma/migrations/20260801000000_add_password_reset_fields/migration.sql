-- AlterTable: Add temporary password reset token fields
-- تُخزَّن قيمة الرمز مشفّرة (bcrypt) وتنتهي بعد 15 دقيقة
ALTER TABLE "public"."User" ADD COLUMN "reset_password_token" TEXT;
ALTER TABLE "public"."User" ADD COLUMN "reset_password_expires_at" TIMESTAMP(3);
