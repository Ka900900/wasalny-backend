-- Add identity verification document fields to DriverProfile
ALTER TABLE "public"."DriverProfile"
  ADD COLUMN IF NOT EXISTS "idPhotoFront"   TEXT,
  ADD COLUMN IF NOT EXISTS "idPhotoBack"    TEXT,
  ADD COLUMN IF NOT EXISTS "licensePhoto"   TEXT,
  ADD COLUMN IF NOT EXISTS "facePhoto"      TEXT,
  ADD COLUMN IF NOT EXISTS "insurancePhoto" TEXT;

