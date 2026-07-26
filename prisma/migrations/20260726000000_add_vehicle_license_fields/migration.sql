-- AlterTable: Add vehicle license front/back URL columns to DriverProfile
-- Safe add: skip if column already exists (handles production drift)
DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "vehicleLicenseFrontUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "vehicleLicenseBackUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
