-- AlterTable: Add password column for email/password authentication
ALTER TABLE "public"."User" ADD COLUMN "password" TEXT;
