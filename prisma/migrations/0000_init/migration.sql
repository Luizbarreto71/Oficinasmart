-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'GERENTE', 'CAIXA', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "TipoControle" AS ENUM ('UNITARIO', 'QUANTIDADE');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('EM_ESTOQUE', 'RESERVADO', 'EM_TRANSITO', 'VENDIDO', 'DEFEITO', 'DEVOLVIDO');

-- CreateEnum
CREATE TYPE "PreSaleStatus" AS ENUM ('AGUARDANDO_CAIXA', 'EM_ATENDIMENTO', 'FINALIZADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('FINALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "CashRegisterStatus" AS ENUM ('ABERTO', 'FECHADO');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('EM_ESTOQUE', 'RESERVADO', 'VENDIDO');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'AJUSTE');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('COMPRA', 'CADASTRO', 'VENDA', 'DEFEITO', 'DEVOLUCAO_FORNECEDOR', 'PERDA', 'USO_INTERNO', 'AJUSTE', 'TRANSFERENCIA', 'RETIRADA', 'CANCELAMENTO', 'EXCLUSAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDENTE', 'APROVADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDENTE', 'EM_TRANSITO', 'RECEBIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ImeiSituacao" AS ENUM ('NAO_CONSULTADO', 'REGULAR', 'IRREGULAR', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "TradeInStatus" AS ENUM ('AVALIADA', 'ACEITA', 'RECUSADA');

-- CreateEnum
CREATE TYPE "TradeInFotoTipo" AS ENUM ('ANATEL', 'DOCUMENTO', 'APARELHO');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'TROCA', 'EM_ABERTO', 'OUTRO');

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FILIAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VENDEDOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unitId" TEXT,
    "foto" BYTEA,
    "fotoMimeType" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "campos" JSONB,
    "tipoControlePadrao" "TipoControle" NOT NULL DEFAULT 'QUANTIDADE',
    "parentId" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "document" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "document" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "capacity" TEXT,
    "ram" TEXT,
    "lote" TEXT,
    "condicao" TEXT,
    "tipoControle" "TipoControle" NOT NULL DEFAULT 'QUANTIDADE',
    "semEstoque" BOOLEAN NOT NULL DEFAULT false,
    "garantiaPadraoDias" INTEGER,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lastPurchaseCost" DECIMAL(12,2),
    "lastPurchaseAt" TIMESTAMP(3),
    "salePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wholesalePrice" DECIMAL(12,2),
    "seminovo" BOOLEAN NOT NULL DEFAULT false,
    "seminovoOrigem" TEXT,
    "imei" TEXT,
    "serialNumber" TEXT,
    "barcode" TEXT,
    "notes" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'EM_ESTOQUE',
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tradeInAparelhoId" TEXT,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_units" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "imei" TEXT,
    "imei2" TEXT,
    "serialNumber" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'EM_ESTOQUE',
    "condicao" TEXT,
    "batteryHealth" INTEGER,
    "warrantyUntil" TIMESTAMP(3),
    "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(12,2),
    "imeiSituacao" "ImeiSituacao" NOT NULL DEFAULT 'NAO_CONSULTADO',
    "imeiCheckedAt" TIMESTAMP(3),
    "notes" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleItemId" TEXT,
    "tradeInAparelhoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_ins" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TradeInStatus" NOT NULL DEFAULT 'AVALIADA',
    "modelo" TEXT NOT NULL,
    "marca" TEXT,
    "armazenamento" TEXT,
    "cor" TEXT,
    "imei" TEXT,
    "imeiSituacao" "ImeiSituacao" NOT NULL DEFAULT 'NAO_CONSULTADO',
    "imeiCheckedAt" TIMESTAMP(3),
    "estado" TEXT,
    "defeitos" TEXT[],
    "observacoes" TEXT,
    "valorAvaliado" DECIMAL(12,2) NOT NULL,
    "productId" TEXT,
    "saidaNome" TEXT,
    "valorSaida" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerDocument" TEXT,
    "sellerId" TEXT NOT NULL,
    "unitId" TEXT,
    "preSaleId" TEXT,
    "saleId" TEXT,
    "estoqueProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_in_aparelhos" (
    "id" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "marca" TEXT,
    "armazenamento" TEXT,
    "cor" TEXT,
    "imei" TEXT,
    "imeiSituacao" "ImeiSituacao" NOT NULL DEFAULT 'NAO_CONSULTADO',
    "imeiCheckedAt" TIMESTAMP(3),
    "estado" TEXT,
    "defeitos" TEXT[],
    "observacoes" TEXT,
    "valorAvaliado" DECIMAL(12,2) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "tradeInId" TEXT NOT NULL,

    CONSTRAINT "trade_in_aparelhos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_in_photos" (
    "id" TEXT NOT NULL,
    "tipo" "TradeInFotoTipo" NOT NULL DEFAULT 'APARELHO',
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tradeInId" TEXT NOT NULL,
    "aparelhoId" TEXT,

    CONSTRAINT "trade_in_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_photos" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,

    CONSTRAINT "product_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'FINALIZADA',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "costAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "preSaleId" TEXT,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "cashierId" TEXT,
    "cashRegisterId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerDocument" TEXT,
    "unitId" TEXT NOT NULL,
    "commissionRate" DECIMAL(5,2),
    "commissionAmount" DECIMAL(12,2),

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "feePercent" DECIMAL(6,2),
    "netAmount" DECIMAL(12,2),
    "bandeira" TEXT,
    "autorizacao" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledMethod" "PaymentMethod",
    "settledById" TEXT,
    "notes" TEXT,
    "destino" TEXT,
    "saleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "imei" TEXT,
    "serialNumber" TEXT,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT,
    "commissionAmount" DECIMAL(12,2),

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_sales" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PreSaleStatus" NOT NULL DEFAULT 'AGUARDANDO_CAIXA',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod",
    "installments" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerDocument" TEXT,
    "sellerId" TEXT NOT NULL,
    "cashierId" TEXT,
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "pre_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_sale_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "imei" TEXT,
    "serialNumber" TEXT,
    "deviceId" TEXT,
    "preSaleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT,

    CONSTRAINT "pre_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CashRegisterStatus" NOT NULL DEFAULT 'ABERTO',
    "cashierId" TEXT NOT NULL,
    "unitId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "summary" JSONB,
    "notes" TEXT,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "stock" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "reason" "MovementReason" NOT NULL DEFAULT 'OUTRO',
    "quantity" INTEGER NOT NULL,
    "previousQuantity" INTEGER,
    "newQuantity" INTEGER,
    "unitCost" DECIMAL(12,2),
    "averageCostAfter" DECIMAL(12,2),
    "deviceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT,
    "productName" TEXT,
    "unitId" TEXT,
    "originUnitId" TEXT,
    "destinationUnitId" TEXT,
    "referenceId" TEXT,
    "saleId" TEXT,
    "transferId" TEXT,
    "withdrawalId" TEXT,
    "userId" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_withdrawals" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "soldQuantity" INTEGER,
    "returnedQuantity" INTEGER,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDENTE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "requestedById" TEXT,
    "approvedById" TEXT,

    CONSTRAINT "stock_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'RECEBIDA',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "productId" TEXT NOT NULL,
    "originUnitId" TEXT NOT NULL,
    "destinationUnitId" TEXT NOT NULL,
    "requestedById" TEXT,
    "receivedById" TEXT,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_name_key" ON "units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_unitId_idx" ON "users"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "products_tradeInAparelhoId_key" ON "products"("tradeInAparelhoId");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

-- CreateIndex
CREATE INDEX "products_model_idx" ON "products"("model");

-- CreateIndex
CREATE INDEX "products_imei_idx" ON "products"("imei");

-- CreateIndex
CREATE INDEX "products_serialNumber_idx" ON "products"("serialNumber");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_lote_idx" ON "products"("lote");

-- CreateIndex
CREATE INDEX "products_condicao_idx" ON "products"("condicao");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_tipoControle_idx" ON "products"("tipoControle");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_supplierId_idx" ON "products"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_imei_key" ON "device_units"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_saleItemId_key" ON "device_units"("saleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_tradeInAparelhoId_key" ON "device_units"("tradeInAparelhoId");

-- CreateIndex
CREATE INDEX "device_units_productId_idx" ON "device_units"("productId");

-- CreateIndex
CREATE INDEX "device_units_unitId_idx" ON "device_units"("unitId");

-- CreateIndex
CREATE INDEX "device_units_status_idx" ON "device_units"("status");

-- CreateIndex
CREATE INDEX "device_units_serialNumber_idx" ON "device_units"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "trade_ins_code_key" ON "trade_ins"("code");

-- CreateIndex
CREATE UNIQUE INDEX "trade_ins_preSaleId_key" ON "trade_ins"("preSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_ins_saleId_key" ON "trade_ins"("saleId");

-- CreateIndex
CREATE INDEX "trade_ins_status_idx" ON "trade_ins"("status");

-- CreateIndex
CREATE INDEX "trade_ins_sellerId_idx" ON "trade_ins"("sellerId");

-- CreateIndex
CREATE INDEX "trade_ins_imei_idx" ON "trade_ins"("imei");

-- CreateIndex
CREATE INDEX "trade_ins_createdAt_idx" ON "trade_ins"("createdAt");

-- CreateIndex
CREATE INDEX "trade_in_aparelhos_tradeInId_idx" ON "trade_in_aparelhos"("tradeInId");

-- CreateIndex
CREATE INDEX "trade_in_photos_tradeInId_idx" ON "trade_in_photos"("tradeInId");

-- CreateIndex
CREATE INDEX "trade_in_photos_aparelhoId_idx" ON "trade_in_photos"("aparelhoId");

-- CreateIndex
CREATE INDEX "product_photos_productId_idx" ON "product_photos"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_code_key" ON "sales"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_preSaleId_key" ON "sales"("preSaleId");

-- CreateIndex
CREATE INDEX "sales_unitId_idx" ON "sales"("unitId");

-- CreateIndex
CREATE INDEX "sales_saleDate_idx" ON "sales"("saleDate");

-- CreateIndex
CREATE INDEX "sales_customerId_idx" ON "sales"("customerId");

-- CreateIndex
CREATE INDEX "sales_sellerId_idx" ON "sales"("sellerId");

-- CreateIndex
CREATE INDEX "sales_cashierId_idx" ON "sales"("cashierId");

-- CreateIndex
CREATE INDEX "sale_payments_saleId_idx" ON "sale_payments"("saleId");

-- CreateIndex
CREATE INDEX "sale_payments_method_idx" ON "sale_payments"("method");

-- CreateIndex
CREATE INDEX "sale_items_saleId_idx" ON "sale_items"("saleId");

-- CreateIndex
CREATE INDEX "sale_items_productId_idx" ON "sale_items"("productId");

-- CreateIndex
CREATE INDEX "sale_items_imei_idx" ON "sale_items"("imei");

-- CreateIndex
CREATE INDEX "sale_items_serialNumber_idx" ON "sale_items"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "pre_sales_code_key" ON "pre_sales"("code");

-- CreateIndex
CREATE INDEX "pre_sales_status_idx" ON "pre_sales"("status");

-- CreateIndex
CREATE INDEX "pre_sales_sellerId_idx" ON "pre_sales"("sellerId");

-- CreateIndex
CREATE INDEX "pre_sales_createdAt_idx" ON "pre_sales"("createdAt");

-- CreateIndex
CREATE INDEX "pre_sale_items_preSaleId_idx" ON "pre_sale_items"("preSaleId");

-- CreateIndex
CREATE INDEX "pre_sale_items_productId_idx" ON "pre_sale_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_code_key" ON "cash_registers"("code");

-- CreateIndex
CREATE INDEX "cash_registers_cashierId_idx" ON "cash_registers"("cashierId");

-- CreateIndex
CREATE INDEX "cash_registers_status_idx" ON "cash_registers"("status");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "stock_unitId_idx" ON "stock"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_productId_unitId_key" ON "stock"("productId", "unitId");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_productId_idx" ON "stock_movements"("productId");

-- CreateIndex
CREATE INDEX "stock_movements_unitId_idx" ON "stock_movements"("unitId");

-- CreateIndex
CREATE INDEX "stock_movements_deviceId_idx" ON "stock_movements"("deviceId");

-- CreateIndex
CREATE INDEX "stock_withdrawals_status_idx" ON "stock_withdrawals"("status");

-- CreateIndex
CREATE INDEX "stock_withdrawals_productId_unitId_idx" ON "stock_withdrawals"("productId", "unitId");

-- CreateIndex
CREATE INDEX "stock_transfers_createdAt_idx" ON "stock_transfers"("createdAt");

-- CreateIndex
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tradeInAparelhoId_fkey" FOREIGN KEY ("tradeInAparelhoId") REFERENCES "trade_in_aparelhos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_tradeInAparelhoId_fkey" FOREIGN KEY ("tradeInAparelhoId") REFERENCES "trade_in_aparelhos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_preSaleId_fkey" FOREIGN KEY ("preSaleId") REFERENCES "pre_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_in_aparelhos" ADD CONSTRAINT "trade_in_aparelhos_tradeInId_fkey" FOREIGN KEY ("tradeInId") REFERENCES "trade_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_in_photos" ADD CONSTRAINT "trade_in_photos_tradeInId_fkey" FOREIGN KEY ("tradeInId") REFERENCES "trade_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_in_photos" ADD CONSTRAINT "trade_in_photos_aparelhoId_fkey" FOREIGN KEY ("aparelhoId") REFERENCES "trade_in_aparelhos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_preSaleId_fkey" FOREIGN KEY ("preSaleId") REFERENCES "pre_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_sales" ADD CONSTRAINT "pre_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_sales" ADD CONSTRAINT "pre_sales_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_sales" ADD CONSTRAINT "pre_sales_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_sales" ADD CONSTRAINT "pre_sales_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_sale_items" ADD CONSTRAINT "pre_sale_items_preSaleId_fkey" FOREIGN KEY ("preSaleId") REFERENCES "pre_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_sale_items" ADD CONSTRAINT "pre_sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "stock_withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_withdrawals" ADD CONSTRAINT "stock_withdrawals_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_withdrawals" ADD CONSTRAINT "stock_withdrawals_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_originUnitId_fkey" FOREIGN KEY ("originUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destinationUnitId_fkey" FOREIGN KEY ("destinationUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

