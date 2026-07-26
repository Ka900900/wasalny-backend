-- AlterTable: Add licenseNumber, criminalRecordUrl, drugTestUrl to DriverProfile
-- Safe add: skip if column already exists (handles production drift)
DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "licenseNumber" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "criminalRecordUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DriverProfile" ADD COLUMN "drugTestUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
