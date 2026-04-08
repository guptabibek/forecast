import { BadRequestException, Injectable } from '@nestjs/common';
import { PeriodType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TimeBucketService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up a time bucket.  Pass `{ allowFrozen: true }` for read-only /
   * validation paths that must succeed even when the period is closed.
   * Write paths (forecast generation, overrides) should keep the default
   * `allowFrozen: false` so frozen periods stay protected.
   */
  async getBucketOrThrow(
    tenantId: string,
    periodDate: Date,
    periodType: PeriodType,
    options?: { allowFrozen?: boolean },
  ) {
    const periodKey = this.buildPeriodKey(periodDate, periodType);

    let bucket = await this.prisma.timeBucket.findFirst({
      where: { tenantId, periodType, periodKey },
    });

    if (!bucket) {
      bucket = await this.ensureBucket(tenantId, periodDate, periodType, periodKey);
    }

    if (bucket.isFrozen && !options?.allowFrozen) {
      throw new BadRequestException(`Time bucket ${periodKey} is frozen`);
    }

    return bucket;
  }

  private async ensureBucket(
    tenantId: string,
    periodDate: Date,
    periodType: PeriodType,
    periodKey: string,
  ) {
    const year = periodDate.getUTCFullYear();
    const month = periodDate.getUTCMonth();

    let bucketStart: Date;
    let bucketEnd: Date;
    let fiscalYear = year;
    let fiscalQuarter: number | undefined;
    let fiscalMonth: number | undefined;
    let fiscalWeek: number | undefined;

    switch (periodType) {
      case 'YEARLY':
        bucketStart = new Date(Date.UTC(year, 0, 1));
        bucketEnd = new Date(Date.UTC(year, 11, 31));
        break;
      case 'QUARTERLY': {
        const q = Math.floor(month / 3);
        fiscalQuarter = q + 1;
        bucketStart = new Date(Date.UTC(year, q * 3, 1));
        bucketEnd = new Date(Date.UTC(year, q * 3 + 3, 0));
        break;
      }
      case 'MONTHLY':
        fiscalQuarter = Math.floor(month / 3) + 1;
        fiscalMonth = month + 1;
        bucketStart = new Date(Date.UTC(year, month, 1));
        bucketEnd = new Date(Date.UTC(year, month + 1, 0));
        break;
      case 'WEEKLY': {
        const dayOfWeek = periodDate.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        bucketStart = new Date(Date.UTC(year, month, periodDate.getUTCDate() + mondayOffset));
        bucketEnd = new Date(bucketStart);
        bucketEnd.setUTCDate(bucketEnd.getUTCDate() + 6);
        fiscalWeek = this.getWeekOfYear(periodDate);
        break;
      }
      case 'DAILY':
      default:
        bucketStart = new Date(Date.UTC(year, month, periodDate.getUTCDate()));
        bucketEnd = new Date(bucketStart);
        break;
    }

    return this.prisma.timeBucket.upsert({
      where: {
        tenantId_periodKey_periodType: { tenantId, periodKey, periodType },
      },
      update: {},
      create: {
        tenantId,
        periodType,
        periodKey,
        bucketStart,
        bucketEnd,
        fiscalYear,
        fiscalQuarter: fiscalQuarter ?? null,
        fiscalMonth: fiscalMonth ?? null,
        fiscalWeek: fiscalWeek ?? null,
        isFrozen: false,
      },
    });
  }

  buildPeriodKey(periodDate: Date, periodType: PeriodType) {
    const year = periodDate.getUTCFullYear();
    const month = periodDate.getUTCMonth() + 1;

    switch (periodType) {
      case 'MONTHLY':
        return `${year}-${String(month).padStart(2, '0')}`;
      case 'QUARTERLY': {
        const quarter = Math.floor((month - 1) / 3) + 1;
        return `${year}-Q${quarter}`;
      }
      case 'YEARLY':
        return `${year}`;
      case 'WEEKLY': {
        const week = this.getWeekOfYear(periodDate);
        return `${year}-W${String(week).padStart(2, '0')}`;
      }
      case 'DAILY':
      default:
        return periodDate.toISOString().split('T')[0];
    }
  }

  private getWeekOfYear(date: Date) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const diff = date.getTime() - start.getTime();
    return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  }
}
