import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
    DEFAULT_PRODUCT_CATEGORIES,
    DEFAULT_TENANT_SETTINGS,
    DEFAULT_TENANT_UOMS,
} from './tenant-bootstrap.defaults';

type PrismaClientLike = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TenantBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrapTenant(tenantId: string, client: PrismaClientLike = this.prisma): Promise<void> {
    await Promise.all([
      client.unitOfMeasure.createMany({
        data: DEFAULT_TENANT_UOMS.map((uom) => ({
          tenantId,
          code: uom.code,
          name: uom.name,
          symbol: uom.symbol,
          category: uom.category,
          decimals: uom.decimals,
          isBase: uom.isBase,
          isActive: true,
          sortOrder: uom.sortOrder,
        })),
        skipDuplicates: true,
      }),
      client.productCategory.createMany({
        data: DEFAULT_PRODUCT_CATEGORIES.map((category) => ({
          tenantId,
          code: category.code,
          name: category.name,
          description: category.description,
          color: category.color,
          sortOrder: category.sortOrder,
          isActive: true,
        })),
        skipDuplicates: true,
      }),
    ]);

    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      return;
    }

    const nextSettings = this.mergeTenantSettings(tenant.settings);

    await client.tenant.update({
      where: { id: tenantId },
      data: {
        settings: nextSettings,
      },
    });
  }

  private mergeTenantSettings(settings: Prisma.JsonValue): Prisma.InputJsonObject {
    const currentSettings = this.asObject(settings);
    const currentFeatures = this.asObject(currentSettings.features);

    return {
      ...currentSettings,
      dateFormat:
        typeof currentSettings.dateFormat === 'string'
          ? currentSettings.dateFormat
          : DEFAULT_TENANT_SETTINGS.dateFormat,
      defaultForecastModel:
        typeof currentSettings.defaultForecastModel === 'string'
          ? currentSettings.defaultForecastModel
          : DEFAULT_TENANT_SETTINGS.defaultForecastModel,
      features: {
        ...DEFAULT_TENANT_SETTINGS.features,
        ...currentFeatures,
      },
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}