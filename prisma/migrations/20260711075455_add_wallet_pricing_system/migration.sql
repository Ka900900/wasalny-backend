/*
  Warnings:

  - You are about to alter the column `balance` on the `DriverProfile` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `totalEarnings` on the `DriverProfile` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `baseFare` on the `RideOption` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `pricePerKm` on the `RideOption` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `pricePerMinute` on the `RideOption` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `multiplier` on the `RideOption` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `price` on the `RideRequest` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `pricePerKm` on the `RideRequest` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `commission` on the `RideRequest` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `driverEarning` on the `RideRequest` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `balance` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `pendingWithdraw` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `totalEarned` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `totalWithdrawn` on the `Wallet` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `amount` on the `WalletTransaction` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - The `status` column on the `WalletTransaction` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `amount` on the `WithdrawRequest` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - The `status` column on the `WithdrawRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `type` on the `WalletTransaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."ServiceTier" AS ENUM ('ECO', 'COMFORT', 'PREMIUM');

-- CreateEnum
CREATE TYPE "public"."WalletTransactionType" AS ENUM ('RIDE_HOLD', 'RIDE_DEDUCTION', 'RIDE_REFUND', 'DRIVER_EARNING', 'COMMISSION', 'TOPUP', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "public"."WalletTransactionStatus" AS ENUM ('HELD', 'SETTLED', 'RELEASED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."WithdrawStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

-- DropForeignKey
ALTER TABLE "public"."RideRequest" DROP CONSTRAINT "RideRequest_driverId_fkey";

-- AlterTable
ALTER TABLE "public"."DriverProfile" ADD COLUMN     "serviceTier" "public"."ServiceTier",
ALTER COLUMN "balance" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "totalEarnings" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."RideOption" ADD COLUMN     "serviceTier" "public"."ServiceTier",
ALTER COLUMN "baseFare" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "pricePerKm" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "pricePerMinute" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "multiplier" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."RideRequest" ADD COLUMN     "estimatedFare" DECIMAL(10,2),
ADD COLUMN     "finalPricePerKm" DECIMAL(10,2),
ADD COLUMN     "holdPlaced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceTier" "public"."ServiceTier" DEFAULT 'ECO',
ADD COLUMN     "surgeMultiplierApplied" DECIMAL(10,2),
ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "pricePerKm" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "commission" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "driverEarning" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."Wallet" ADD COLUMN     "reservedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ALTER COLUMN "balance" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "pendingWithdraw" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "totalEarned" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "totalWithdrawn" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."WalletTransaction" DROP COLUMN "type",
ADD COLUMN     "type" "public"."WalletTransactionType" NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2),
DROP COLUMN "status",
ADD COLUMN     "status" "public"."WalletTransactionStatus" NOT NULL DEFAULT 'COMPLETED';

-- AlterTable
ALTER TABLE "public"."WithdrawRequest" ADD COLUMN     "paidAt" TIMESTAMP(3),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2),
DROP COLUMN "status",
ADD COLUMN     "status" "public"."WithdrawStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "public"."Config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'NUMBER',
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Config_key_key" ON "public"."Config"("key");

-- AddForeignKey
ALTER TABLE "public"."RideRequest" ADD CONSTRAINT "RideRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WalletTransaction" ADD CONSTRAINT "WalletTransaction_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "public"."RideRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
