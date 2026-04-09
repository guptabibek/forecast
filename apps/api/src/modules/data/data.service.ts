import { InjectQueue } from '@nestjs/bullmq';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { FileType, ImportStatus, Prisma, ImportType as PrismaImportType } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/database/prisma.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { ActualsQueryDto } from './dto/actuals-query.dto';
import { CreateDimensionDto } from './dto/create-dimension.dto';
import { DimensionQueryDto } from './dto/dimension-query.dto';
import { ImportDataDto } from './dto/import-data.dto';
import { UpdateDimensionDto } from './dto/update-dimension.dto';

@Injectable()
export class DataService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.IMPORT) private readonly importQueue: Queue,
  ) {}

  // ==================== IMPORTS ====================

  async importFile(
    file: Express.Multer.File,
    importDto: ImportDataDto,
    user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file type
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Please upload CSV or Excel file.');
    }

    // Determine file type
    let fileType: FileType = FileType.CSV;
    if (file.mimetype.includes('spreadsheetml') || file.mimetype.includes('ms-excel')) {
      fileType = FileType.XLSX;
    }

    // Map import type
    const importTypeMap: Record<string, PrismaImportType> = {
      actuals: PrismaImportType.SALES,
      products: PrismaImportType.PRODUCTS,
      locations: PrismaImportType.SALES,
      customers: PrismaImportType.SALES,
      accounts: PrismaImportType.FINANCIALS,
    };

    // Create import job record
    const dataImport = await this.prisma.dataImport.create({
      data: {
        tenant: { connect: { id: user.tenantId } },
        fileName: file.originalname,
        fileType: fileType,
        fileSize: file.size,
        importType: importTypeMap[importDto.type] || PrismaImportType.SALES,
        status: ImportStatus.PENDING,
        columnMapping: importDto.mapping || {},
      },
    });

    // Queue the import job
    await this.importQueue.add(
      'process-import',
      {
        jobId: dataImport.id,
        tenantId: user.tenantId,
        userId: user.id,
        type: importDto.type,
        filePath: file.path,
        fileName: file.originalname,
        mapping: importDto.mapping,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return {
      id: dataImport.id,
      status: 'queued',
      message: 'Import job queued for processing',
    };
  }

  async getImportHistory(user: any) {
    return this.prisma.dataImport.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getImportStatus(id: string, user: any) {
    const job = await this.prisma.dataImport.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!job) {
      throw new NotFoundException('Import job not found');
    }

    return job;
  }

  async cancelImport(id: string, user: any) {
    const importJob = await this.getImportStatus(id, user);
    const cancellableStatuses: ImportStatus[] = [
      ImportStatus.PENDING,
      ImportStatus.VALIDATING,
      ImportStatus.PROCESSING,
    ];

    if (!cancellableStatuses.includes(importJob.status)) {
      return {
        message: 'Import cannot be cancelled',
        id,
        status: importJob.status,
        cancelled: false,
      };
    }

    const queueJobs = await this.importQueue.getJobs(['waiting', 'delayed', 'prioritized', 'active']);
    const queueJob = queueJobs.find((job) => (job.data as { jobId?: string })?.jobId === id);

    if (queueJob) {
      const state = await queueJob.getState();
      if (state === 'active') {
        return {
          message: 'Import is already processing and cannot be force-cancelled',
          id,
          status: importJob.status,
          cancelled: false,
        };
      }
      await queueJob.remove();
    }

    const existingErrors = Array.isArray(importJob.errors)
      ? (importJob.errors as Array<Record<string, unknown>>)
      : [];

    const updated = await this.prisma.dataImport.update({
      where: { id },
      data: {
        status: ImportStatus.FAILED,
        completedAt: new Date(),
        errors: [
          ...existingErrors.slice(0, 99),
          {
            row: 0,
            message: 'Import cancelled by user',
            cancelledAt: new Date().toISOString(),
          },
        ] as any,
      },
    });

    return {
      message: 'Import cancelled',
      id,
      status: updated.status,
      cancelled: true,
    };
  }

  async getSyncStatus(user: any) {
    const inProgressStatuses = [ImportStatus.PENDING, ImportStatus.VALIDATING, ImportStatus.PROCESSING];

    const [lastCompletedImport, inProgressImports, recentImports] = await Promise.all([
      this.prisma.dataImport.findFirst({
        where: {
          tenantId: user.tenantId,
          status: ImportStatus.COMPLETED,
        },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
      this.prisma.dataImport.findMany({
        where: {
          tenantId: user.tenantId,
          status: { in: inProgressStatuses },
        },
        select: {
          status: true,
          totalRows: true,
          processedRows: true,
        },
      }),
      this.prisma.dataImport.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          importType: true,
          status: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);

    const pendingRecords = inProgressImports.reduce((sum, item) => {
      const total = item.totalRows ?? 0;
      const processed = item.processedRows ?? 0;
      return sum + Math.max(total - processed, 0);
    }, 0);

    const sourceMap = new Map<string, {
      source: string;
      status: string;
      lastSyncAt: string | null;
    }>();

    for (const item of recentImports) {
      const source = item.importType;
      if (sourceMap.has(source)) {
        continue;
      }
      sourceMap.set(source, {
        source,
        status: item.status,
        lastSyncAt: item.completedAt?.toISOString() || item.createdAt.toISOString(),
      });
    }

    return {
      lastSync: lastCompletedImport?.completedAt?.toISOString() || null,
      status: inProgressImports.length > 0 ? 'processing' : 'idle',
      sources: Array.from(sourceMap.values()),
      pendingRecords,
    };
  }

  async triggerSync(user: any) {
    const jobId = randomUUID();
    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'IMPORT',
        entityType: 'DATA_SYNC',
        entityId: jobId,
        changedFields: [],
        metadata: {
          triggeredBy: user.id,
          requestedAt: new Date().toISOString(),
          mode: 'manual',
        },
      },
    });

    return {
      jobId,
      status: 'queued',
      message: 'Sync request recorded. Configure connectors to process external sync jobs.',
    };
  }

  generateTemplate(type: string): string {
    const templates: Record<string, string> = {
      actuals: 'period_date,product_code,location_code,customer_code,account_code,amount,quantity\n2024-01-01,PROD-001,LOC-001,CUST-001,ACC-001,10000,100',
      products: 'code,name,description,category,list_price\nPROD-001,Product 1,Description,Electronics,99.99',
      locations: 'code,name,region,country,type\nLOC-001,Location 1,North America,USA,WAREHOUSE',
      customers: 'code,name,segment,type\nCUST-001,Customer 1,Enterprise,DIRECT',
      accounts: 'code,name,type,category\nACC-001,Revenue,REVENUE,Sales',
    };

    return templates[type] || templates.actuals;
  }

  /**
   * Get structured import template with column definitions for frontend display
   */
  getImportTemplateInfo(type: string): {
    type: string;
    columns: { name: string; required: boolean; type: string; description: string; format?: string }[];
    sampleData: Record<string, string>[];
  } {
    const templateDefinitions: Record<string, {
      columns: { name: string; required: boolean; type: string; description: string; format?: string }[];
      sampleData: Record<string, string>[];
    }> = {
      actuals: {
        columns: [
          { name: 'period_date', required: true, type: 'date', description: 'Period date for the actual', format: 'YYYY-MM-DD' },
          { name: 'product_code', required: false, type: 'string', description: 'Optional product code. If provided, it must already exist in Products' },
          { name: 'location_code', required: false, type: 'string', description: 'Optional location code. If provided, it must already exist in Locations' },
          { name: 'customer_code', required: false, type: 'string', description: 'Optional customer code. If provided, it must already exist in Customers' },
          { name: 'account_code', required: false, type: 'string', description: 'Optional account code. If provided, it must already exist in Accounts' },
          { name: 'amount', required: true, type: 'number', description: 'Monetary amount' },
          { name: 'quantity', required: false, type: 'number', description: 'Quantity (units sold/purchased)' },
        ],
        sampleData: [
          { period_date: '2024-01-01', product_code: 'PROD-001', location_code: 'LOC-001', customer_code: 'CUST-001', account_code: 'ACC-001', amount: '10000', quantity: '100' },
          { period_date: '2024-02-01', product_code: 'PROD-002', location_code: 'LOC-002', customer_code: 'CUST-002', account_code: 'ACC-001', amount: '15000', quantity: '150' },
        ],
      },
      products: {
        columns: [
          { name: 'code', required: true, type: 'string', description: 'Unique product code' },
          { name: 'name', required: true, type: 'string', description: 'Product name' },
          { name: 'description', required: false, type: 'string', description: 'Product description' },
          { name: 'category', required: false, type: 'string', description: 'Product category' },
          { name: 'list_price', required: false, type: 'number', description: 'Standard list price' },
        ],
        sampleData: [
          { code: 'PROD-001', name: 'Widget A', description: 'Premium widget', category: 'Electronics', list_price: '99.99' },
          { code: 'PROD-002', name: 'Gadget B', description: 'Standard gadget', category: 'Hardware', list_price: '149.99' },
        ],
      },
      locations: {
        columns: [
          { name: 'code', required: true, type: 'string', description: 'Unique location code' },
          { name: 'name', required: true, type: 'string', description: 'Location name' },
          { name: 'region', required: false, type: 'string', description: 'Geographic region' },
          { name: 'country', required: false, type: 'string', description: 'Country code' },
          { name: 'type', required: false, type: 'string', description: 'Location type (WAREHOUSE, STORE, OFFICE)' },
        ],
        sampleData: [
          { code: 'LOC-001', name: 'Main Warehouse', region: 'North America', country: 'USA', type: 'WAREHOUSE' },
          { code: 'LOC-002', name: 'West Coast DC', region: 'North America', country: 'USA', type: 'WAREHOUSE' },
        ],
      },
      customers: {
        columns: [
          { name: 'code', required: true, type: 'string', description: 'Unique customer code' },
          { name: 'name', required: true, type: 'string', description: 'Customer name' },
          { name: 'segment', required: false, type: 'string', description: 'Customer segment (ENTERPRISE, SMB, CONSUMER)' },
          { name: 'type', required: false, type: 'string', description: 'Customer type (DIRECT, DISTRIBUTOR, RESELLER)' },
        ],
        sampleData: [
          { code: 'CUST-001', name: 'Acme Corp', segment: 'ENTERPRISE', type: 'DIRECT' },
          { code: 'CUST-002', name: 'Tech Solutions', segment: 'SMB', type: 'RESELLER' },
        ],
      },
      accounts: {
        columns: [
          { name: 'code', required: true, type: 'string', description: 'Unique account code (GL code)' },
          { name: 'name', required: true, type: 'string', description: 'Account name' },
          { name: 'type', required: false, type: 'string', description: 'Account type (REVENUE, EXPENSE, ASSET, LIABILITY)' },
          { name: 'category', required: false, type: 'string', description: 'Account category' },
        ],
        sampleData: [
          { code: 'ACC-001', name: 'Product Revenue', type: 'REVENUE', category: 'Sales' },
          { code: 'ACC-002', name: 'Cost of Goods Sold', type: 'EXPENSE', category: 'COGS' },
        ],
      },
    };

    const template = templateDefinitions[type] || templateDefinitions.actuals;
    return { type, ...template };
  }

  // ==================== ACTUALS ====================

  async getActuals(query: ActualsQueryDto, user: any) {
    const { page = 1, pageSize = 50, startDate, endDate, productId, locationId } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ActualWhereInput = {
      tenantId: user.tenantId,
      ...(startDate && endDate && {
        periodDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      }),
      ...(productId && { productId }),
      ...(locationId && { locationId }),
    };

    const [actuals, total] = await Promise.all([
      this.prisma.actual.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { periodDate: 'desc' },
        include: {
          product: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, code: true, name: true } },
          account: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.actual.count({ where }),
    ]);

    return {
      data: actuals,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getActualsSummary(user: any) {
    const [totalRecords, dateRange, byType] = await Promise.all([
      this.prisma.actual.count({ where: { tenantId: user.tenantId } }),
      this.prisma.actual.aggregate({
        where: { tenantId: user.tenantId },
        _min: { periodDate: true },
        _max: { periodDate: true, updatedAt: true },
      }),
      this.prisma.actual.groupBy({
        by: ['actualType'],
        where: { tenantId: user.tenantId },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    return {
      totalRecords,
      dateRange: {
        start: dateRange._min?.periodDate,
        end: dateRange._max?.periodDate,
      },
      lastUpdated: dateRange._max?.updatedAt,
      byType: byType.reduce(
        (acc, item) => ({ 
          ...acc, 
          [item.actualType]: { 
            count: item._count, 
            total: item._sum?.amount?.toNumber() || 0 
          } 
        }),
        {},
      ),
    };
  }

  async deleteActuals(startDate: string, endDate: string, user: any) {
    const result = await this.prisma.actual.deleteMany({
      where: {
        tenantId: user.tenantId,
        periodDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });

    return { deleted: result.count };
  }

  // ==================== DIMENSIONS ====================

  private normalizeOptionalString(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : undefined;
  }

  private looksLikeUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async buildUniqueTenantMasterCode(
    model: { findFirst(args: any): Promise<{ id: string } | null> },
    tenantId: string,
    rawValue: string,
    fallbackPrefix: string,
  ): Promise<string> {
    const normalizedBase = rawValue
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);

    const baseCode = normalizedBase || fallbackPrefix;
    let candidate = baseCode.slice(0, 50);
    let suffix = 1;

    while (
      await model.findFirst({
        where: { tenantId, code: candidate },
        select: { id: true },
      })
    ) {
      const suffixToken = `_${suffix}`;
      candidate = `${baseCode.slice(0, Math.max(1, 50 - suffixToken.length))}${suffixToken}`;
      suffix += 1;
    }

    return candidate;
  }

  private async resolveProductCategory(
    tenantId: string,
    categoryId?: string,
    categoryValue?: string,
  ): Promise<{ id: string; name: string; code: string } | null> {
    const normalizedCategoryId = this.normalizeOptionalString(categoryId);
    const normalizedCategoryValue = this.normalizeOptionalString(categoryValue);

    if (!normalizedCategoryId && !normalizedCategoryValue) {
      return null;
    }

    const category = await this.prisma.productCategory.findFirst({
      where: {
        tenantId,
        ...(normalizedCategoryId
          ? { id: normalizedCategoryId }
          : {
              OR: [
                ...(normalizedCategoryValue && this.looksLikeUuid(normalizedCategoryValue)
                  ? [{ id: normalizedCategoryValue }]
                  : []),
                { code: { equals: normalizedCategoryValue, mode: 'insensitive' } },
                { name: { equals: normalizedCategoryValue, mode: 'insensitive' } },
              ],
            }),
      },
      select: { id: true, name: true, code: true },
    });

    if (!category) {
      throw new BadRequestException(
        `Product category ${normalizedCategoryId || `"${normalizedCategoryValue}"`} was not found for this tenant`,
      );
    }

    return category;
  }

  private async resolveUnitOfMeasure(
    tenantId: string,
    unitOfMeasureId?: string,
    unitOfMeasureValue?: string,
  ): Promise<{ id: string; code: string; name: string } | null> {
    const normalizedUnitOfMeasureId = this.normalizeOptionalString(unitOfMeasureId);
    const normalizedUnitOfMeasureValue = this.normalizeOptionalString(unitOfMeasureValue);

    if (!normalizedUnitOfMeasureId && !normalizedUnitOfMeasureValue) {
      return null;
    }

    const unitOfMeasure = await this.prisma.unitOfMeasure.findFirst({
      where: {
        tenantId,
        ...(normalizedUnitOfMeasureId
          ? { id: normalizedUnitOfMeasureId }
          : {
              OR: [
                ...(normalizedUnitOfMeasureValue && this.looksLikeUuid(normalizedUnitOfMeasureValue)
                  ? [{ id: normalizedUnitOfMeasureValue }]
                  : []),
                { code: { equals: normalizedUnitOfMeasureValue, mode: 'insensitive' } },
                { name: { equals: normalizedUnitOfMeasureValue, mode: 'insensitive' } },
              ],
            }),
      },
      select: { id: true, code: true, name: true },
    });

    if (!unitOfMeasure) {
      throw new BadRequestException(
        `Unit of measure ${normalizedUnitOfMeasureId || `"${normalizedUnitOfMeasureValue}"`} was not found for this tenant`,
      );
    }

    return unitOfMeasure;
  }

  private async resolveOrCreateProductBrand(
    tenantId: string,
    brandId?: string,
    brandValue?: string,
  ): Promise<{ id: string; code: string; name: string } | null> {
    const normalizedBrandId = this.normalizeOptionalString(brandId);
    const normalizedBrandValue = this.normalizeOptionalString(brandValue);

    if (!normalizedBrandId && !normalizedBrandValue) {
      return null;
    }

    const brand = await this.prisma.productBrand.findFirst({
      where: {
        tenantId,
        ...(normalizedBrandId
          ? { id: normalizedBrandId }
          : {
              OR: [
                ...(normalizedBrandValue && this.looksLikeUuid(normalizedBrandValue)
                  ? [{ id: normalizedBrandValue }]
                  : []),
                { code: { equals: normalizedBrandValue, mode: 'insensitive' } },
                { name: { equals: normalizedBrandValue, mode: 'insensitive' } },
              ],
            }),
      },
      select: { id: true, code: true, name: true },
    });

    if (brand) {
      return brand;
    }

    if (normalizedBrandId || (normalizedBrandValue && this.looksLikeUuid(normalizedBrandValue))) {
      throw new BadRequestException(
        `Product brand ${normalizedBrandId || `"${normalizedBrandValue}"`} was not found for this tenant`,
      );
    }

    const code = await this.buildUniqueTenantMasterCode(
      this.prisma.productBrand,
      tenantId,
      normalizedBrandValue!,
      'BRAND',
    );

    return this.prisma.productBrand.create({
      data: {
        tenantId,
        code,
        name: normalizedBrandValue!,
      },
      select: { id: true, code: true, name: true },
    });
  }

  private async resolveOrCreateProductSubcategory(
    tenantId: string,
    categoryId: string | null | undefined,
    subcategoryId?: string,
    subcategoryValue?: string,
  ): Promise<{ id: string; code: string; name: string; categoryId: string | null } | null> {
    const normalizedSubcategoryId = this.normalizeOptionalString(subcategoryId);
    const normalizedSubcategoryValue = this.normalizeOptionalString(subcategoryValue);
    const normalizedCategoryId = categoryId ?? null;

    if (!normalizedSubcategoryId && !normalizedSubcategoryValue) {
      return null;
    }

    const subcategory = await this.prisma.productSubcategory.findFirst({
      where: {
        tenantId,
        ...(normalizedSubcategoryId
          ? { id: normalizedSubcategoryId }
          : {
              categoryId: normalizedCategoryId,
              OR: [
                ...(normalizedSubcategoryValue && this.looksLikeUuid(normalizedSubcategoryValue)
                  ? [{ id: normalizedSubcategoryValue }]
                  : []),
                { code: { equals: normalizedSubcategoryValue, mode: 'insensitive' } },
                { name: { equals: normalizedSubcategoryValue, mode: 'insensitive' } },
              ],
            }),
      },
      select: { id: true, code: true, name: true, categoryId: true },
    });

    if (subcategory) {
      return subcategory;
    }

    if (
      normalizedSubcategoryId ||
      (normalizedSubcategoryValue && this.looksLikeUuid(normalizedSubcategoryValue))
    ) {
      throw new BadRequestException(
        `Product subcategory ${normalizedSubcategoryId || `"${normalizedSubcategoryValue}"`} was not found for this tenant`,
      );
    }

    const code = await this.buildUniqueTenantMasterCode(
      this.prisma.productSubcategory,
      tenantId,
      normalizedSubcategoryValue!,
      'SUBCATEGORY',
    );

    return this.prisma.productSubcategory.create({
      data: {
        tenantId,
        code,
        name: normalizedSubcategoryValue!,
        categoryId: normalizedCategoryId,
      },
      select: { id: true, code: true, name: true, categoryId: true },
    });
  }

  private async buildProductSpecificData(
    tenantId: string,
    dto: Pick<
      CreateDimensionDto,
      | 'brand'
      | 'brandId'
      | 'category'
      | 'categoryId'
      | 'listPrice'
      | 'standardCost'
      | 'subcategory'
      | 'subcategoryId'
      | 'unitOfMeasure'
      | 'unitOfMeasureId'
    >,
    options?: { currentCategoryId?: string | null },
  ): Promise<Record<string, any>> {
    const specificData: Record<string, any> = {};
    let resolvedCategoryId = options?.currentCategoryId ?? null;

    const categorySelectionProvided = dto.categoryId !== undefined || dto.category !== undefined;
    if (categorySelectionProvided) {
      const category = await this.resolveProductCategory(tenantId, dto.categoryId, dto.category);
      specificData.categoryId = category?.id ?? null;
      specificData.category = category?.name ?? null;
      resolvedCategoryId = category?.id ?? null;
    }

    const unitOfMeasureSelectionProvided = dto.unitOfMeasureId !== undefined || dto.unitOfMeasure !== undefined;
    if (unitOfMeasureSelectionProvided) {
      const unitOfMeasure = await this.resolveUnitOfMeasure(
        tenantId,
        dto.unitOfMeasureId,
        dto.unitOfMeasure,
      );
      specificData.unitOfMeasureId = unitOfMeasure?.id ?? null;
      specificData.unitOfMeasure = unitOfMeasure?.code ?? null;
    }

    const subcategorySelectionProvided = dto.subcategoryId !== undefined || dto.subcategory !== undefined;
    if (subcategorySelectionProvided) {
      const subcategory = await this.resolveOrCreateProductSubcategory(
        tenantId,
        resolvedCategoryId,
        dto.subcategoryId,
        dto.subcategory,
      );
      specificData.subcategoryId = subcategory?.id ?? null;
      specificData.subcategory = subcategory?.name ?? null;
    } else if (categorySelectionProvided) {
      specificData.subcategoryId = null;
      specificData.subcategory = null;
    }

    const brandSelectionProvided = dto.brandId !== undefined || dto.brand !== undefined;
    if (brandSelectionProvided) {
      const brand = await this.resolveOrCreateProductBrand(tenantId, dto.brandId, dto.brand);
      specificData.brandId = brand?.id ?? null;
      specificData.brand = brand?.name ?? null;
    }

    if (dto.standardCost !== undefined) {
      specificData.standardCost = dto.standardCost;
    }

    if (dto.listPrice !== undefined) {
      specificData.listPrice = dto.listPrice;
    }

    return specificData;
  }

  private async resolveCostCenterParent(
    tenantId: string,
    parentId?: string | null,
  ): Promise<{ id: string } | null> {
    const normalizedParentId = this.normalizeOptionalString(parentId);

    if (!normalizedParentId) {
      return null;
    }

    const parent = await this.prisma.costCenter.findFirst({
      where: {
        tenantId,
        id: normalizedParentId,
      },
      select: { id: true },
    });

    if (!parent) {
      throw new BadRequestException(
        `Cost center parent "${normalizedParentId}" was not found for this tenant`,
      );
    }

    return parent;
  }

  private async buildCostCenterSpecificData(
    tenantId: string,
    dto: Pick<CreateDimensionDto, 'parentId' | 'managerId'>,
    options?: { allowParentDisconnect?: boolean; allowManagerDisconnect?: boolean },
  ): Promise<Record<string, any>> {
    const specificData: Record<string, any> = {};

    if (dto.parentId !== undefined) {
      const parent = await this.resolveCostCenterParent(tenantId, dto.parentId);

      if (parent) {
        specificData.parent = { connect: { id: parent.id } };
      } else if (options?.allowParentDisconnect) {
        specificData.parent = { disconnect: true };
      }
    }

    if (dto.managerId !== undefined) {
      const normalizedManagerId = this.normalizeOptionalString(dto.managerId);

      if (!normalizedManagerId) {
        specificData.manager = null;
        if (options?.allowManagerDisconnect) {
          specificData.managerUser = { disconnect: true };
        }
      } else {
        const manager = await this.prisma.user.findFirst({
          where: {
            tenantId,
            id: normalizedManagerId,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        });

        if (!manager) {
          throw new BadRequestException(
            `Cost center manager "${normalizedManagerId}" was not found for this tenant`,
          );
        }

        specificData.managerUser = { connect: { id: manager.id } };
        specificData.manager = `${manager.firstName} ${manager.lastName}`.trim() || manager.email;
      }
    }

    return specificData;
  }

  private typeSupportsAttributes(type: string): boolean {
    return type === 'product' || type === 'location' || type === 'customer';
  }

  // Helper to transform dimension record to include isActive
  private transformDimension(record: any) {
    if (!record) return record;
    return {
      ...record,
      isActive: record.status === 'ACTIVE',
    };
  }

  private transformDimensions(records: any[]) {
    return records.map(r => this.transformDimension(r));
  }

  async getDimensions(type: string, query: DimensionQueryDto, user: any) {
    const model = this.getDimensionModel(type);
    const { search, isActive, page, pageSize, limit } = query;

    // Use limit or pageSize, default to 100
    const take = limit || pageSize || 100;
    const skip = page ? (page - 1) * take : 0;

    const where: any = {
      tenantId: user.tenantId,
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(isActive !== undefined && { status: isActive ? 'ACTIVE' : 'INACTIVE' }),
    };

    const results = await model.findMany({
      where,
      orderBy: { name: 'asc' },
      take,
      skip,
    });
    return this.transformDimensions(results);
  }

  async getDimensionHierarchy(type: string, user: any) {
    const model = this.getDimensionModel(type);

    const items = await model.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: 'asc' },
    });

    return this.transformDimensions(items);
  }

  async createDimension(type: string, createDto: CreateDimensionDto, user: any) {
    const model = this.getDimensionModel(type);

    // Check for duplicate code
    const existing = await model.findFirst({
      where: {
        tenantId: user.tenantId,
        code: createDto.code,
      },
    });

    if (existing) {
      throw new BadRequestException(`${type} with code "${createDto.code}" already exists`);
    }

    // Build model-specific data
    // Note: Only Product and Location models have description field
    const baseData: Record<string, any> = {
      code: createDto.code,
      name: createDto.name,
      tenant: { connect: { id: user.tenantId } },
      status: createDto.isActive === false ? 'INACTIVE' : 'ACTIVE',
      externalId: createDto.externalId,
    };

    if (this.typeSupportsAttributes(type)) {
      baseData.attributes = createDto.attributes || {};
    }

    // Only add description for Product model (only model with description field)
    if (type === 'product' && createDto.description !== undefined) {
      baseData.description = createDto.description;
    }

    let specificData: Record<string, any> = {};

    switch (type) {
      case 'product':
        specificData = await this.buildProductSpecificData(user.tenantId, createDto);
        break;

      case 'location':
        specificData = {
          type: createDto.type || 'WAREHOUSE',
          address: createDto.address,
          city: createDto.city,
          state: createDto.state,
          country: createDto.country,
          postalCode: createDto.postalCode,
          region: createDto.region,
          timezone: createDto.timezone,
        };
        break;

      case 'customer':
        specificData = {
          type: createDto.type || 'DIRECT',
          segment: createDto.segment,
          industry: createDto.industry,
          country: createDto.country,
          region: createDto.region,
          creditLimit: createDto.creditLimit,
          paymentTerms: createDto.paymentTerms,
        };
        break;

      case 'account':
        // Account type is required
        if (!createDto.type) {
          throw new BadRequestException('Account type is required. Valid types: REVENUE, COST_OF_GOODS, OPERATING_EXPENSE, OTHER_INCOME, OTHER_EXPENSE, ASSET, LIABILITY, EQUITY');
        }
        specificData = {
          type: createDto.type,
          category: createDto.category,
          level: createDto.level || 1,
          isRollup: createDto.isRollup || false,
          sign: createDto.sign || 1,
          ...(createDto.parentId && { parent: { connect: { id: createDto.parentId } } }),
        };
        break;

      case 'cost_center':
        specificData = await this.buildCostCenterSpecificData(user.tenantId, createDto);
        break;
    }

    // Remove undefined values
    Object.keys(specificData).forEach(key => {
      if (specificData[key] === undefined) {
        delete specificData[key];
      }
    });

    const created = await model.create({
      data: {
        ...baseData,
        ...specificData,
      },
    });
    return this.transformDimension(created);
  }

  async getDimension(type: string, id: string, user: any) {
    const model = this.getDimensionModel(type);

    const dimension = await model.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!dimension) {
      throw new NotFoundException(`${type} not found`);
    }

    return this.transformDimension(dimension);
  }

  async updateDimension(
    type: string,
    id: string,
    updateDto: UpdateDimensionDto,
    user: any,
  ) {
    const existingDimension = await this.getDimension(type, id, user);
    const model = this.getDimensionModel(type);

    // Build model-specific update data
    const baseData: Record<string, any> = {};
    
    if (updateDto.code !== undefined) baseData.code = updateDto.code;
    if (updateDto.name !== undefined) baseData.name = updateDto.name;
    // Only Product model has description field
    if (updateDto.description !== undefined && type === 'product') {
      baseData.description = updateDto.description;
    }
    if (updateDto.attributes !== undefined) baseData.attributes = updateDto.attributes;
    if (updateDto.externalId !== undefined) baseData.externalId = updateDto.externalId;
    if (updateDto.isActive !== undefined) baseData.status = updateDto.isActive ? 'ACTIVE' : 'INACTIVE';

    let specificData: Record<string, any> = {};

    switch (type) {
      case 'product':
        specificData = await this.buildProductSpecificData(user.tenantId, updateDto, {
          currentCategoryId: existingDimension?.categoryId ?? null,
        });
        break;

      case 'location':
        if (updateDto.type !== undefined) specificData.type = updateDto.type;
        if (updateDto.address !== undefined) specificData.address = updateDto.address;
        if (updateDto.city !== undefined) specificData.city = updateDto.city;
        if (updateDto.state !== undefined) specificData.state = updateDto.state;
        if (updateDto.country !== undefined) specificData.country = updateDto.country;
        if (updateDto.postalCode !== undefined) specificData.postalCode = updateDto.postalCode;
        if (updateDto.region !== undefined) specificData.region = updateDto.region;
        if (updateDto.timezone !== undefined) specificData.timezone = updateDto.timezone;
        break;

      case 'customer':
        if (updateDto.type !== undefined) specificData.type = updateDto.type;
        if (updateDto.segment !== undefined) specificData.segment = updateDto.segment;
        if (updateDto.industry !== undefined) specificData.industry = updateDto.industry;
        if (updateDto.country !== undefined) specificData.country = updateDto.country;
        if (updateDto.region !== undefined) specificData.region = updateDto.region;
        if (updateDto.creditLimit !== undefined) specificData.creditLimit = updateDto.creditLimit;
        if (updateDto.paymentTerms !== undefined) specificData.paymentTerms = updateDto.paymentTerms;
        break;

      case 'account':
        if (updateDto.type !== undefined) specificData.type = updateDto.type;
        if (updateDto.category !== undefined) specificData.category = updateDto.category;
        if (updateDto.level !== undefined) specificData.level = updateDto.level;
        if (updateDto.isRollup !== undefined) specificData.isRollup = updateDto.isRollup;
        if (updateDto.sign !== undefined) specificData.sign = updateDto.sign;
        if (updateDto.parentId !== undefined) {
          specificData.parent = updateDto.parentId ? { connect: { id: updateDto.parentId } } : { disconnect: true };
        }
        break;

      case 'cost_center':
        specificData = await this.buildCostCenterSpecificData(user.tenantId, updateDto, {
          allowParentDisconnect: true,
          allowManagerDisconnect: true,
        });
        break;
    }

    const updated = await model.update({
      where: { id },
      data: {
        ...baseData,
        ...specificData,
      },
    });
    return this.transformDimension(updated);
  }

  async deleteDimension(type: string, id: string, user: any) {
    await this.getDimension(type, id, user);
    const model = this.getDimensionModel(type);

    // Check if dimension is in use
    const actualsCount = await this.checkDimensionUsage(type, id, user.tenantId);
    if (actualsCount > 0) {
      throw new BadRequestException(
        `Cannot delete ${type} because it is referenced by ${actualsCount} actual records`,
      );
    }

    await model.delete({ where: { id } });
  }

  private getDimensionModel(type: string): any {
    const models: Record<string, any> = {
      product: this.prisma.product,
      location: this.prisma.location,
      customer: this.prisma.customer,
      account: this.prisma.account,
      cost_center: this.prisma.costCenter,
    };

    const model = models[type];
    if (!model) {
      throw new BadRequestException(`Invalid dimension type: ${type}`);
    }

    return model;
  }

  private async checkDimensionUsage(
    type: string,
    id: string,
    tenantId: string,
  ): Promise<number> {
    const fieldMap: Record<string, string> = {
      product: 'productId',
      location: 'locationId',
      customer: 'customerId',
      account: 'accountId',
      cost_center: 'costCenterId',
    };

    const field = fieldMap[type];
    if (!field) return 0;

    return this.prisma.actual.count({
      where: {
        tenantId,
        [field]: id,
      },
    });
  }
}
