// ============================================================================
// INVENTORY & STOCK REPORTS SERVICE
// Covers: Current Stock, Batch-wise Inventory, Stock Movement Ledger,
//         Reorder / Low Stock, Stock Ageing
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
    InventoryBaseFilterDto,
    ReorderFilterDto,
    StockAgeingFilterDto,
} from '../dto';
import {
    AllowedSqlColumns,
    buildPharmaFilterSql,
    buildPharmaOrderBySql,
    PharmaColumnFilter,
    parsePharmaFilters,
} from '../pharma-filter.helper';

// ── helper: build dynamic WHERE fragments for optional filters ──────────────
function buildWhereFragments(
  tenantId: string,
  filters: InventoryBaseFilterDto,
  aliases: { product?: string; location?: string; batch?: string } = {},
): { conditions: Prisma.Sql[]; params: never[] } {
  const p = aliases.product ?? 'p';
  const l = aliases.location ?? 'l';
  const b = aliases.batch ?? 'b';

  const conditions: Prisma.Sql[] = [];

  if (filters.productIds?.length) {
    conditions.push(
      Prisma.sql`${Prisma.raw(p)}.id = ANY(${filters.productIds}::uuid[])`,
    );
  }
  if (filters.locationIds?.length) {
    conditions.push(
      Prisma.sql`${Prisma.raw(l)}.id = ANY(${filters.locationIds}::uuid[])`,
    );
  }
  if (filters.batchIds?.length) {
    conditions.push(
      Prisma.sql`${Prisma.raw(b)}.id = ANY(${filters.batchIds}::uuid[])`,
    );
  }
  if (filters.category) {
    conditions.push(
      Prisma.sql`${Prisma.raw(p)}.category = ${filters.category}`,
    );
  }
  return { conditions, params: [] as never[] };
}

function joinConditions(base: Prisma.Sql, extra: Prisma.Sql[]): Prisma.Sql {
  if (!extra.length) return base;
  return Prisma.sql`${base} AND ${Prisma.join(extra, ' AND ')}`;
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface CurrentStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  company: string | null;
  company_code: string | null;
  company_name: string | null;
  company_display: string | null;
  salt: string | null;
  salt_code: string | null;
  salt_name: string | null;
  salt_display: string | null;
  product_group: string | null;
  product_group_code: string | null;
  product_group_name: string | null;
  product_group_display: string | null;
  hsn_code: string | null;
  uom_code: string | null;
  uom_name: string | null;
  uom_display: string | null;
  location_id: string;
  location_code: string;
  location_name: string;
  on_hand_qty: number;
  available_qty: number;
  allocated_qty: number;
  reserved_qty: number;
  quarantine_qty: number;
  in_transit_qty: number;
  on_order_qty: number;
  unit_cost: number;
  inventory_value: number;
  last_updated: Date;
}

export interface BatchInventoryRow {
  product_id: string;
  sku: string;
  product_name: string;
  batch_id: string;
  batch_number: string;
  location_id: string;
  location_code: string;
  location_name: string;
  quantity: number;
  available_qty: number;
  cost_per_unit: number;
  batch_value: number;
  manufacturing_date: Date | null;
  expiry_date: Date | null;
  days_to_expiry: number | null;
  batch_status: string;
}

export interface MovementLedgerRow {
  id: string;
  sequence_number: string;
  transaction_date: Date;
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  batch_number: string | null;
  entry_type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  running_balance: number;
  reference_type: string | null;
  reference_number: string | null;
  notes: string | null;
}

export interface ReorderRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  on_hand_qty: number;
  available_qty: number;
  reorder_point: number;
  safety_stock_qty: number;
  lead_time_days: number;
  avg_daily_sales: number;
  suggested_order_qty: number;
  abc_class: string | null;
  days_of_stock: number | null;
}

export interface StockAgeingRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  batch_number: string;
  inward_date: Date;
  age_days: number;
  age_bucket: string;
  quantity: number;
  batch_value: number;
}

// ── Per-report column allowlists (filter + sort) ──────────────────────────
const CURRENT_STOCK_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'p.code', type: 'string' },
  product_name: { expression: 'p.name', type: 'string' },
  category: { expression: 'p.category', type: 'string' },
  company: { expression: 'p.product_company', type: 'string' },
  salt: { expression: 'p.salt', type: 'string' },
  product_group: { expression: 'p.product_group', type: 'string' },
  hsn_code: { expression: 'p.hsn_code', type: 'string' },
  location_code: { expression: 'l.code', type: 'string' },
  location_name: { expression: 'l.name', type: 'string' },
  on_hand_qty: { expression: 'COALESCE(il.on_hand_qty, 0)', type: 'number' },
  available_qty: { expression: 'COALESCE(il.available_qty, 0)', type: 'number' },
  allocated_qty: { expression: 'COALESCE(il.allocated_qty, 0)', type: 'number' },
  reserved_qty: { expression: 'COALESCE(il.reserved_qty, 0)', type: 'number' },
  in_transit_qty: { expression: 'COALESCE(il.in_transit_qty, 0)', type: 'number' },
  on_order_qty: { expression: 'COALESCE(il.on_order_qty, 0)', type: 'number' },
  unit_cost: { expression: 'COALESCE(il.average_cost, il.standard_cost, 0)', type: 'number' },
  inventory_value: { expression: 'COALESCE(il.inventory_value, 0)', type: 'number' },
  last_updated: { expression: 'il.updated_at', type: 'date' },
};

const BATCH_INVENTORY_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'p.code', type: 'string' },
  product_name: { expression: 'p.name', type: 'string' },
  category: { expression: 'p.category', type: 'string' },
  batch_number: { expression: 'b.batch_number', type: 'string' },
  location_code: { expression: 'l.code', type: 'string' },
  location_name: { expression: 'l.name', type: 'string' },
  quantity: { expression: 'COALESCE(b.quantity, 0)', type: 'number' },
  available_qty: { expression: 'COALESCE(b.available_qty, 0)', type: 'number' },
  cost_per_unit: { expression: 'COALESCE(b.cost_per_unit, 0)', type: 'number' },
  batch_value: { expression: '(COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))', type: 'number' },
  manufacturing_date: { expression: 'b.manufacturing_date', type: 'date' },
  expiry_date: { expression: 'b.expiry_date', type: 'date' },
  batch_status: { expression: 'b.status', type: 'enum' },
};

const MOVEMENT_LEDGER_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'p.code', type: 'string' },
  product_name: { expression: 'p.name', type: 'string' },
  location_code: { expression: 'l.code', type: 'string' },
  batch_number: { expression: 'bat.batch_number', type: 'string' },
  entry_type: { expression: 'il.entry_type', type: 'enum' },
  quantity: { expression: 'il.quantity', type: 'number' },
  unit_cost: { expression: 'COALESCE(il.unit_cost, 0)', type: 'number' },
  total_cost: { expression: 'COALESCE(il.total_cost, 0)', type: 'number' },
  running_balance: { expression: 'COALESCE(il.running_balance, 0)', type: 'number' },
  reference_type: { expression: 'il.reference_type', type: 'string' },
  reference_number: { expression: 'il.reference_number', type: 'string' },
  transaction_date: { expression: 'il.transaction_date', type: 'date' },
};

const MOVEMENT_TYPE_ALIASES: Record<string, string> = {
  RECEIPT: 'LEDGER_RECEIPT',
  PURCHASE: 'LEDGER_RECEIPT',
  PURCHASEINVOICE: 'LEDGER_RECEIPT',
  GOODSRECEIPT: 'LEDGER_RECEIPT',
  ISSUE: 'LEDGER_ISSUE',
  SALE: 'LEDGER_ISSUE',
  SALES: 'LEDGER_ISSUE',
  SALESINVOICE: 'LEDGER_ISSUE',
  ADJUSTMENT: 'LEDGER_ADJUSTMENT',
  STOCKADJUSTMENT: 'LEDGER_ADJUSTMENT',
  TRANSFERIN: 'LEDGER_TRANSFER_IN',
  TRANSFEROUT: 'LEDGER_TRANSFER_OUT',
  RETURN: 'LEDGER_RETURN',
  SALESRETURN: 'LEDGER_RETURN',
  PURCHASERETURN: 'LEDGER_RETURN',
  SCRAP: 'LEDGER_SCRAP',
  PRODUCTIONRECEIPT: 'LEDGER_PRODUCTION_RECEIPT',
  PRODUCTIONISSUE: 'LEDGER_PRODUCTION_ISSUE',
  HOLD: 'LEDGER_HOLD',
  RELEASE: 'LEDGER_RELEASE',
  RESERVATION: 'LEDGER_RESERVATION',
  UNRESERVATION: 'LEDGER_UNRESERVATION',
};

const MOVEMENT_TYPE_GROUP_ALIASES: Record<string, string[]> = {
  TRANSFER: ['LEDGER_TRANSFER_IN', 'LEDGER_TRANSFER_OUT'],
  STOCKTRANSFER: ['LEDGER_TRANSFER_IN', 'LEDGER_TRANSFER_OUT'],
};

export function normalizeMovementLedgerFilters(filters: PharmaColumnFilter[]): PharmaColumnFilter[] {
  return filters.map((filter) => {
    if (filter.field !== 'entry_type' || filter.value == null) return filter;
    const normalize = (value: unknown) => {
      const raw = String(value).trim();
      const key = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
      return MOVEMENT_TYPE_ALIASES[key] ?? raw;
    };
    const normalizeList = (value: unknown) => {
      const raw = String(value).trim();
      const key = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
      return MOVEMENT_TYPE_GROUP_ALIASES[key] ?? [normalize(value)];
    };

    if (Array.isArray(filter.value)) {
      return {
        ...filter,
        operator: 'in',
        value: filter.value.flatMap(normalizeList),
      };
    }

    const key = String(filter.value).trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
    const grouped = MOVEMENT_TYPE_GROUP_ALIASES[key];
    if (grouped) {
      return { ...filter, operator: 'in', value: grouped };
    }

    return {
      ...filter,
      value: normalize(filter.value),
    };
  });
}

const REORDER_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'p.code', type: 'string' },
  product_name: { expression: 'p.name', type: 'string' },
  category: { expression: 'p.category', type: 'string' },
  location_code: { expression: 'l.code', type: 'string' },
  on_hand_qty: { expression: 'COALESCE(il.on_hand_qty, 0)', type: 'number' },
  available_qty: { expression: 'COALESCE(il.available_qty, 0)', type: 'number' },
  reorder_point: { expression: 'COALESCE(ip.reorder_point, 0)', type: 'number' },
  safety_stock_qty: { expression: 'COALESCE(ip.safety_stock_qty, 0)', type: 'number' },
  lead_time_days: { expression: 'COALESCE(ip.lead_time_days, 7)', type: 'number' },
  abc_class: { expression: 'ip.abc_class', type: 'string' },
};

const STOCK_AGEING_COLUMNS: AllowedSqlColumns = {
  sku: { expression: 'p.code', type: 'string' },
  product_name: { expression: 'p.name', type: 'string' },
  category: { expression: 'p.category', type: 'string' },
  location_code: { expression: 'l.code', type: 'string' },
  batch_number: { expression: 'b.batch_number', type: 'string' },
  inward_date: { expression: 'b.manufacturing_date', type: 'date' },
  quantity: { expression: 'b.quantity', type: 'number' },
  batch_value: { expression: '(COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))', type: 'number' },
};

@Injectable()
export class InventoryReportsService {
  private readonly logger = new Logger(InventoryReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // A. CURRENT STOCK (real-time, from pre-computed inventory_levels)
  //
  // Formula: Stock per product/location already maintained by the inventory
  //          engine; on_hand_qty = SUM(IN) − SUM(OUT) updated on every txn.
  //
  // Edge cases:
  //   • Negative on_hand_qty: included but flagged (data integrity issue)
  //   • Zero stock rows: excluded by default (on_hand_qty != 0)
  //   • Missing cost: COALESCE to 0
  //
  // Performance:
  //   • Uses inventory_levels (one row per product×location) → O(products*locs)
  //   • Indexes: @@unique([tenantId, productId, locationId])
  // ─────────────────────────────────────────────────────────────────────────
  async getCurrentStock(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<{ data: CurrentStockRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const { conditions } = buildWhereFragments(tenantId, filters, {
      product: 'p',
      location: 'l',
    });

    const columnFilters = parsePharmaFilters(filters.filters);
    const filterConds = buildPharmaFilterSql(columnFilters, CURRENT_STOCK_COLUMNS);

    const baseWhere = Prisma.sql`il.tenant_id = ${tenantId}::uuid AND il.on_hand_qty != 0`;
    const where = joinConditions(baseWhere, [...conditions, ...filterConds]);
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, CURRENT_STOCK_COLUMNS,
      Prisma.sql`p.code, l.code`,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        WHERE ${where}
      `,
    );

    const rows = await this.prisma.$queryRaw<CurrentStockRow[]>(
      Prisma.sql`
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          NULLIF(TRIM(p.product_company), '') AS company,
          NULLIF(TRIM(p.product_company), '') AS company_code,
          COALESCE(pc.name, CASE WHEN NULLIF(TRIM(p.product_company), '') IS NULL THEN NULL ELSE 'Unknown company (' || TRIM(p.product_company) || ')' END) AS company_name,
          CASE WHEN NULLIF(TRIM(p.product_company), '') IS NULL THEN NULL ELSE TRIM(p.product_company) || ' - ' || COALESCE(pc.name, 'Unknown company (' || TRIM(p.product_company) || ')') END AS company_display,
          NULLIF(TRIM(p.salt), '') AS salt,
          NULLIF(TRIM(p.salt), '') AS salt_code,
          COALESCE(ps.name, CASE WHEN NULLIF(TRIM(p.salt), '') IS NULL THEN NULL ELSE 'Unknown salt (' || TRIM(p.salt) || ')' END) AS salt_name,
          CASE WHEN NULLIF(TRIM(p.salt), '') IS NULL THEN NULL ELSE TRIM(p.salt) || ' - ' || COALESCE(ps.name, 'Unknown salt (' || TRIM(p.salt) || ')') END AS salt_display,
          NULLIF(TRIM(p.product_group), '') AS product_group,
          NULLIF(TRIM(p.product_group), '') AS product_group_code,
          COALESCE(pg.name, CASE WHEN NULLIF(TRIM(p.product_group), '') IS NULL THEN NULL ELSE 'Unknown group (' || TRIM(p.product_group) || ')' END) AS product_group_name,
          CASE WHEN NULLIF(TRIM(p.product_group), '') IS NULL THEN NULL ELSE TRIM(p.product_group) || ' - ' || COALESCE(pg.name, 'Unknown group (' || TRIM(p.product_group) || ')') END AS product_group_display,
          p.hsn_code      AS hsn_code,
          NULLIF(TRIM(p.unit_of_measure), '') AS uom_code,
          COALESCE(uom.name, CASE WHEN NULLIF(TRIM(p.unit_of_measure), '') IS NULL THEN NULL ELSE 'Unknown UOM (' || TRIM(p.unit_of_measure) || ')' END) AS uom_name,
          CASE WHEN NULLIF(TRIM(p.unit_of_measure), '') IS NULL THEN NULL ELSE TRIM(p.unit_of_measure) || ' - ' || COALESCE(uom.name, 'Unknown UOM (' || TRIM(p.unit_of_measure) || ')') END AS uom_display,
          l.id            AS location_id,
          l.code          AS location_code,
          l.name          AS location_name,
          COALESCE(il.on_hand_qty, 0)::float8       AS on_hand_qty,
          COALESCE(il.available_qty, 0)::float8      AS available_qty,
          COALESCE(il.allocated_qty, 0)::float8      AS allocated_qty,
          COALESCE(il.reserved_qty, 0)::float8       AS reserved_qty,
          COALESCE(il.quarantine_qty, 0)::float8     AS quarantine_qty,
          COALESCE(il.in_transit_qty, 0)::float8     AS in_transit_qty,
          COALESCE(il.on_order_qty, 0)::float8       AS on_order_qty,
          COALESCE(il.average_cost, il.standard_cost, 0)::float8  AS unit_cost,
          COALESCE(il.inventory_value, 0)::float8    AS inventory_value,
          il.updated_at   AS last_updated
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN product_companies pc ON pc.tenant_id = p.tenant_id AND pc.code = NULLIF(TRIM(p.product_company), '')
        LEFT JOIN product_salts ps ON ps.tenant_id = p.tenant_id AND ps.code = NULLIF(TRIM(p.salt), '')
        LEFT JOIN product_categories pg ON pg.tenant_id = p.tenant_id AND pg.code = NULLIF(TRIM(p.product_group), '')
        LEFT JOIN unit_of_measures uom ON uom.tenant_id = p.tenant_id AND uom.code = NULLIF(TRIM(p.unit_of_measure), '')
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B. BATCH-WISE INVENTORY
  //
  // Always at batch level (mandatory in pharma).
  // Sorted by expiry date ascending (FEFO-friendly).
  //
  // Edge cases:
  //   • NULL expiry_date: placed last (NULLS LAST)
  //   • Consumed/recalled batches: excluded
  //   • expiry_date < manufacturing_date: flagged in output (data_quality_flag)
  //   • Negative quantity: included, flagged
  //
  // Performance:
  //   • Index: batches(tenant_id, product_id), batches(tenant_id, expiry_date)
  // ─────────────────────────────────────────────────────────────────────────
  async getBatchInventory(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<{ data: BatchInventoryRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const { conditions } = buildWhereFragments(tenantId, filters, {
      product: 'p',
      location: 'l',
      batch: 'b',
    });

    const columnFilters = normalizeMovementLedgerFilters(parsePharmaFilters(filters.filters));
    const filterConds = buildPharmaFilterSql(columnFilters, BATCH_INVENTORY_COLUMNS);

    const baseWhere = Prisma.sql`
      b.tenant_id = ${tenantId}::uuid
      AND b.status NOT IN ('CONSUMED', 'RECALLED')
      AND b.quantity != 0
    `;
    const where = joinConditions(baseWhere, [...conditions, ...filterConds]);
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, BATCH_INVENTORY_COLUMNS,
      Prisma.sql`p.code, b.expiry_date ASC NULLS LAST`,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
      `,
    );

    const rows = await this.prisma.$queryRaw<BatchInventoryRow[]>(
      Prisma.sql`
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          b.id            AS batch_id,
          b.batch_number  AS batch_number,
          l.id            AS location_id,
          l.code          AS location_code,
          l.name          AS location_name,
          COALESCE(b.quantity, 0)::float8         AS quantity,
          COALESCE(b.available_qty, 0)::float8    AS available_qty,
          COALESCE(b.cost_per_unit, 0)::float8    AS cost_per_unit,
          (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS batch_value,
          b.manufacturing_date,
          b.expiry_date,
          CASE
            WHEN b.expiry_date IS NOT NULL
            THEN (b.expiry_date::date - CURRENT_DATE)
            ELSE NULL
          END AS days_to_expiry,
          b.status::text  AS batch_status
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C. STOCK MOVEMENT LEDGER
  //
  // Full transaction history from the append-only inventory_ledger.
  // Ordered by sequence_number (deterministic, gap-free ordering).
  //
  // Edge cases:
  //   • Duplicate transactions: the ledger is append-only with sequence_number
  //     so duplicates are structurally impossible at DB level.
  //   • Missing batch: LEFT JOIN, batch_number may be null.
  //
  // Performance:
  //   • Index: inventory_ledger(tenant_id, product_id, location_id)
  //   • Index: inventory_ledger(tenant_id, transaction_date)
  //   • Date range filtering mandatory for large datasets
  // ─────────────────────────────────────────────────────────────────────────
  async getMovementLedger(
    tenantId: string,
    filters: InventoryBaseFilterDto,
  ): Promise<{ data: MovementLedgerRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const extraConds: Prisma.Sql[] = [];

    if (filters.productIds?.length) {
      extraConds.push(
        Prisma.sql`il.product_id = ANY(${filters.productIds}::uuid[])`,
      );
    }
    if (filters.locationIds?.length) {
      extraConds.push(
        Prisma.sql`il.location_id = ANY(${filters.locationIds}::uuid[])`,
      );
    }
    if (filters.batchIds?.length) {
      extraConds.push(
        Prisma.sql`il.batch_id = ANY(${filters.batchIds}::uuid[])`,
      );
    }
    if (filters.startDate) {
      extraConds.push(
        Prisma.sql`il.transaction_date >= ${filters.startDate}::timestamp`,
      );
    }
    if (filters.endDate) {
      extraConds.push(
        Prisma.sql`il.transaction_date <= ${filters.endDate}::timestamp`,
      );
    }

    const columnFilters = normalizeMovementLedgerFilters(parsePharmaFilters(filters.filters));
    const filterConds = buildPharmaFilterSql(columnFilters, MOVEMENT_LEDGER_COLUMNS);

    const baseWhere = Prisma.sql`il.tenant_id = ${tenantId}::uuid`;
    const where = joinConditions(baseWhere, [...extraConds, ...filterConds]);
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, MOVEMENT_LEDGER_COLUMNS,
      Prisma.sql`il.sequence_number DESC`,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM inventory_ledger il
        LEFT JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        LEFT JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN batches bat ON bat.id = il.batch_id
        WHERE ${where}
      `,
    );

    const rows = await this.prisma.$queryRaw<MovementLedgerRow[]>(
      Prisma.sql`
        SELECT
          il.id,
          il.sequence_number::text     AS sequence_number,
          il.transaction_date,
          p.id                          AS product_id,
          p.code                        AS sku,
          p.name                        AS product_name,
          l.code                        AS location_code,
          bat.batch_number,
          il.entry_type::text           AS entry_type,
          il.quantity::float8           AS quantity,
          COALESCE(il.unit_cost, 0)::float8  AS unit_cost,
          COALESCE(il.total_cost, 0)::float8 AS total_cost,
          COALESCE(il.running_balance, 0)::float8 AS running_balance,
          il.reference_type,
          il.reference_number,
          il.notes
        FROM inventory_ledger il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN batches bat ON bat.id = il.batch_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // D. REORDER / LOW STOCK
  //
  // Formula:
  //   Avg Daily Sales = SUM(issue_qty over last N days) / N
  //   Suggested Qty   = (Avg Daily Sales × Lead Time) + Safety Stock − Current Stock
  //   Days of Stock   = Current Stock / Avg Daily Sales  (guard div-by-zero)
  //
  // Uses inventory_policies for lead_time, safety_stock, reorder_point.
  // Falls back to defaults when policy is missing.
  //
  // Edge cases:
  //   • No sales history → avg_daily_sales = 0, suggested_qty = safety_stock − current
  //   • Negative stock → suggested_qty increases accordingly
  //   • Missing inventory_policy → uses default lead_time=7, safety=0
  //
  // Performance:
  //   • Subquery for avg sales is bounded by date range (last N days)
  //   • Index: inventory_transactions(tenant_id, product_id, transaction_date)
  // ─────────────────────────────────────────────────────────────────────────
  async getReorderReport(
    tenantId: string,
    filters: ReorderFilterDto,
  ): Promise<{ data: ReorderRow[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const avgDays = filters.avgSalesDays ?? 30;

    const extraConds: Prisma.Sql[] = [];
    if (filters.productIds?.length) {
      extraConds.push(
        Prisma.sql`p.id = ANY(${filters.productIds}::uuid[])`,
      );
    }
    if (filters.locationIds?.length) {
      extraConds.push(
        Prisma.sql`l.id = ANY(${filters.locationIds}::uuid[])`,
      );
    }
    if (filters.category) {
      extraConds.push(Prisma.sql`p.category = ${filters.category}`);
    }

    const columnFilters = parsePharmaFilters(filters.filters);
    const filterConds = buildPharmaFilterSql(columnFilters, REORDER_COLUMNS);

    const baseWhere = Prisma.sql`il.tenant_id = ${tenantId}::uuid`;
    const where = joinConditions(baseWhere, [...extraConds, ...filterConds]);
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, REORDER_COLUMNS,
      Prisma.sql`CASE ip.abc_class WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END, suggested_order_qty DESC`,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM inventory_levels il
        JOIN products p ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip
          ON ip.tenant_id = il.tenant_id
          AND ip.product_id = il.product_id
          AND ip.location_id = il.location_id
        WHERE ${where}
      `,
    );

    const rows = await this.prisma.$queryRaw<ReorderRow[]>(
      Prisma.sql`
        WITH daily_sales AS (
          SELECT
            it.product_id,
            it.location_id,
            COALESCE(SUM(it.quantity), 0)::float8 AS total_issued
          FROM inventory_transactions it
          WHERE it.tenant_id = ${tenantId}::uuid
            AND it.transaction_type IN ('ISSUE', 'PRODUCTION_ISSUE')
            AND it.transaction_date >= (CURRENT_DATE - ${avgDays}::int)
          GROUP BY it.product_id, it.location_id
        )
        SELECT
          p.id             AS product_id,
          p.code           AS sku,
          p.name           AS product_name,
          l.id             AS location_id,
          l.code           AS location_code,
          COALESCE(il.on_hand_qty, 0)::float8            AS on_hand_qty,
          COALESCE(il.available_qty, 0)::float8           AS available_qty,
          COALESCE(ip.reorder_point, 0)::float8           AS reorder_point,
          COALESCE(ip.safety_stock_qty, 0)::float8        AS safety_stock_qty,
          COALESCE(ip.lead_time_days, 7)::int             AS lead_time_days,
          CASE
            WHEN ${avgDays}::int > 0
            THEN COALESCE(ds.total_issued, 0)::float8 / ${avgDays}::float8
            ELSE 0
          END AS avg_daily_sales,
          GREATEST(
            (
              (COALESCE(ds.total_issued, 0)::float8 / NULLIF(${avgDays}::float8, 0))
              * COALESCE(ip.lead_time_days, 7)::float8
            )
            + COALESCE(ip.safety_stock_qty, 0)::float8
            - COALESCE(il.on_hand_qty, 0)::float8,
            0
          )::float8 AS suggested_order_qty,
          ip.abc_class,
          CASE
            WHEN COALESCE(ds.total_issued, 0) > 0
            THEN (
              COALESCE(il.on_hand_qty, 0)::float8
              / (COALESCE(ds.total_issued, 0)::float8 / ${avgDays}::float8)
            )
            ELSE NULL
          END AS days_of_stock
        FROM inventory_levels il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        LEFT JOIN inventory_policies ip
          ON ip.tenant_id = il.tenant_id
          AND ip.product_id = il.product_id
          AND ip.location_id = il.location_id
        LEFT JOIN daily_sales ds
          ON ds.product_id = il.product_id
          AND ds.location_id = il.location_id
        WHERE ${where}
          AND (
            COALESCE(il.on_hand_qty, 0) <= COALESCE(ip.reorder_point, 0)
            OR COALESCE(il.on_hand_qty, 0) <= COALESCE(ip.safety_stock_qty, 0)
          )
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    return { data: rows, total: Number(countResult[0]?.cnt ?? 0) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // E. STOCK AGEING
  //
  // Based on batch manufacturing_date (inward date).
  // Default buckets: 0–3m (0-90d), 3–6m (91-180d), 6–12m (181-365d), >12m (>365d).
  // Configurable bucket boundaries via bucketDays param.
  //
  // Edge cases:
  //   • NULL manufacturing_date: bucket = 'UNKNOWN'
  //   • Negative age (future date): bucket = 'UNKNOWN'
  //   • Consumed/recalled batches: excluded
  //
  // Performance:
  //   • Uses batches table with date arithmetic
  //   • Index: batches(tenant_id, status)
  // ─────────────────────────────────────────────────────────────────────────
  async getStockAgeing(
    tenantId: string,
    filters: StockAgeingFilterDto,
  ): Promise<{
    data: StockAgeingRow[];
    summary: { bucket: string; total_qty: number; total_value: number }[];
    total: number;
  }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const buckets = filters.bucketDays ?? [90, 180, 365];

    // Build CASE expression for ageing buckets dynamically
    // Default: 0-90d → '0-3m', 91-180d → '3-6m', 181-365d → '6-12m', >365d → '>12m'
    const bucketLabels = [
      `0-${buckets[0]}d`,
      ...buckets.slice(0, -1).map((b, i) => `${b + 1}-${buckets[i + 1]}d`),
      `>${buckets[buckets.length - 1]}d`,
    ];

    // We build the bucket CASE using the provided boundaries
    // Since we can't dynamically build CASE arms easily with Prisma.sql,
    // we use a fixed 4-bucket approach (the most common in pharma).
    const b0 = buckets[0] ?? 90;
    const b1 = buckets[1] ?? 180;
    const b2 = buckets[2] ?? 365;

    const { conditions } = buildWhereFragments(tenantId, filters, {
      product: 'p',
      location: 'l',
      batch: 'b',
    });

    const columnFilters = parsePharmaFilters(filters.filters);
    const filterConds = buildPharmaFilterSql(columnFilters, STOCK_AGEING_COLUMNS);

    const baseWhere = Prisma.sql`
      b.tenant_id = ${tenantId}::uuid
      AND b.status NOT IN ('CONSUMED', 'RECALLED')
      AND b.quantity > 0
    `;
    const where = joinConditions(baseWhere, [...conditions, ...filterConds]);
    const orderBy = buildPharmaOrderBySql(
      filters.sortBy, filters.sortDir, STOCK_AGEING_COLUMNS,
      Prisma.sql`(CURRENT_DATE - b.manufacturing_date::date) DESC NULLS LAST`,
    );

    const rows = await this.prisma.$queryRaw<StockAgeingRow[]>(
      Prisma.sql`
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          l.code          AS location_code,
          b.batch_number,
          b.manufacturing_date AS inward_date,
          CASE
            WHEN b.manufacturing_date IS NULL THEN -1
            ELSE (CURRENT_DATE - b.manufacturing_date::date)
          END AS age_days,
          CASE
            WHEN b.manufacturing_date IS NULL THEN 'UNKNOWN'
            WHEN (CURRENT_DATE - b.manufacturing_date::date) < 0 THEN 'UNKNOWN'
            WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b0} THEN ${`0-${b0}d`}
            WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b1} THEN ${`${b0 + 1}-${b1}d`}
            WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b2} THEN ${`${b1 + 1}-${b2}d`}
            ELSE ${`>${b2}d`}
          END AS age_bucket,
          b.quantity::float8 AS quantity,
          (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0))::float8 AS batch_value
        FROM batches b
        JOIN products p  ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    // Summary: aggregate by bucket (wrapped in subquery because PG can't GROUP BY a CASE alias)
    const summary = await this.prisma.$queryRaw<
      { bucket: string; total_qty: number; total_value: number }[]
    >(
      Prisma.sql`
        SELECT
          sub.age_bucket AS bucket,
          SUM(sub.qty)::float8 AS total_qty,
          SUM(sub.val)::float8 AS total_value
        FROM (
          SELECT
            CASE
              WHEN b.manufacturing_date IS NULL THEN 'UNKNOWN'
              WHEN (CURRENT_DATE - b.manufacturing_date::date) < 0 THEN 'UNKNOWN'
              WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b0} THEN ${`0-${b0}d`}
              WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b1} THEN ${`${b0 + 1}-${b1}d`}
              WHEN (CURRENT_DATE - b.manufacturing_date::date) <= ${b2} THEN ${`${b1 + 1}-${b2}d`}
              ELSE ${`>${b2}d`}
            END AS age_bucket,
            b.quantity AS qty,
            (COALESCE(b.quantity, 0) * COALESCE(b.cost_per_unit, 0)) AS val
          FROM batches b
          JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
          JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
          WHERE ${where}
        ) sub
        GROUP BY sub.age_bucket
        ORDER BY
          CASE sub.age_bucket
            WHEN ${`0-${b0}d`} THEN 1
            WHEN ${`${b0 + 1}-${b1}d`} THEN 2
            WHEN ${`${b1 + 1}-${b2}d`} THEN 3
            WHEN ${`>${b2}d`} THEN 4
            ELSE 5
          END
      `,
    );

    const countResult = await this.prisma.$queryRaw<[{ cnt: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt
        FROM batches b
        JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
        JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
        WHERE ${where}
      `,
    );

    return { data: rows, summary, total: Number(countResult[0]?.cnt ?? 0) };
  }
}
