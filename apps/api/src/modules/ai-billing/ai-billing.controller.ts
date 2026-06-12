import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiDisputeType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { AiAccessService } from './access.service';
import { BillingReportingService } from './billing-reporting.service';
import { DisputeService } from './dispute.service';
import { PurchaseService } from './purchase.service';
import { WalletService } from './wallet.service';

class StripeCheckoutDto {
  @IsNumber() @Min(1) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) successUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) cancelUrl?: string;
}

class BankTransferDto {
  @IsNumber() @Min(1) amount!: number;
  @IsOptional() @IsString() @MaxLength(1000) proofUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) proofNote?: string;
}

class DisputeCreateDto {
  @IsEnum(AiDisputeType) type!: AiDisputeType;
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(5000) description!: string;
  @IsOptional() @IsString() relatedTransactionId?: string;
  @IsOptional() @IsString() relatedUsageLogId?: string;
}

class DisputeMessageDto {
  @IsString() @MaxLength(5000) body!: string;
  @IsOptional() @IsString() @MaxLength(1000) attachmentUrl?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

/**
 * Customer-facing AI billing: wallet, ledger, purchases (Stripe checkout +
 * bank transfer proof), usage history, and disputes. Tenant-scoped by JWT —
 * no tenant can ever read another tenant's financial records. Note there is
 * deliberately no endpoint to configure providers, models, keys, or pricing.
 */
@ApiTags('AI Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('ai-reporting')
@Controller('ai-billing')
export class AiBillingController {
  constructor(
    private readonly wallets: WalletService,
    private readonly purchases: PurchaseService,
    private readonly disputes: DisputeService,
    private readonly reporting: BillingReportingService,
    private readonly access: AiAccessService,
  ) {}

  @Get('wallet')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'My wallet (balance, reserved, lifetime totals, thresholds)' })
  wallet(@CurrentUser() user: any) {
    return this.wallets.getWalletSummary(user.tenantId);
  }

  @Get('summary')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Month-to-date usage summary + remaining budget for the dashboard' })
  async summary(@CurrentUser() user: any) {
    const [summary, policy] = await Promise.all([
      this.reporting.customerSummary(user.tenantId),
      this.access.getEffectivePolicyForUser(user.tenantId, user.id),
    ]);
    const spent = Number(summary.monthToDate.spend);
    const maxMonthly = policy.maxMonthlySpend === null ? null : Number(policy.maxMonthlySpend);
    return {
      ...summary,
      budget: {
        accessStatus: policy.status,
        maxMonthlySpend: maxMonthly === null ? null : maxMonthly.toFixed(2),
        remainingMonthlyBudget: maxMonthly === null ? null : Math.max(0, maxMonthly - spent).toFixed(2),
        maxDailySpend: policy.maxDailySpend === null ? null : Number(policy.maxDailySpend).toFixed(2),
        maxQueryCost: policy.maxQueryCost === null ? null : Number(policy.maxQueryCost).toFixed(4),
        dailyRequestLimit: policy.dailyRequestLimit,
        monthlyRequestLimit: policy.monthlyRequestLimit,
      },
    };
  }

  @Get('transactions')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'My wallet ledger (every credit and charge)' })
  transactions(@CurrentUser() user: any, @Query() query: PageQuery) {
    return this.wallets.listTransactions({ tenantId: user.tenantId, page: query.page, pageSize: query.pageSize });
  }

  @Get('usage')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'My token-level usage history' })
  usage(@CurrentUser() user: any, @Query() query: PageQuery) {
    return this.reporting.listUsage({ tenantId: user.tenantId, page: query.page, pageSize: query.pageSize });
  }

  @Get('purchases')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'My credit purchase history' })
  purchasesList(@CurrentUser() user: any, @Query() query: PageQuery) {
    return this.purchases.listForTenant(user.tenantId, query.page ?? 1, query.pageSize ?? 50);
  }

  @Post('purchases/stripe-checkout')
  @RequirePermissions('settings:edit')
  @ApiOperation({ summary: 'Buy credits by card — returns a Stripe Checkout URL' })
  stripeCheckout(@CurrentUser() user: any, @Body() body: StripeCheckoutDto) {
    return this.purchases.createStripeCheckout(user, body);
  }

  @Post('purchases/bank-transfer')
  @RequirePermissions('settings:edit')
  @ApiOperation({ summary: 'Submit a bank transfer with payment proof for review' })
  bankTransfer(@CurrentUser() user: any, @Body() body: BankTransferDto) {
    return this.purchases.submitBankTransfer(user, body);
  }

  @Post('purchases/:id/cancel')
  @RequirePermissions('settings:edit')
  @ApiOperation({ summary: 'Cancel my pending purchase' })
  cancelPurchase(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.cancelOwnPending(user, id);
  }

  @Get('disputes')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'My disputes' })
  myDisputes(@CurrentUser() user: any, @Query() query: PageQuery) {
    return this.disputes.list({ tenantId: user.tenantId, page: query.page, pageSize: query.pageSize });
  }

  @Get('disputes/:id')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'My dispute with thread' })
  dispute(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.getWithThread(id, user.tenantId);
  }

  @Post('disputes')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Raise a billing dispute' })
  createDispute(@CurrentUser() user: any, @Body() body: DisputeCreateDto) {
    return this.disputes.create(user, body);
  }

  @Post('disputes/:id/messages')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Reply on my dispute' })
  disputeMessage(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeMessageDto) {
    return this.disputes.addMessage({ id: user.id, tenantId: user.tenantId, isAdmin: false }, id, body);
  }
}
