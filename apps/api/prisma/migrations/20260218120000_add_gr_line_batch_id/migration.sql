-- ============================================================================
-- Add batchId FK to goods_receipt_lines
-- ============================================================================
-- Goods Receipt Lines need batch traceability: when a batch-tracked product
-- is received, a Batch record is auto-created and linked here. This batchId
-- then flows through to the CostLayer for batch-level FIFO/LIFO costing.
-- ============================================================================

ALTER TABLE "goods_receipt_lines"
  ADD COLUMN "batch_id" UUID;

-- FK to batches table
ALTER TABLE "goods_receipt_lines"
  ADD CONSTRAINT "goods_receipt_lines_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for batch lookups
CREATE INDEX "goods_receipt_lines_batch_id_idx"
  ON "goods_receipt_lines" ("batch_id");
