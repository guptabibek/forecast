import { InjectQueue } from '@nestjs/bullmq';
import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Optional,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction, MargReconciliationStatus, MargReconciliationType } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../../core/audit/audit.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import {
    CreateMargConfigDto,
    CreateMargGlMappingRuleDto,
    UpdateMargConfigDto,
    UpdateMargGlMappingRuleDto,
} from './dto';
import { MargEdeService } from './marg-ede.service';
import { MARG_SYNC_MODE, MARG_SYNC_SCOPE, MargSyncMode, MargSyncScope } from './marg-sync.types';

@ApiTags('Marg EDE Integration')
@ApiBearerAuth()
@Controller('marg-ede')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('marg-ede')
export class MargEdeController {
  constructor(
    private readonly margEdeService: MargEdeService,
    private readonly auditService: AuditService,
    @Optional() @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue: Queue | null,
  ) {}

  private validateSyncWindow(fromDate?: string, endDate?: string) {
    let validatedFromDate: string | undefined;
    if (fromDate) {
      const trimmed = fromDate.trim();
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('fromDate must be a valid date (YYYY-MM-DD)');
      }
      validatedFromDate = trimmed;
    }

    let validatedEndDate: string | undefined;
    if (endDate) {
      const trimmed = endDate.trim();
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('endDate must be a valid date (YYYY-MM-DD)');
      }
      validatedEndDate = trimmed;
    }

    if (validatedFromDate && validatedEndDate) {
      const start = new Date(validatedFromDate);
      const end = new Date(validatedEndDate);
      if (end < start) {
        throw new BadRequestException('endDate must be on or after fromDate');
      }
    }

    return {
      fromDate: validatedFromDate,
      endDate: validatedEndDate,
    };
  }

  private async triggerSyncRequest(
    configId: string,
    user: any,
    scope: MargSyncScope,
    mode: MargSyncMode,
    fromDate?: string,
    endDate?: string,
  ) {
    const validatedWindow = this.validateSyncWindow(fromDate, endDate);
    const syncLabel = scope === MARG_SYNC_SCOPE.ACCOUNTING ? 'accounting-only' : 'full';
    const operationLabel = mode === MARG_SYNC_MODE.REPROJECT ? 'reprojection' : 'sync';

    if (!this.margSyncQueue) {
      const syncLogId = mode === MARG_SYNC_MODE.REPROJECT
        ? await this.margEdeService.runReprojection(
          configId,
          user.tenantId,
          user.id,
          validatedWindow.fromDate,
          validatedWindow.endDate,
          scope,
        )
        : await this.margEdeService.runSync(
          configId,
          user.tenantId,
          user.id,
          validatedWindow.fromDate,
          validatedWindow.endDate,
          scope,
        );

      await this.auditService.log(
        user.tenantId,
        user.id,
        AuditAction.IMPORT,
        'MargSyncConfig',
        configId,
        null,
        null,
        [],
        {
          action: mode === MARG_SYNC_MODE.REPROJECT ? 'marg_reprojection_completed_inline' : 'marg_sync_completed_inline',
          scope,
          mode,
          syncLogId,
        },
      ).catch(() => {/* best-effort */});

      return {
        syncLogId,
        scope,
        mode,
        status: 'completed',
        message: `Marg EDE ${syncLabel} ${operationLabel} completed inline because Redis background processing is disabled`,
      };
    }

    const job = await this.margSyncQueue.add(
      mode === MARG_SYNC_MODE.REPROJECT
        ? (scope === MARG_SYNC_SCOPE.ACCOUNTING ? 'marg-reproject-accounting' : 'marg-reproject')
        : (scope === MARG_SYNC_SCOPE.ACCOUNTING ? 'marg-sync-accounting' : 'marg-sync'),
      {
        configId,
        tenantId: user.tenantId,
        triggeredBy: user.id,
        fromDate: validatedWindow.fromDate,
        endDate: validatedWindow.endDate,
        scope,
        mode,
      },
      { attempts: 1 },
    );

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.IMPORT,
      'MargSyncConfig',
      configId,
      null,
      null,
      [],
      {
        action: mode === MARG_SYNC_MODE.REPROJECT ? 'marg_reprojection_triggered' : 'marg_sync_triggered',
        scope,
        mode,
        jobId: job.id,
      },
    ).catch(() => {/* best-effort */});

    return {
      jobId: job.id,
      scope,
      mode,
      status: 'queued',
      message: `Marg EDE ${syncLabel} ${operationLabel} job queued for processing`,
    };
  }

  // ==================== CONFIG ENDPOINTS ====================

  @Post('configs')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create Marg EDE sync configuration' })
  async createConfig(@Body() dto: CreateMargConfigDto, @CurrentUser() user: any) {
    return this.margEdeService.createConfig(dto, user);
  }

  @Get('configs')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'List all Marg EDE configurations' })
  async getConfigs(@CurrentUser() user: any) {
    return this.margEdeService.getConfigs(user);
  }

  @Get('configs/:id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Get Marg EDE configuration details' })
  async getConfig(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.margEdeService.getConfig(id, user);
  }

  @Patch('configs/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update Marg EDE configuration' })
  async updateConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMargConfigDto,
    @CurrentUser() user: any,
  ) {
    return this.margEdeService.updateConfig(id, dto, user);
  }

  @Delete('configs/:id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete Marg EDE configuration' })
  async deleteConfig(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.margEdeService.deleteConfig(id, user);
  }

  // ==================== SYNC ENDPOINTS ====================

  @Post('configs/:id/test')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Test Marg EDE connection' })
  async testConnection(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.margEdeService.testConnection(id, user);
  }

  @Post('configs/:id/sync')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Trigger manual Marg EDE data sync' })
  @ApiQuery({ name: 'fromDate', required: false, type: String, description: 'Sync data from this date (YYYY-MM-DD). Omit for automatic incremental sync from last cursor.' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Optional upper bound for business dates (YYYY-MM-DD). Bounded windows skip stock snapshot projection and do not advance the saved cursor.' })
  async triggerSync(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('fromDate') fromDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.triggerSyncRequest(id, user, MARG_SYNC_SCOPE.FULL, MARG_SYNC_MODE.FETCH, fromDate, endDate);
  }

  @Post('configs/:id/sync/accounting')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Trigger manual Marg EDE accounting-only sync' })
  @ApiQuery({ name: 'fromDate', required: false, type: String, description: 'Sync accounting data from this date (YYYY-MM-DD). Omit for automatic incremental sync from last accounting cursor.' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Optional upper bound for accounting business dates (YYYY-MM-DD). Bounded windows do not advance the saved accounting cursor.' })
  async triggerAccountingSync(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('fromDate') fromDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.triggerSyncRequest(id, user, MARG_SYNC_SCOPE.ACCOUNTING, MARG_SYNC_MODE.FETCH, fromDate, endDate);
  }

  @Post('configs/:id/reproject')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Re-run Marg EDE projections from staged data without fetching Marg again' })
  @ApiQuery({ name: 'fromDate', required: false, type: String, description: 'Reproject business dates from this date (YYYY-MM-DD).' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Optional upper bound for business dates (YYYY-MM-DD).' })
  async triggerReprojection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('fromDate') fromDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.triggerSyncRequest(id, user, MARG_SYNC_SCOPE.FULL, MARG_SYNC_MODE.REPROJECT, fromDate, endDate);
  }

  @Post('configs/:id/reproject/accounting')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Re-run Marg accounting projections from staged data without fetching Marg again' })
  @ApiQuery({ name: 'fromDate', required: false, type: String, description: 'Reproject accounting business dates from this date (YYYY-MM-DD).' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Optional upper bound for accounting business dates (YYYY-MM-DD).' })
  async triggerAccountingReprojection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('fromDate') fromDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.triggerSyncRequest(id, user, MARG_SYNC_SCOPE.ACCOUNTING, MARG_SYNC_MODE.REPROJECT, fromDate, endDate);
  }

  @Get('configs/:id/logs')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Get sync history for a Marg config' })
  async getSyncLogs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.margEdeService.getSyncLogs(id, user);
  }

  // ==================== DATA VIEW ENDPOINTS ====================

  @Get('overview')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Get Marg EDE sync overview & staged data counts' })
  async getSyncOverview(@CurrentUser() user: any) {
    return this.margEdeService.getSyncOverview(user.tenantId);
  }

  @Get('gl-accounts')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'List GL accounts available for Marg mapping rules' })
  async getGlAccounts(@CurrentUser() user: any) {
    return this.margEdeService.getGlAccounts(user.tenantId);
  }

  @Get('gl-mapping-rules')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'List tenant-managed Marg GL mapping rules' })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  async getGlMappingRules(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.margEdeService.getGlMappingRules(user.tenantId, {
      companyId: companyId ? Number(companyId) : undefined,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get('gl-mapping-rules/:id')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Get a Marg GL mapping rule' })
  async getGlMappingRule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.margEdeService.getGlMappingRule(id, user.tenantId);
  }

  @Post('gl-mapping-rules')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Create a tenant-managed Marg GL mapping rule' })
  async createGlMappingRule(@Body() dto: CreateMargGlMappingRuleDto, @CurrentUser() user: any) {
    return this.margEdeService.createGlMappingRule(dto, user);
  }

  @Patch('gl-mapping-rules/:id')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Update a Marg GL mapping rule' })
  async updateGlMappingRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMargGlMappingRuleDto,
    @CurrentUser() user: any,
  ) {
    return this.margEdeService.updateGlMappingRule(id, dto, user);
  }

  @Delete('gl-mapping-rules/:id')
  @Roles('ADMIN', 'FINANCE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Marg GL mapping rule' })
  async deleteGlMappingRule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    await this.margEdeService.deleteGlMappingRule(id, user);
  }

  @Get('reconciliation-results')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'List Marg reconciliation results' })
  @ApiQuery({ name: 'configId', required: false, type: String })
  @ApiQuery({ name: 'syncLogId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: MargReconciliationType })
  @ApiQuery({ name: 'status', required: false, enum: MargReconciliationStatus })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async getReconciliationResults(
    @CurrentUser() user: any,
    @Query('configId') configId?: string,
    @Query('syncLogId') syncLogId?: string,
    @Query('type') type?: MargReconciliationType,
    @Query('status') status?: MargReconciliationStatus,
    @Query('take') take?: string,
  ) {
    return this.margEdeService.getReconciliationResults(user.tenantId, {
      configId,
      syncLogId,
      type,
      status,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('staged/branches')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg branches/locations' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedBranches(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedBranches(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/products')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg products' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedProducts(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedProducts(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/parties')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg parties/customers' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedParties(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedParties(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/transactions')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg transactions' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedTransactions(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedTransactions(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/stock')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg stock data' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedStock(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedStock(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/account-postings')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg account postings' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedAccountPostings(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedAccountPostings(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/account-groups')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg account groups' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedAccountGroups(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedAccountGroups(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/account-group-balances')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg account group balances' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedAccountGroupBalances(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedAccountGroupBalances(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/party-balances')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg party balances' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedPartyBalances(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedPartyBalances(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('staged/outstandings')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({ summary: 'View staged Marg outstandings' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async getStagedOutstandings(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.margEdeService.getStagedOutstandings(
      user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }
}
