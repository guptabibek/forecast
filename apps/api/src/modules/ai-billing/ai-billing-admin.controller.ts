import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AiAccessScope,
  AiAccessStatus,
  AiBillingModelStatus,
  AiBillingProviderStatus,
  AiDisputeStatus,
  AiLedgerType,
  AiPricingScope,
  AiPricingStatus,
  AiPurchaseStatus,
  AiRefundKind,
  AiWalletStatus,
  TenantTier,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AiAccessService } from './access.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingReportingService } from './billing-reporting.service';
import { DisputeService } from './dispute.service';
import { PricingService } from './pricing.service';
import { PurchaseService } from './purchase.service';
import { RefundService } from './refund.service';
import { AiRegistryService } from './registry.service';
import { WalletService } from './wallet.service';

class ProviderDto {
  @IsString() @MaxLength(100) name!: string;
  @IsString() @IsIn(['openai', 'anthropic', 'gemini', 'azure_openai', 'custom']) kind!: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(500) endpointUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) organizationId?: string;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsEnum(AiBillingProviderStatus) status?: AiBillingProviderStatus;
}

class ProviderUpdateDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @IsIn(['openai', 'anthropic', 'gemini', 'azure_openai', 'custom']) kind?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsBoolean() clearApiKey?: boolean;
  @IsOptional() @IsString() @MaxLength(500) endpointUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(200) organizationId?: string | null;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsEnum(AiBillingProviderStatus) status?: AiBillingProviderStatus;
}

class ModelDto {
  @IsUUID('4') providerId!: string;
  @IsString() @MaxLength(120) modelCode!: string;
  @IsOptional() @IsString() @MaxLength(160) displayName?: string;
  @IsOptional() @IsInt() @Min(1) maxContext?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsEnum(AiBillingModelStatus) status?: AiBillingModelStatus;
  @IsOptional() @IsObject() capabilities?: Record<string, unknown>;
}

class ModelUpdateDto {
  @IsOptional() @IsString() @MaxLength(160) displayName?: string;
  @IsOptional() @IsInt() @Min(1) maxContext?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsEnum(AiBillingModelStatus) status?: AiBillingModelStatus;
  @IsOptional() @IsObject() capabilities?: Record<string, unknown>;
}

class PricingDto {
  @IsUUID('4') modelId!: string;
  @IsEnum(AiPricingScope) scope!: AiPricingScope;
  @IsOptional() @IsEnum(TenantTier) planTier?: TenantTier;
  @IsOptional() @IsUUID('4') tenantId?: string;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsEnum(AiPricingStatus) status?: AiPricingStatus;
  @IsString() effectiveFrom!: string;
  @IsOptional() @IsString() effectiveTo?: string | null;
  @IsOptional() @IsNumber() @Min(0) providerInputCost?: number;
  @IsOptional() @IsNumber() @Min(0) providerOutputCost?: number;
  @IsOptional() @IsNumber() @Min(0) providerCachedInputCost?: number;
  @IsOptional() @IsNumber() @Min(0) providerReasoningCost?: number;
  @IsOptional() @IsNumber() @Min(0) providerEmbeddingCost?: number;
  @IsOptional() @IsNumber() @Min(0) providerImageCost?: number;
  @IsOptional() @IsNumber() @Min(0) customerInputPrice?: number;
  @IsOptional() @IsNumber() @Min(0) customerOutputPrice?: number;
  @IsOptional() @IsNumber() @Min(0) customerCachedInputPrice?: number;
  @IsOptional() @IsNumber() @Min(0) customerReasoningPrice?: number;
  @IsOptional() @IsNumber() @Min(0) customerEmbeddingPrice?: number;
  @IsOptional() @IsNumber() @Min(0) customerImagePrice?: number;
}

class SimulateDto {
  @IsUUID('4') modelId!: string;
  @IsOptional() @IsUUID('4') tenantId?: string;
  @IsOptional() @IsEnum(TenantTier) planTier?: TenantTier;
  @IsInt() @Min(0) promptTokens!: number;
  @IsInt() @Min(0) completionTokens!: number;
  @IsOptional() @IsInt() @Min(0) cachedTokens?: number;
  @IsOptional() @IsInt() @Min(0) reasoningTokens?: number;
}

class AccessPolicyDto {
  @IsEnum(AiAccessScope) scope!: AiAccessScope;
  @IsOptional() @IsUUID('4') tenantId?: string;
  @IsOptional() @IsUUID('4') userId?: string;
  @IsOptional() @IsEnum(TenantTier) planTier?: TenantTier;
  @IsOptional() @IsEnum(AiAccessStatus) status?: AiAccessStatus;
  @IsOptional() @IsArray() allowedModelCodes?: string[] | null;
  @IsOptional() @IsInt() @Min(0) dailyRequestLimit?: number | null;
  @IsOptional() @IsInt() @Min(0) monthlyRequestLimit?: number | null;
  @IsOptional() @IsNumber() @Min(0) maxQueryCost?: number | null;
  @IsOptional() @IsNumber() @Min(0) maxDailySpend?: number | null;
  @IsOptional() @IsNumber() @Min(0) maxMonthlySpend?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class WalletAdjustmentDto {
  @IsNumber() amount!: number;
  @IsIn(['MANUAL_CREDIT', 'BONUS_CREDIT', 'PROMO_CREDIT', 'ADMIN_ADJUSTMENT', 'CORRECTION', 'CREDIT_EXPIRY'])
  type!: AiLedgerType;
  @IsString() @MaxLength(1000) reason!: string;
}

class WalletSettingsDto {
  @IsOptional() @IsEnum(AiWalletStatus) status?: AiWalletStatus;
  @IsOptional() @IsNumber() lowBalanceThreshold?: number | null;
  @IsOptional() @IsNumber() criticalBalanceThreshold?: number | null;
  @IsOptional() @IsNumber() suspendThreshold?: number | null;
  @IsOptional() @IsBoolean() autoRechargeEnabled?: boolean;
  @IsOptional() @IsNumber() autoRechargeThreshold?: number | null;
  @IsOptional() @IsNumber() autoRechargeAmount?: number | null;
  @IsOptional() @IsNumber() autoRechargeMonthlyLimit?: number | null;
}

class ReviewDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class RefundDto {
  @IsUUID('4') tenantId!: string;
  @IsNumber() @Min(0.000001) amount!: number;
  @IsEnum(AiRefundKind) kind!: AiRefundKind;
  @IsString() @MaxLength(1000) reason!: string;
  @IsOptional() @IsUUID('4') purchaseId?: string;
  @IsOptional() @IsUUID('4') disputeId?: string;
  @IsOptional() @IsString() @MaxLength(1000) evidenceUrl?: string;
}

class DisputeActionDto {
  @IsIn(['APPROVE_REFUND', 'PARTIAL_REFUND', 'REJECT', 'ISSUE_BONUS_CREDITS', 'REVERSE_CHARGE', 'MANUAL_ADJUSTMENT', 'ESCALATE'])
  action!: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsEnum(AiRefundKind) kind?: AiRefundKind;
  @IsOptional() @IsUUID('4') transactionId?: string;
  @IsOptional() @IsUUID('4') purchaseId?: string;
  @IsOptional() @IsUUID('4') assignedToId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class DisputeMessageDto {
  @IsString() @MaxLength(5000) body!: string;
  @IsOptional() @IsString() @MaxLength(1000) attachmentUrl?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

const actorOf = (user: any, ip: string) => ({ id: user.id, email: user.email, role: user.role, ip });

/**
 * Super-admin surface of the AI Billing platform: providers, models, pricing,
 * wallets, purchases review, disputes, refunds, access policies, audit log,
 * and financial reporting. Tenants NEVER reach these endpoints.
 */
@ApiTags('AI Billing (Platform Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('platform/ai-billing')
export class AiBillingAdminController {
  constructor(
    private readonly registry: AiRegistryService,
    private readonly pricing: PricingService,
    private readonly wallets: WalletService,
    private readonly purchases: PurchaseService,
    private readonly refunds: RefundService,
    private readonly disputes: DisputeService,
    private readonly access: AiAccessService,
    private readonly reporting: BillingReportingService,
    private readonly audit: BillingAuditService,
  ) {}

  // ── Dashboard / reporting ──────────────────────────────────────────────────

  @Get('overview')
  @ApiOperation({ summary: 'Platform billing metrics (revenue, margin, outstanding credits, disputes)' })
  overview() { return this.reporting.adminOverview(); }

  @Get('trends')
  @ApiOperation({ summary: 'Daily revenue/consumption/cost trend series' })
  trends(@Query('days') days?: string) { return this.reporting.adminTrends(days ? Number(days) : 30); }

  @Get('reports/models')
  @ApiOperation({ summary: 'Model-level usage and profitability' })
  modelReport(@Query('days') days?: string) { return this.reporting.modelBreakdown(days ? Number(days) : 30); }

  @Get('reports/tenants')
  @ApiOperation({ summary: 'Customer usage and spend report' })
  tenantReport(@Query('days') days?: string) { return this.reporting.tenantBreakdown(days ? Number(days) : 30); }

  // ── Providers ──────────────────────────────────────────────────────────────

  @Get('providers')
  @ApiOperation({ summary: 'List AI providers (keys masked)' })
  listProviders() { return this.registry.listProviders(); }

  @Post('providers')
  @ApiOperation({ summary: 'Create an AI provider' })
  createProvider(@CurrentUser() user: any, @Ip() ip: string, @Body() body: ProviderDto) {
    return this.registry.createProvider(body, actorOf(user, ip));
  }

  @Patch('providers/:id')
  @ApiOperation({ summary: 'Update an AI provider (key rotation, priority, status)' })
  updateProvider(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ProviderUpdateDto) {
    return this.registry.updateProvider(id, body, actorOf(user, ip));
  }

  @Delete('providers/:id')
  @ApiOperation({ summary: 'Delete an AI provider' })
  deleteProvider(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.registry.deleteProvider(id, actorOf(user, ip));
  }

  // ── Models ─────────────────────────────────────────────────────────────────

  @Get('models')
  @ApiOperation({ summary: 'List AI models' })
  listModels(@Query('providerId') providerId?: string) {
    return this.registry.listModels(providerId ? { providerId } : undefined);
  }

  @Post('models')
  @ApiOperation({ summary: 'Create an AI model' })
  createModel(@CurrentUser() user: any, @Ip() ip: string, @Body() body: ModelDto) {
    return this.registry.createModel(body, actorOf(user, ip));
  }

  @Patch('models/:id')
  @ApiOperation({ summary: 'Update an AI model (status, default, capabilities)' })
  updateModel(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ModelUpdateDto) {
    return this.registry.updateModel(id, body, actorOf(user, ip));
  }

  @Delete('models/:id')
  @ApiOperation({ summary: 'Delete an AI model' })
  deleteModel(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.registry.deleteModel(id, actorOf(user, ip));
  }

  // ── Pricing ────────────────────────────────────────────────────────────────

  @Get('pricing')
  @ApiOperation({ summary: 'List pricing rows' })
  listPricing(@Query('modelId') modelId?: string, @Query('scope') scope?: AiPricingScope, @Query('tenantId') tenantId?: string) {
    return this.pricing.list({ modelId, scope, tenantId });
  }

  @Post('pricing')
  @ApiOperation({ summary: 'Create a pricing row (global, plan, or tenant scope)' })
  createPricing(@CurrentUser() user: any, @Ip() ip: string, @Body() body: PricingDto) {
    return this.pricing.create(body, actorOf(user, ip));
  }

  @Patch('pricing/:id')
  @ApiOperation({ summary: 'Update a pricing row' })
  updatePricing(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Partial<PricingDto>) {
    return this.pricing.update(id, body, actorOf(user, ip));
  }

  @Post('pricing/simulate')
  @ApiOperation({ summary: 'Pricing simulator: provider cost vs customer charge vs margin' })
  simulate(@Body() body: SimulateDto) { return this.pricing.simulate(body); }

  // ── Wallets ────────────────────────────────────────────────────────────────

  @Get('wallets/:tenantId')
  @ApiOperation({ summary: 'Tenant wallet summary' })
  wallet(@Param('tenantId', ParseUUIDPipe) tenantId: string) { return this.wallets.getWalletSummary(tenantId); }

  @Get('wallets/:tenantId/transactions')
  @ApiOperation({ summary: 'Tenant ledger' })
  walletLedger(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Query() query: PageQuery) {
    return this.wallets.listTransactions({ tenantId, page: query.page, pageSize: query.pageSize });
  }

  @Post('wallets/:tenantId/adjustments')
  @ApiOperation({ summary: 'Post a manual ledger adjustment (credit/debit) to a wallet' })
  adjustWallet(
    @CurrentUser() user: any, @Ip() ip: string,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: WalletAdjustmentDto,
  ) {
    return this.wallets.postTransaction({
      tenantId,
      type: body.type,
      amount: body.amount,
      createdById: user.id,
      notes: body.reason,
      relatedEntityType: 'admin_adjustment',
    });
  }

  @Patch('wallets/:tenantId/settings')
  @ApiOperation({ summary: 'Update wallet thresholds / status / auto-recharge' })
  walletSettings(
    @CurrentUser() user: any, @Ip() ip: string,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: WalletSettingsDto,
  ) {
    return this.wallets.updateWalletSettings(tenantId, body, actorOf(user, ip));
  }

  // ── Purchases (bank transfer review queue) ─────────────────────────────────

  @Get('purchases/review-queue')
  @ApiOperation({ summary: 'Bank transfer purchases awaiting review' })
  reviewQueue(@Query('status') status?: AiPurchaseStatus) { return this.purchases.listReviewQueue(status); }

  @Post('purchases/:id/review')
  @ApiOperation({ summary: 'Approve or reject a bank transfer purchase' })
  review(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto) {
    return this.purchases.reviewBankTransfer(actorOf(user, ip) as any, id, body);
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  @Get('refunds')
  @ApiOperation({ summary: 'List refunds' })
  listRefunds(@Query('tenantId') tenantId?: string, @Query() query?: PageQuery) {
    return this.refunds.list({ tenantId, page: query?.page, pageSize: query?.pageSize });
  }

  @Post('refunds')
  @ApiOperation({ summary: 'Issue a refund (wallet credit or cash via Stripe)' })
  createRefund(@CurrentUser() user: any, @Ip() ip: string, @Body() body: RefundDto) {
    return this.refunds.create(actorOf(user, ip) as any, body);
  }

  // ── Disputes ───────────────────────────────────────────────────────────────

  @Get('disputes')
  @ApiOperation({ summary: 'List disputes across tenants' })
  listDisputes(@Query('status') status?: AiDisputeStatus, @Query() query?: PageQuery) {
    return this.disputes.list({ status, page: query?.page, pageSize: query?.pageSize });
  }

  @Get('disputes/:id')
  @ApiOperation({ summary: 'Dispute with full thread' })
  getDispute(@Param('id', ParseUUIDPipe) id: string) { return this.disputes.getWithThread(id); }

  @Post('disputes/:id/messages')
  @ApiOperation({ summary: 'Reply on a dispute thread as admin' })
  disputeMessage(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeMessageDto) {
    return this.disputes.addMessage({ id: user.id, isAdmin: true }, id, body);
  }

  @Patch('disputes/:id/status')
  @ApiOperation({ summary: 'Move a dispute through its workflow' })
  disputeStatus(
    @CurrentUser() user: any, @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: AiDisputeStatus; note?: string },
  ) {
    return this.disputes.updateStatus(actorOf(user, ip), id, body.status, body.note);
  }

  @Post('disputes/:id/actions')
  @ApiOperation({ summary: 'Resolve a dispute (refund / bonus / reversal / adjustment / reject / escalate)' })
  disputeAction(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeActionDto) {
    return this.disputes.adminAction(actorOf(user, ip), id, body as any);
  }

  // ── Access policies ────────────────────────────────────────────────────────

  @Get('access-policies')
  @ApiOperation({ summary: 'List AI access policies' })
  listPolicies(@Query('scope') scope?: AiAccessScope, @Query('tenantId') tenantId?: string) {
    return this.access.listPolicies({ scope, tenantId });
  }

  @Post('access-policies')
  @ApiOperation({ summary: 'Create or update the policy for a user/tenant/plan' })
  upsertPolicy(@CurrentUser() user: any, @Ip() ip: string, @Body() body: AccessPolicyDto) {
    return this.access.upsertPolicy(body, actorOf(user, ip));
  }

  @Delete('access-policies/:id')
  @ApiOperation({ summary: 'Delete an access policy' })
  deletePolicy(@CurrentUser() user: any, @Ip() ip: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.deletePolicy(id, actorOf(user, ip));
  }

  // ── Usage + audit ──────────────────────────────────────────────────────────

  @Get('usage')
  @ApiOperation({ summary: 'Token-level usage logs (filter by tenant)' })
  usage(@Query('tenantId') tenantId?: string, @Query() query?: PageQuery) {
    return this.reporting.listUsage({ tenantId, page: query?.page, pageSize: query?.pageSize });
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Immutable billing audit trail' })
  auditLog(
    @Query('tenantId') tenantId?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query() query?: PageQuery,
  ) {
    return this.audit.list({ tenantId, entityType, action, page: query?.page, pageSize: query?.pageSize });
  }
}
