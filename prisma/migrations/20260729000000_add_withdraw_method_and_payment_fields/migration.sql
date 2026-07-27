-- Add withdrawMethod and instapayId to WithdrawRequest
DO $$ BEGIN
  ALTER TABLE "WithdrawRequest" ADD COLUMN "withdrawMethod" TEXT NOT NULL DEFAULT 'BANK';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WithdrawRequest" ADD COLUMN "instapayId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add label, accountNumber, bankName to PaymentMethod (for non-card payment methods)
DO $$ BEGIN
  ALTER TABLE "PaymentMethod" ADD COLUMN "label" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentMethod" ADD COLUMN "accountNumber" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentMethod" ADD COLUMN "bankName" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
