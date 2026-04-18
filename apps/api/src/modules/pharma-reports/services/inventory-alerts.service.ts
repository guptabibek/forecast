// ============================================================================
// INVENTORY ALERT LOGIC SERVICE
// Covers: Near Expiry Alerts, Low Stock Alerts (A-class), Newly Expired Alerts
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { AlertConfigDto } from '../dto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AlertItem {
  alert_type: 'NEAR_EXPIRY' | 'LOW_STOCK' | 'NEWLY_EXPIRED';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  product_id: string;
  sku: string;
  product_name: string;
  location_code: string;
  batch_number: string | null;
  message: string;
  value_at_risk: number;
  details: Record<string, unknown>;
}

@Injectable()
export class InventoryAlertsService {
  private readonly logger = new Logger(InventoryAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // GET ALL ACTIVE ALERTS
  //
  // Runs all three alert checks in parallel and returns a combined, sorted
  // result ordered by severity (CRITICAL → HIGH → MEDIUM → LOW) then value.
  //
  // This is designed to be called periodically (cron) or on-demand from the
  // dashboard. No external integrations — returns data only.
  //
  // Edge cases:
  //   • Overlapping alerts (near-expiry AND low-stock) → both returned
  //   • Deduplication by product+location+alert_type
  // ─────────────────────────────────────────────────────────────────────────
  async getActiveAlerts(
    tenantId: string,
    config: AlertConfigDto = {},
  ): Promise<AlertItem[]> {
    const alertLimit = config.alertLimit ?? 200;
    const [nearExpiry, lowStock, newlyExpired] = await Promise.all([
      this.getNearExpiryAlerts(tenantId, config.nearExpiryDays ?? 90, alertLimit),
      this.getLowStockAlerts(tenantId, config.aClassOnly ?? true, alertLimit),
      this.getNewlyExpiredAlerts(tenantId, alertLimit),
    ]);

    const allAlerts = [...nearExpiry, ...lowStock, ...newlyExpired];

    // Sort: CRITICAL first, then by value_at_risk descending
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    allAlerts.sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.value_at_risk - a.value_at_risk;
    });

    return allAlerts;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEAR EXPIRY ALERTS
  //
  // Trigger: batch expiry_date within threshold AND batch has stock.
  // Severity:
  //   CRITICAL: ≤ 15 days
  //   HIGH:     16–30 days
  //   MEDIUM:   31–90 days
  //   LOW:      91–threshold days
  // ─────────────────────────────────────────────────────────────────────────
  private async getNearExpiryAlerts(
    tenantId: string,
    thresholdDays: number,
    alertLimit: number = 200,
  ): Promise<AlertItem[]> {
    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        sku: string;
        product_name: string;
        location_code: string;
        batch_number: string;
        remaining_days: number;
        quantity: number;
        value_at_risk: number;
        expiry_date: Date;
      }[]
    >(
      Prisma.sql`
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          l.code          AS location_code,
          b.batch_number,
          (b.expiry_date::date - CURRENT_DATE) AS remaining_days,
          b.quantity::float8,
          (b.quantity * COALESCE(b.cost_per_unit, 0))::float8 AS value_at_risk,
          b.expiry_date
        FROM batches b
        JOIN products p  ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE b.tenant_id = ${tenantId}::uuid
          AND b.expiry_date IS NOT NULL
          AND b.expiry_date::date >= CURRENT_DATE
          AND b.expiry_date::date <= (CURRENT_DATE + ${thresholdDays}::int)
          AND b.quantity > 0
          AND b.status NOT IN ('CONSUMED', 'RECALLED')
        ORDER BY remaining_days ASC
        LIMIT ${alertLimit}
      `,
    );

    return rows.map((r) => ({
      alert_type: 'NEAR_EXPIRY' as const,
      severity: this.expiryAlertSeverity(r.remaining_days),
      product_id: r.product_id,
      sku: r.sku,
      product_name: r.product_name,
      location_code: r.location_code,
      batch_number: r.batch_number,
      message: `Batch ${r.batch_number} expires in ${r.remaining_days} days (${new Date(r.expiry_date).toISOString().slice(0, 10)})`,
      value_at_risk: r.value_at_risk,
      details: {
        remaining_days: r.remaining_days,
        quantity: r.quantity,
        expiry_date: r.expiry_date,
      },
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOW STOCK ALERTS (A-category only by default)
  //
  // Trigger: on_hand_qty < reorder_point AND abc_class = 'A' (configurable).
  // Severity:
  //   CRITICAL: stock = 0
  //   HIGH:     stock < safety_stock_qty
  //   MEDIUM:   stock < reorder_point
  // ─────────────────────────────────────────────────────────────────────────
  private async getLowStockAlerts(
    tenantId: string,
    aClassOnly: boolean,
    alertLimit: number = 200,
  ): Promise<AlertItem[]> {
    const abcFilter = aClassOnly
      ? Prisma.sql`AND ip.abc_class = 'A'`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        sku: string;
        product_name: string;
        location_code: string;
        on_hand_qty: number;
        reorder_point: number;
        safety_stock_qty: number;
        inventory_value: number;
        abc_class: string;
      }[]
    >(
      Prisma.sql`
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          l.code          AS location_code,
          COALESCE(il.on_hand_qty, 0)::float8        AS on_hand_qty,
          COALESCE(ip.reorder_point, 0)::float8      AS reorder_point,
          COALESCE(ip.safety_stock_qty, 0)::float8   AS safety_stock_qty,
          COALESCE(il.inventory_value, 0)::float8    AS inventory_value,
          ip.abc_class
        FROM inventory_levels il
        JOIN products p  ON p.id = il.product_id AND p.tenant_id = il.tenant_id
        JOIN locations l ON l.id = il.location_id AND l.tenant_id = il.tenant_id
        JOIN inventory_policies ip
          ON ip.tenant_id = il.tenant_id
          AND ip.product_id = il.product_id
          AND ip.location_id = il.location_id
        WHERE il.tenant_id = ${tenantId}::uuid
          AND COALESCE(il.on_hand_qty, 0) < COALESCE(ip.reorder_point, 0)
          AND COALESCE(ip.reorder_point, 0) > 0
          ${abcFilter}
        ORDER BY il.on_hand_qty ASC
        LIMIT ${alertLimit}
      `,
    );

    return rows.map((r) => {
      let severity: AlertItem['severity'];
      if (r.on_hand_qty <= 0) severity = 'CRITICAL';
      else if (r.on_hand_qty < r.safety_stock_qty) severity = 'HIGH';
      else severity = 'MEDIUM';

      return {
        alert_type: 'LOW_STOCK' as const,
        severity,
        product_id: r.product_id,
        sku: r.sku,
        product_name: r.product_name,
        location_code: r.location_code,
        batch_number: null,
        message: `Stock at ${r.on_hand_qty} units, below reorder point of ${r.reorder_point} (ABC: ${r.abc_class})`,
        value_at_risk: r.inventory_value,
        details: {
          on_hand_qty: r.on_hand_qty,
          reorder_point: r.reorder_point,
          safety_stock_qty: r.safety_stock_qty,
          abc_class: r.abc_class,
        },
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEWLY EXPIRED ALERTS
  //
  // Trigger: batch expired in the last 7 days AND still has stock.
  // Severity: CRITICAL (newly expired stock requires immediate action).
  // ─────────────────────────────────────────────────────────────────────────
  private async getNewlyExpiredAlerts(tenantId: string, alertLimit: number = 200): Promise<AlertItem[]> {
    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        sku: string;
        product_name: string;
        location_code: string;
        batch_number: string;
        days_expired: number;
        quantity: number;
        value_at_risk: number;
        expiry_date: Date;
      }[]
    >(
      Prisma.sql`
        SELECT
          p.id            AS product_id,
          p.code          AS sku,
          p.name          AS product_name,
          l.code          AS location_code,
          b.batch_number,
          (CURRENT_DATE - b.expiry_date::date) AS days_expired,
          b.quantity::float8,
          (b.quantity * COALESCE(b.cost_per_unit, 0))::float8 AS value_at_risk,
          b.expiry_date
        FROM batches b
        JOIN products p  ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
        WHERE b.tenant_id = ${tenantId}::uuid
          AND b.expiry_date IS NOT NULL
          AND b.expiry_date::date < CURRENT_DATE
          AND b.expiry_date::date >= (CURRENT_DATE - 7)
          AND b.quantity > 0
          AND b.status NOT IN ('CONSUMED', 'RECALLED')
        ORDER BY days_expired ASC, value_at_risk DESC
        LIMIT ${alertLimit}
      `,
    );

    return rows.map((r) => ({
      alert_type: 'NEWLY_EXPIRED' as const,
      severity: 'CRITICAL' as const,
      product_id: r.product_id,
      sku: r.sku,
      product_name: r.product_name,
      location_code: r.location_code,
      batch_number: r.batch_number,
      message: `Batch ${r.batch_number} expired ${r.days_expired} day(s) ago with ${r.quantity} units still in stock`,
      value_at_risk: r.value_at_risk,
      details: {
        days_expired: r.days_expired,
        quantity: r.quantity,
        expiry_date: r.expiry_date,
      },
    }));
  }

  private expiryAlertSeverity(
    remainingDays: number,
  ): AlertItem['severity'] {
    if (remainingDays <= 15) return 'CRITICAL';
    if (remainingDays <= 30) return 'HIGH';
    if (remainingDays <= 90) return 'MEDIUM';
    return 'LOW';
  }
}
