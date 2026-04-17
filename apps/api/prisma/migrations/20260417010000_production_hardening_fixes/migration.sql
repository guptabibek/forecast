-- Migration: production_hardening_fixes
-- Fix VarChar sizes, change addField type, widen voucher/saletype columns

-- 1. MargProduct: change add_field from VARCHAR(255) to TEXT
ALTER TABLE "marg_products" ALTER COLUMN "add_field" TYPE TEXT;

-- 2. MargVoucher: widen salesman, mr, route, area, orn from VARCHAR(20/50) to VARCHAR(100)
ALTER TABLE "marg_vouchers" ALTER COLUMN "salesman" TYPE VARCHAR(100);
ALTER TABLE "marg_vouchers" ALTER COLUMN "mr" TYPE VARCHAR(100);
ALTER TABLE "marg_vouchers" ALTER COLUMN "route" TYPE VARCHAR(100);
ALTER TABLE "marg_vouchers" ALTER COLUMN "area" TYPE VARCHAR(100);
ALTER TABLE "marg_vouchers" ALTER COLUMN "orn" TYPE VARCHAR(100);

-- 3. MargSaleType: widen sg_code, s_code from VARCHAR(20) to VARCHAR(50), main from VARCHAR(20) to VARCHAR(100)
ALTER TABLE "marg_sale_types" ALTER COLUMN "sg_code" TYPE VARCHAR(50);
ALTER TABLE "marg_sale_types" ALTER COLUMN "s_code" TYPE VARCHAR(50);
ALTER TABLE "marg_sale_types" ALTER COLUMN "main" TYPE VARCHAR(100);
