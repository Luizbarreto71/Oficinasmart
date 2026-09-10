-- Módulo de Assistência Técnica (Ordem de Serviço)
-- Rode este arquivo inteiro no Supabase → SQL Editor (projeto dcrddffmzyjvpfeezrxy).
-- É seguro rodar mais de uma vez: usa IF NOT EXISTS onde o Postgres permite.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ServiceOrderStatus" AS ENUM (
    'RECEBIDO', 'EM_ANALISE', 'ORCAMENTO', 'APROVADO', 'EM_REPARO',
    'AGUARDANDO_PECA', 'PRONTO', 'ENTREGUE', 'RECUSADO', 'CANCELADO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum: novo motivo de movimentação de estoque
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'REPARO';

-- CreateTable
CREATE TABLE IF NOT EXISTS "service_orders" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'RECEBIDO',
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerDocument" TEXT,
    "deviceBrand" TEXT,
    "deviceModel" TEXT NOT NULL,
    "deviceColor" TEXT,
    "deviceImei" TEXT,
    "deviceSerial" TEXT,
    "devicePassword" TEXT,
    "accessories" TEXT,
    "conditionIn" TEXT,
    "checklistIn" JSONB,
    "batteryHealth" INTEGER,
    "reportedProblem" TEXT NOT NULL,
    "diagnosis" TEXT,
    "internalNotes" TEXT,
    "estimatedValue" DECIMAL(12,2),
    "quotedValue" DECIMAL(12,2),
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warrantyDays" INTEGER,
    "warrantyUntil" TIMESTAMP(3),
    "technicianId" TEXT,
    "unitId" TEXT NOT NULL,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "service_order_items" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PECA',
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "serviceOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "deviceUnitId" TEXT,

    CONSTRAINT "service_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "service_order_photos" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "tipo" TEXT NOT NULL DEFAULT 'ENTRADA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceOrderId" TEXT NOT NULL,

    CONSTRAINT "service_order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "service_orders_code_key" ON "service_orders"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "service_orders_saleId_key" ON "service_orders"("saleId");
CREATE INDEX IF NOT EXISTS "service_orders_status_idx" ON "service_orders"("status");
CREATE INDEX IF NOT EXISTS "service_orders_deviceImei_idx" ON "service_orders"("deviceImei");
CREATE INDEX IF NOT EXISTS "service_orders_customerId_idx" ON "service_orders"("customerId");
CREATE INDEX IF NOT EXISTS "service_orders_createdAt_idx" ON "service_orders"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_items_deviceUnitId_key" ON "service_order_items"("deviceUnitId");
CREATE INDEX IF NOT EXISTS "service_order_items_serviceOrderId_idx" ON "service_order_items"("serviceOrderId");
CREATE INDEX IF NOT EXISTS "service_order_items_productId_idx" ON "service_order_items"("productId");
CREATE INDEX IF NOT EXISTS "service_order_photos_serviceOrderId_idx" ON "service_order_photos"("serviceOrderId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_technicianId_fkey"
    FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_serviceOrderId_fkey"
    FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "service_order_photos" ADD CONSTRAINT "service_order_photos_serviceOrderId_fkey"
    FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
