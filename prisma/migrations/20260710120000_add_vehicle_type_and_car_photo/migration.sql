-- CreateEnum
CREATE TYPE "public"."VehicleType" AS ENUM ('PRIVATE_CAR', 'TAXI', 'SCOOTER');

-- AlterTable
ALTER TABLE "public"."DriverProfile" ADD COLUMN     "vehicleType" "public"."VehicleType" NOT NULL,
ADD COLUMN     "carPhotoUrl" TEXT NOT NULL;
