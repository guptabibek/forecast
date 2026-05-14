-- Adds a per-config switch that controls which Marg stock metric we project
-- onto inventory_levels.on_hand_qty:
--   STOCK    -> Marg's `Stock` field (current physical, net of period movements)
--   OPENING  -> Marg's `Opening` field (start-of-fiscal-year balance,
--               matches what Marg ERP F8 / item-selection screens display)
--   COMPUTED -> Opening + Σ(InventoryLedger movements within fiscal year)
-- Default STOCK preserves prior behavior; tenants who reconcile against the
-- Marg ERP UI typically want OPENING.
ALTER TABLE "marg_sync_configs"
  ADD COLUMN "stock_projection_mode" VARCHAR(20) NOT NULL DEFAULT 'STOCK';
