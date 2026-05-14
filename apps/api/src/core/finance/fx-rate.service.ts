import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class FxRateService {
  constructor(private readonly prisma: PrismaService) {}

  async getRate(tenantId: string, fromCurrency: string, toCurrency: string, asOfDate: Date) {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    const rate = await this.prisma.fxRate.findFirst({
      where: {
        tenantId,
        fromCurrency,
        toCurrency,
        asOfDate: {
          lte: asOfDate,
        },
      },
      orderBy: { asOfDate: 'desc' },
    });

    if (!rate) {
      throw new BadRequestException(`FX rate missing: ${fromCurrency} -> ${toCurrency}`);
    }

    return Number(rate.rate);
  }
}
