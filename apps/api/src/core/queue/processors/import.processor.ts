import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { parse } from 'csv-parse';
import * as ExcelJS from 'exceljs';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queue.constants';

export interface ImportJobData {
  jobId: string;
  tenantId: string;
  userId: string;
  type: string; // actuals, products, locations, customers, accounts
  filePath: string;
  fileName: string;
  mapping?: Record<string, string>;
}

@Processor(QUEUE_NAMES.IMPORT)
export class ImportQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportQueueProcessor.name);
  private readonly actualsDimensionFields = [
    { codeField: 'productCode', idField: 'productId', label: 'Product' },
    { codeField: 'locationCode', idField: 'locationId', label: 'Location' },
    { codeField: 'customerCode', idField: 'customerId', label: 'Customer' },
    { codeField: 'accountCode', idField: 'accountId', label: 'Account' },
  ] as const;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<any> {
    const { jobId, tenantId, userId, type, filePath, fileName, mapping } = job.data;

    this.logger.log(`Processing import job ${jobId} for tenant ${tenantId}, type: ${type}`);

    try {
      // Update status to VALIDATING
      await this.updateImportStatus(jobId, 'VALIDATING');

      const fileType = fileName.toLowerCase().endsWith('.csv') ? 'CSV' : 'XLSX';
      const columnMapping = mapping || this.getDefaultMapping(type);
      const lookups = type === 'actuals' ? await this.loadDimensionLookups(tenantId) : null;

      // Update status to PROCESSING
      await this.updateImportStatus(jobId, 'PROCESSING');

      let totalRows = 0;
      let successRows = 0;
      let errorRows = 0;
      let errors: Array<{ row: number; errors: string[]; data: Record<string, string> }> = [];

      if (fileType === 'CSV') {
        const result = await this.processCsvImport(
          tenantId,
          jobId,
          type,
          userId,
          filePath,
          columnMapping,
          lookups,
          job,
        );
        totalRows = result.totalRows;
        successRows = result.successRows;
        errorRows = result.errorRows;
        errors = result.errors;
      } else {
        const result = await this.processExcelImport(
          tenantId,
          jobId,
          type,
          userId,
          filePath,
          columnMapping,
          lookups,
          job,
        );
        totalRows = result.totalRows;
        successRows = result.successRows;
        errorRows = result.errorRows;
        errors = result.errors;
      }

      // Determine final status
      const finalStatus = errorRows > 0
        ? (successRows > 0 ? 'COMPLETED' : 'FAILED')
        : 'COMPLETED';

      // Update final status
      await this.prisma.dataImport.update({
        where: { id: jobId },
        data: {
          status: finalStatus,
          totalRows,
          processedRows: totalRows,
          successRows,
          errorRows,
          errors: errors.slice(0, 100) as any, // Limit stored errors
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Completed import job ${jobId}: ${successRows} success, ${errorRows} errors`,
      );

      return {
        success: true,
        totalRows,
        successRows,
        errorRows,
      };
    } catch (error) {
      this.logger.error(`Failed import job ${jobId}: ${error.message}`, error.stack);

      await this.prisma.dataImport.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errors: [{ row: 0, message: error.message }] as any,
        },
      });

      throw error;
    } finally {
      try {
        if (filePath) {
          await unlink(filePath);
        }
      } catch (cleanupError) {
        this.logger.warn(`Failed to delete import file ${filePath}: ${cleanupError.message}`);
      }
    }
  }

  private async updateImportStatus(importId: string, status: string) {
    await this.prisma.dataImport.update({
      where: { id: importId },
      data: {
        status: status as any,
        startedAt: status === 'VALIDATING' ? new Date() : undefined,
      },
    });
  }

  private getDefaultMapping(type: string): Record<string, string> {
    const mappings: Record<string, Record<string, string>> = {
      actuals: {
        periodDate: 'period_date',
        productCode: 'product_code',
        locationCode: 'location_code',
        customerCode: 'customer_code',
        accountCode: 'account_code',
        amount: 'amount',
        quantity: 'quantity',
      },
      products: {
        code: 'code',
        name: 'name',
        description: 'description',
        category: 'category',
        listPrice: 'list_price',
      },
      locations: {
        code: 'code',
        name: 'name',
        region: 'region',
        country: 'country',
        type: 'type',
      },
      customers: {
        code: 'code',
        name: 'name',
        segment: 'segment',
        type: 'type',
      },
      accounts: {
        code: 'code',
        name: 'name',
        type: 'type',
        category: 'category',
      },
    };
    return mappings[type] || mappings.actuals;
  }

  private async processExcelImport(
    tenantId: string,
    importId: string,
    importType: string,
    userId: string,
    filePath: string,
    columnMapping: Record<string, string>,
    lookups: any,
    job: Job,
  ): Promise<{
    totalRows: number;
    successRows: number;
    errorRows: number;
    errors: Array<{ row: number; errors: string[]; data: Record<string, string> }>;
  }> {
    const batchSize = 500;
    const validBatch: any[] = [];
    const errors: Array<{ row: number; errors: string[]; data: Record<string, string> }> = [];
    let totalRows = 0;
    let successRows = 0;
    let errorRows = 0;

    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});
    let headers: string[] = [];

    for await (const worksheetReader of workbookReader) {
      for await (const row of worksheetReader) {
        const rowNumber = row.number;

        const rowValues = Array.isArray(row.values) ? row.values : [];

        if (rowNumber === 1) {
          headers = rowValues
            .slice(1)
            .map((value) => String(value ?? '').toLowerCase().trim());
          continue;
        }

        const record: Record<string, unknown> = {};
        rowValues.slice(1).forEach((value, index) => {
          const header = headers[index];
          if (header) {
            record[header] = value;
          }
        });

        const hasValues = Object.values(record).some(
          (value) => value !== undefined && value !== null && String(value).trim() !== '',
        );
        if (!hasValues) {
          continue;
        }

        totalRows += 1;
        const dataRowNumber = rowNumber;

        try {
          const transformed = this.transformRecord(record, columnMapping, lookups, importType);
          const validationErrors = this.validateRecord(transformed, importType);

          if (validationErrors.length > 0) {
            errorRows += 1;
            if (errors.length < 100) {
              errors.push({
                row: dataRowNumber,
                errors: validationErrors,
                data: this.sanitizeForLog(record),
              });
            }
          } else {
            validBatch.push(transformed);
          }
        } catch (error) {
          errorRows += 1;
          if (errors.length < 100) {
            errors.push({
              row: dataRowNumber,
              errors: [error.message],
              data: this.sanitizeForLog(record),
            });
          }
        }

        if (validBatch.length >= batchSize) {
          await this.insertRecords(tenantId, importId, validBatch, importType, userId);
          successRows += validBatch.length;
          validBatch.length = 0;
        }

        if (totalRows % 500 === 0) {
          await job.updateProgress(totalRows);
        }
      }

      break;
    }

    if (validBatch.length > 0) {
      await this.insertRecords(tenantId, importId, validBatch, importType, userId);
      successRows += validBatch.length;
    }

    if (totalRows === 0) {
      throw new Error('No data rows found in file');
    }

    return { totalRows, successRows, errorRows, errors };
  }

  private async processCsvImport(
    tenantId: string,
    importId: string,
    importType: string,
    userId: string,
    filePath: string,
    columnMapping: Record<string, string>,
    lookups: any,
    job: Job,
  ): Promise<{
    totalRows: number;
    successRows: number;
    errorRows: number;
    errors: Array<{ row: number; errors: string[]; data: Record<string, string> }>;
  }> {
    const batchSize = 500;
    const validBatch: any[] = [];
    const errors: Array<{ row: number; errors: string[]; data: Record<string, string> }> = [];
    let totalRows = 0;
    let successRows = 0;
    let errorRows = 0;

    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }),
    );

    for await (const record of parser) {
      totalRows += 1;
      const rowNumber = totalRows + 1; // Account for header row

      try {
        const transformed = this.transformRecord(record, columnMapping, lookups, importType);
        const validationErrors = this.validateRecord(transformed, importType);

        if (validationErrors.length > 0) {
          errorRows += 1;
          if (errors.length < 100) {
            errors.push({
              row: rowNumber,
              errors: validationErrors,
              data: this.sanitizeForLog(record),
            });
          }
        } else {
          validBatch.push(transformed);
        }
      } catch (error) {
        errorRows += 1;
        if (errors.length < 100) {
          errors.push({
            row: rowNumber,
            errors: [error.message],
            data: this.sanitizeForLog(record),
          });
        }
      }

      if (validBatch.length >= batchSize) {
        await this.insertRecords(tenantId, importId, validBatch, importType, userId);
        successRows += validBatch.length;
        validBatch.length = 0;
      }

      if (totalRows % 500 === 0) {
        await job.updateProgress(totalRows);
      }
    }

    if (validBatch.length > 0) {
      await this.insertRecords(tenantId, importId, validBatch, importType, userId);
      successRows += validBatch.length;
    }

    if (totalRows === 0) {
      throw new Error('No data rows found in file');
    }

    return { totalRows, successRows, errorRows, errors };
  }

  private sanitizeForLog(record: any): any {
    // Limit field lengths for logging
    const sanitized: any = {};
    for (const [key, value] of Object.entries(record)) {
      const strValue = String(value || '');
      sanitized[key] = strValue.length > 50 ? strValue.substring(0, 50) + '...' : strValue;
    }
    return sanitized;
  }

  private transformRecord(
    record: any,
    columnMapping: Record<string, string>,
    lookups: any,
    importType: string,
  ): any {
    const transformed: any = {};

    // Normalize record keys to lowercase
    const normalizedRecord: any = {};
    for (const [key, value] of Object.entries(record)) {
      normalizedRecord[key.toLowerCase().trim()] = value;
    }

    for (const [targetField, sourceField] of Object.entries(columnMapping)) {
      let value = normalizedRecord[sourceField.toLowerCase()];

      // Apply transformations based on field type
      if (targetField === 'periodDate' || targetField.toLowerCase().includes('date')) {
        value = this.parseDate(value);
      } else if (targetField === 'amount' || targetField === 'quantity' || targetField === 'listPrice') {
        value = this.parseNumber(value);
      } else if (targetField.endsWith('Code') && lookups) {
        value = this.normalizeCodeValue(value);
      } else if (typeof value === 'string') {
        value = value.trim();
      }

      transformed[targetField] = value;
    }

    // For actuals, resolve dimension codes to IDs
    if (importType === 'actuals' && lookups) {
      if (transformed.productCode) {
        transformed.productId = lookups.product[this.normalizeLookupKey(transformed.productCode)] || null;
      }
      if (transformed.locationCode) {
        transformed.locationId = lookups.location[this.normalizeLookupKey(transformed.locationCode)] || null;
      }
      if (transformed.customerCode) {
        transformed.customerId = lookups.customer[this.normalizeLookupKey(transformed.customerCode)] || null;
      }
      if (transformed.accountCode) {
        transformed.accountId = lookups.account[this.normalizeLookupKey(transformed.accountCode)] || null;
      }
    }

    return transformed;
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;
    
    if (value instanceof Date) return value;
    
    // Handle Excel date serial numbers
    if (typeof value === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + value * 86400000);
    }
    
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    
    const num = Number(String(value).replace(/[,$%]/g, '').trim());
    return isNaN(num) ? null : num;
  }

  private normalizeCodeValue(value: unknown): string | null {
    const normalizedValue = String(value ?? '').trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
  }

  private normalizeLookupKey(value: string): string {
    return value.trim().toLowerCase();
  }

  private validateRecord(record: any, importType: string): string[] {
    const errors: string[] = [];

    switch (importType) {
      case 'actuals':
        if (!record.periodDate) {
          errors.push('Period date is required');
        }
        if (record.amount === null || record.amount === undefined) {
          errors.push('Amount is required');
        }
        for (const field of this.actualsDimensionFields) {
          if (record[field.codeField] && !record[field.idField]) {
            errors.push(`${field.label} code "${record[field.codeField]}" was not found`);
          }
        }
        break;
        
      case 'products':
      case 'locations':
      case 'customers':
      case 'accounts':
        if (!record.code || String(record.code).trim() === '') {
          errors.push('Code is required');
        }
        if (!record.name || String(record.name).trim() === '') {
          errors.push('Name is required');
        }
        break;
    }

    return errors;
  }

  private async loadDimensionLookups(tenantId: string): Promise<any> {
    const [products, locations, customers, accounts] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId },
        select: { id: true, code: true },
      }),
      this.prisma.location.findMany({
        where: { tenantId },
        select: { id: true, code: true },
      }),
      this.prisma.customer.findMany({
        where: { tenantId },
        select: { id: true, code: true },
      }),
      this.prisma.account.findMany({
        where: { tenantId },
        select: { id: true, code: true },
      }),
    ]);

    return {
      product: Object.fromEntries(products.map((p: { id: string; code: string }) => [this.normalizeLookupKey(p.code), p.id])),
      location: Object.fromEntries(locations.map((l: { id: string; code: string }) => [this.normalizeLookupKey(l.code), l.id])),
      customer: Object.fromEntries(customers.map((c: { id: string; code: string }) => [this.normalizeLookupKey(c.code), c.id])),
      account: Object.fromEntries(accounts.map((a: { id: string; code: string }) => [this.normalizeLookupKey(a.code), a.id])),
    };
  }

  private async insertRecords(
    tenantId: string,
    importId: string,
    records: any[],
    importType: string,
    userId: string,
  ): Promise<void> {
    const batchSize = 500;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      switch (importType) {
        case 'actuals':
          await this.insertActuals(tenantId, importId, batch);
          break;
        case 'products':
          await this.insertProducts(tenantId, batch);
          break;
        case 'locations':
          await this.insertLocations(tenantId, batch);
          break;
        case 'customers':
          await this.insertCustomers(tenantId, batch);
          break;
        case 'accounts':
          await this.insertAccounts(tenantId, batch);
          break;
      }
    }
  }

  private async insertActuals(tenantId: string, importId: string, records: any[]): Promise<void> {
    await this.prisma.actual.createMany({
      data: records.map((r) => ({
        tenantId,
        actualType: 'SALES',
        periodDate: r.periodDate,
        productId: r.productId || null,
        locationId: r.locationId || null,
        customerId: r.customerId || null,
        accountId: r.accountId || null,
        quantity: r.quantity,
        amount: r.amount,
        currency: r.currency || 'USD',
        sourceSystem: 'IMPORT',
        importId,
      })),
      skipDuplicates: true,
    });
  }

  private async insertProducts(tenantId: string, records: any[]): Promise<void> {
    for (const r of records) {
      await this.prisma.product.upsert({
        where: {
          tenantId_code: { tenantId, code: r.code },
        },
        update: {
          name: r.name,
          description: r.description || null,
          category: r.category || null,
          listPrice: r.listPrice || null,
        },
        create: {
          tenantId,
          code: r.code,
          name: r.name,
          description: r.description || null,
          category: r.category || null,
          listPrice: r.listPrice || null,
          status: 'ACTIVE',
        },
      });
    }
  }

  private async insertLocations(tenantId: string, records: any[]): Promise<void> {
    for (const r of records) {
      await this.prisma.location.upsert({
        where: {
          tenantId_code: { tenantId, code: r.code },
        },
        update: {
          name: r.name,
          region: r.region || null,
          country: r.country || null,
          type: r.type || 'WAREHOUSE',
        },
        create: {
          tenantId,
          code: r.code,
          name: r.name,
          region: r.region || null,
          country: r.country || null,
          type: r.type || 'WAREHOUSE',
          status: 'ACTIVE',
        },
      });
    }
  }

  private async insertCustomers(tenantId: string, records: any[]): Promise<void> {
    for (const r of records) {
      await this.prisma.customer.upsert({
        where: {
          tenantId_code: { tenantId, code: r.code },
        },
        update: {
          name: r.name,
          segment: r.segment || null,
          type: r.type || 'DIRECT',
        },
        create: {
          tenantId,
          code: r.code,
          name: r.name,
          segment: r.segment || null,
          type: r.type || 'DIRECT',
          status: 'ACTIVE',
        },
      });
    }
  }

  private async insertAccounts(tenantId: string, records: any[]): Promise<void> {
    for (const r of records) {
      await this.prisma.account.upsert({
        where: {
          tenantId_code: { tenantId, code: r.code },
        },
        update: {
          name: r.name,
          type: r.type || 'REVENUE',
          category: r.category || null,
        },
        create: {
          tenantId,
          code: r.code,
          name: r.name,
          type: r.type || 'REVENUE',
          category: r.category || null,
          status: 'ACTIVE',
        },
      });
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Import job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Import job ${job.id} failed: ${error.message}`);
  }
}
