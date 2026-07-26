-- CreateEnum: VerificationStatus
DO $$ BEGIN
  CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: Add verificationStatus and rejectionReason to DriverProfile
DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "rejectionReason" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
