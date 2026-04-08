import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * SequenceService — Database-backed document number generator.
 *
 * Uses PostgreSQL sequences for gap-free, concurrency-safe numbering.
 * Each document type has its own sequence.
 * Numbers are in the format: PREFIX-0000001
 *
 * Supported prefixes:
 *   RSV  — Inventory Reservation
 *   HLD  — Inventory Hold
 *   JE   — Journal Entry
 *   QI   — Quality Inspection
 *   NCR  — Non-Conformance Report
 *   CAPA — Corrective Action
 *   PO   — Purchase Order
 *   GR   — Goods Receipt
 *   WO   — Work Order
 *   MI   — Material Issue
 *   PC   — Production Completion
 *   BN   — Batch Number
 *   IT   — Inventory Transaction
 */
@Injectable()
export class SequenceService {
  /**
   * Generate next document number for a given prefix.
   * Uses database sequences created in migration.
   *
   * MUST be called inside a Prisma.$transaction to ensure atomicity.
   */
  async nextNumber(
    tx: Prisma.TransactionClient,
    prefix: string,
  ): Promise<string> {
    const seqName = this.getSequenceName(prefix);
    const result = await tx.$queryRaw<Array<{ nextval: bigint }>>(
      Prisma.sql`SELECT nextval(CAST(${seqName} AS regclass)) AS nextval`,
    );
    const num = Number(result[0].nextval);
    const padLength = prefix === 'JE' ? 7 : 6;
    return `${prefix}-${String(num).padStart(padLength, '0')}`;
  }

  private getSequenceName(prefix: string): string {
    const map: Record<string, string> = {
      RSV: 'seq_reservation_number',
      HLD: 'seq_hold_number',
      JE: 'seq_journal_entry_number',
      QI: 'seq_inspection_number',
      NCR: 'seq_ncr_number',
      CAPA: 'seq_capa_number',
      PO: 'seq_purchase_order_number',
      GR: 'seq_goods_receipt_number',
      WO: 'seq_work_order_number',
      MI: 'seq_material_issue_number',
      PC: 'seq_production_completion_number',
      BN: 'seq_batch_number',
      IT: 'seq_inventory_transaction_number',
    };
    const name = map[prefix];
    if (!name) {
      throw new Error(`Unknown document prefix: ${prefix}. Valid: ${Object.keys(map).join(', ')}`);
    }
    return name;
  }
}
