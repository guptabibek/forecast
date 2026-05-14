import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GoodsReceiptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { parseFiltersParam } from '../../../core/filtering/filter.util';

/**
 * Purchase Invoices domain service.
 *
 * Surfaces vendor invoices (Purchase Invoices / Purchase Bills) as a first-class
 * domain. The underlying storage is the goods_receipts table — Marg PI sync lands
 * GRN rows tagged with VCN / voucher / orn metadata in `notes`. The domain
 * boundary is held here so downstream consumers (UI, reports) reason in terms of
 * invoices, not GRNs.
 */

const MARG_GOODS_RECEIPT_PREFIX = 'MARG-GRN-';
const MARG_SYNC_GOODS_RECEIPT_MARKER = '[MARG_SYNC_GRN]';
const MARG_MIN_VALID_ORDER_DATE = new Date('1901-01-01T00:00:00.000Z');

export type PurchaseInvoiceListItem = {
  id: string;
  invoiceNumber: string;
  documentDate: string | null;
  orderDate: string | null;
  status: string;
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  supplierGstn: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  voucher: string | null;
  vcn: string | null;
  orn: string | null;
  companyId: number | null;
  totalAmount: number;
  totalQty: number;
  lineCount: number;
  currency: string;
  notes: string | null;
  source: 'MARG_SYNC' | 'CORE_GRN';
};

export type PurchaseInvoiceLineItem = {
  id: string;
  lineNumber: number;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  uom: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  notes: string | null;
};

export type PurchaseInvoiceDetail = PurchaseInvoiceListItem & {
  receiptNumber: string;
  lines: PurchaseInvoiceLineItem[];
};

export type PurchaseInvoiceListFilters = {
  supplierId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  companyId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: string;
};

const SORTABLE_COLUMNS: Record<string, Prisma.GoodsReceiptOrderByWithRelationInput> = {
  invoiceNumber: { receiptNumber: 'asc' },
  documentDate: { receiptDate: 'asc' },
  status: { status: 'asc' },
  supplierName: { purchaseOrder: { supplier: { name: 'asc' } } },
};

function parseTag(notes: string | null, key: string): string | null {
  if (!notes) return null;
  const re = new RegExp(`${key}=([^\\s]+)`);
  const m = notes.match(re);
  return m ? m[1] : null;
}

function parseCompanyId(notes: string | null): number | null {
  const tag = parseTag(notes, 'company');
  if (!tag) return null;
  const n = parseInt(tag, 10);
  return Number.isFinite(n) ? n : null;
}

function detectSource(receiptNumber: string, notes: string | null): 'MARG_SYNC' | 'CORE_GRN' {
  if (receiptNumber.startsWith(MARG_GOODS_RECEIPT_PREFIX)) return 'MARG_SYNC';
  if (notes && notes.includes(MARG_SYNC_GOODS_RECEIPT_MARKER)) return 'MARG_SYNC';
  return 'CORE_GRN';
}

function deriveDocumentNumber(vcn: string | null, voucher: string | null, receiptNumber: string): string {
  if (vcn && vcn.trim()) return vcn;
  if (voucher && voucher.trim()) return voucher;
  return receiptNumber;
}

@Injectable()
export class PurchaseInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  private dateCondition(field: 'receiptDate', filter: { operator: string; value?: unknown }): Prisma.GoodsReceiptWhereInput {
    const toDate = (value: unknown) => {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException(`Invalid date: ${value}`);
      }
      return date;
    };

    if (filter.operator === 'between') {
      const [from, to] = Array.isArray(filter.value) ? filter.value : [filter.value, filter.value];
      return { [field]: { gte: toDate(from), lte: toDate(to) } };
    }
    if (filter.operator === 'gte' || filter.operator === 'gt') {
      return { [field]: { gte: toDate(filter.value) } };
    }
    if (filter.operator === 'lte' || filter.operator === 'lt') {
      return { [field]: { lte: toDate(filter.value) } };
    }
    return { [field]: { gte: toDate(filter.value), lt: new Date(toDate(filter.value).getTime() + 24 * 60 * 60 * 1000) } };
  }

  async list(
    tenantId: string,
    filters: PurchaseInvoiceListFilters,
  ): Promise<{ items: PurchaseInvoiceListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const skip = (page - 1) * pageSize;

    const where: Prisma.GoodsReceiptWhereInput = { tenantId };

    if (filters.supplierId) {
      where.purchaseOrder = { supplierId: filters.supplierId };
    }
    if (filters.status) {
      const allowed = Object.values(GoodsReceiptStatus) as string[];
      if (allowed.includes(filters.status)) {
        where.status = filters.status as GoodsReceiptStatus;
      }
    }
    if (filters.startDate) {
      where.receiptDate = { ...(where.receiptDate as object), gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      where.receiptDate = { ...(where.receiptDate as object), lte: new Date(filters.endDate) };
    }
    if (filters.search) {
      const s = filters.search;
      where.OR = [
        { receiptNumber: { contains: s, mode: 'insensitive' } },
        { notes: { contains: s, mode: 'insensitive' } },
        { purchaseOrder: { orderNumber: { contains: s, mode: 'insensitive' } } },
        { purchaseOrder: { supplier: { name: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    if (filters.companyId !== undefined && filters.companyId !== null) {
      // companyId is encoded into notes as `company=<n>`; do a substring match.
      where.notes = { contains: `company=${filters.companyId}` };
    }

    const columnFilters = parseFiltersParam(filters.filters);
    const andFilters: Prisma.GoodsReceiptWhereInput[] = [];
    for (const filter of columnFilters) {
      const value = String(filter.value ?? '').trim();
      if (!value && filter.operator !== 'isNull' && filter.operator !== 'isNotNull') continue;

      switch (filter.field) {
        case 'invoiceNumber':
          andFilters.push({
            OR: [
              { receiptNumber: { contains: value, mode: 'insensitive' } },
              { notes: { contains: value, mode: 'insensitive' } },
            ],
          });
          break;
        case 'documentDate':
          andFilters.push(this.dateCondition('receiptDate', filter));
          break;
        case 'supplierName':
          andFilters.push({
            purchaseOrder: { supplier: { name: { contains: value, mode: 'insensitive' } } },
          });
          break;
        case 'purchaseOrderNumber':
          andFilters.push({
            purchaseOrder: { orderNumber: { contains: value, mode: 'insensitive' } },
          });
          break;
        case 'status':
          if (Object.values(GoodsReceiptStatus).includes(value as GoodsReceiptStatus)) {
            andFilters.push({ status: value as GoodsReceiptStatus });
          }
          break;
        case 'source':
          if (value === 'MARG_SYNC') {
            andFilters.push({
              OR: [
                { receiptNumber: { startsWith: MARG_GOODS_RECEIPT_PREFIX } },
                { notes: { contains: MARG_SYNC_GOODS_RECEIPT_MARKER } },
              ],
            });
          } else if (value === 'CORE_GRN') {
            andFilters.push({
              NOT: {
                OR: [
                  { receiptNumber: { startsWith: MARG_GOODS_RECEIPT_PREFIX } },
                  { notes: { contains: MARG_SYNC_GOODS_RECEIPT_MARKER } },
                ],
              },
            });
          }
          break;
        case 'totalAmount':
        case 'totalQty':
        case 'lineCount':
          break;
        default:
          throw new BadRequestException(`Filtering on field '${filter.field}' is not permitted`);
      }
    }
    if (andFilters.length) {
      where.AND = Array.isArray(where.AND) ? [...where.AND, ...andFilters] : andFilters;
    }

    const orderBy = SORTABLE_COLUMNS[filters.sortBy ?? 'documentDate'] ?? SORTABLE_COLUMNS.documentDate;
    if (filters.sortDir === 'desc') {
      // Flip first leaf — orderBy is a single-key object here.
      const key = Object.keys(orderBy)[0] as keyof typeof orderBy;
      (orderBy as any)[key] = (orderBy as any)[key] === 'asc' ? 'desc' : 'asc';
    } else if (!filters.sortDir) {
      // Default: newest first for date sort.
      if (filters.sortBy === undefined || filters.sortBy === 'documentDate') {
        (orderBy as any).receiptDate = 'desc';
      }
    }

    const receipts = await this.prisma.goodsReceipt.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      include: {
        purchaseOrder: {
          select: {
            id: true,
            orderNumber: true,
            orderDate: true,
            currency: true,
            totalAmount: true,
            supplier: {
              select: {
                id: true,
                code: true,
                name: true,
                phone: true,
                address: true,
                attributes: true,
              },
            },
          },
        },
        lines: {
          select: {
            id: true,
            quantity: true,
            productId: true,
            lineNumber: true,
          },
        },
      },
    });
    const total = await this.prisma.goodsReceipt.count({ where });

    // Need PO line unit prices to compute invoice line amounts. Batch-load by purchase_order_id.
    const poIds = Array.from(
      new Set(receipts.map((r) => r.purchaseOrderId).filter((v): v is string => !!v)),
    );
    const poLines = poIds.length
      ? await this.prisma.purchaseOrderLine.findMany({
          where: { purchaseOrderId: { in: poIds } },
          select: { purchaseOrderId: true, lineNumber: true, productId: true, unitPrice: true },
        })
      : [];

    const priceLookup = new Map<string, number>();
    for (const pl of poLines) {
      const key = `${pl.purchaseOrderId}|${pl.productId}|${pl.lineNumber}`;
      priceLookup.set(key, Number(pl.unitPrice ?? 0));
    }

    const items: PurchaseInvoiceListItem[] = receipts.map((r) => {
      const supplier = r.purchaseOrder?.supplier ?? null;
      const attrs = (supplier?.attributes ?? {}) as Record<string, unknown>;
      const voucher = parseTag(r.notes, 'voucher');
      const vcn = parseTag(r.notes, 'vcn');
      const orn = parseTag(r.notes, 'orn');
      const companyId = parseCompanyId(r.notes);

      let totalQty = 0;
      let totalAmount = 0;
      for (const line of r.lines) {
        const qty = Number(line.quantity ?? 0);
        totalQty += qty;
        if (r.purchaseOrderId) {
          const price = priceLookup.get(`${r.purchaseOrderId}|${line.productId}|${line.lineNumber}`) ?? 0;
          totalAmount += qty * price;
        }
      }
      if (totalAmount === 0 && r.purchaseOrder?.totalAmount != null) {
        totalAmount = Number(r.purchaseOrder.totalAmount);
      }

      const orderDate =
        r.purchaseOrder?.orderDate && r.purchaseOrder.orderDate > MARG_MIN_VALID_ORDER_DATE
          ? r.purchaseOrder.orderDate.toISOString()
          : null;

      return {
        id: r.id,
        invoiceNumber: deriveDocumentNumber(vcn, voucher, r.receiptNumber),
        documentDate: r.receiptDate ? r.receiptDate.toISOString() : null,
        orderDate,
        status: r.status,
        supplierId: supplier?.id ?? null,
        supplierCode: supplier?.code ?? null,
        supplierName: supplier?.name ?? null,
        supplierPhone: supplier?.phone ?? null,
        supplierAddress: supplier?.address ?? null,
        supplierGstn: typeof attrs.gstn === 'string' ? (attrs.gstn as string) : null,
        purchaseOrderId: r.purchaseOrderId,
        purchaseOrderNumber: r.purchaseOrder?.orderNumber ?? null,
        voucher,
        vcn,
        orn,
        companyId,
        totalAmount,
        totalQty,
        lineCount: r.lines.length,
        currency: r.purchaseOrder?.currency || 'INR',
        notes: r.notes,
        source: detectSource(r.receiptNumber, r.notes),
      };
    });

    return { items, total, page, pageSize };
  }

  async getById(tenantId: string, id: string): Promise<PurchaseInvoiceDetail> {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id, tenantId },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            orderNumber: true,
            orderDate: true,
            currency: true,
            totalAmount: true,
            supplier: {
              select: {
                id: true,
                code: true,
                name: true,
                phone: true,
                address: true,
                attributes: true,
              },
            },
            lines: {
              select: {
                lineNumber: true,
                productId: true,
                unitPrice: true,
              },
            },
          },
        },
        lines: {
          include: {
            product: { select: { id: true, code: true, name: true } },
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException(`Purchase invoice ${id} not found`);
    }

    const supplier = receipt.purchaseOrder?.supplier ?? null;
    const attrs = (supplier?.attributes ?? {}) as Record<string, unknown>;
    const voucher = parseTag(receipt.notes, 'voucher');
    const vcn = parseTag(receipt.notes, 'vcn');
    const orn = parseTag(receipt.notes, 'orn');
    const companyId = parseCompanyId(receipt.notes);

    const priceLookup = new Map<string, number>();
    for (const pl of receipt.purchaseOrder?.lines ?? []) {
      priceLookup.set(`${pl.productId}|${pl.lineNumber}`, Number(pl.unitPrice ?? 0));
    }

    const lines: PurchaseInvoiceLineItem[] = receipt.lines.map((line) => {
      const qty = Number(line.quantity ?? 0);
      const unitPrice = priceLookup.get(`${line.productId}|${line.lineNumber}`) ?? 0;
      return {
        id: line.id,
        lineNumber: line.lineNumber,
        productId: line.productId,
        productSku: line.product?.code ?? null,
        productName: line.product?.name ?? null,
        quantity: qty,
        unitPrice,
        lineAmount: qty * unitPrice,
        uom: line.uom ?? null,
        lotNumber: line.lotNumber ?? null,
        expiryDate: line.expiryDate ? line.expiryDate.toISOString() : null,
        notes: line.notes ?? null,
      };
    });

    const totalAmount =
      lines.reduce((sum, l) => sum + l.lineAmount, 0) ||
      Number(receipt.purchaseOrder?.totalAmount ?? 0);
    const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);

    const orderDate =
      receipt.purchaseOrder?.orderDate && receipt.purchaseOrder.orderDate > MARG_MIN_VALID_ORDER_DATE
        ? receipt.purchaseOrder.orderDate.toISOString()
        : null;

    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      invoiceNumber: deriveDocumentNumber(vcn, voucher, receipt.receiptNumber),
      documentDate: receipt.receiptDate ? receipt.receiptDate.toISOString() : null,
      orderDate,
      status: receipt.status,
      supplierId: supplier?.id ?? null,
      supplierCode: supplier?.code ?? null,
      supplierName: supplier?.name ?? null,
      supplierPhone: supplier?.phone ?? null,
      supplierAddress: supplier?.address ?? null,
      supplierGstn: typeof attrs.gstn === 'string' ? (attrs.gstn as string) : null,
      purchaseOrderId: receipt.purchaseOrderId,
      purchaseOrderNumber: receipt.purchaseOrder?.orderNumber ?? null,
      voucher,
      vcn,
      orn,
      companyId,
      totalAmount,
      totalQty,
      lineCount: lines.length,
      currency: receipt.purchaseOrder?.currency || 'INR',
      notes: receipt.notes,
      source: detectSource(receipt.receiptNumber, receipt.notes),
      lines,
    };
  }
}
