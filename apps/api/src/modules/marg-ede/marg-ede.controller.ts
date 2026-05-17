import { InjectQueue } from '@nestjs/bullmq';
import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Logger,
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
  private readonly logger = new Logger(MargEdeController.name);

  constructor(
    private readonly margEdeService: MargEdeService,
    private readonly auditService: AuditService,
    @Optional() @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue: Queue | null,
  ) {}

  /**
   * Best-effort auto-recovery for stuck lock state before enqueueing a new
   * sync. forceUnlockConfig with force=false applies a 60-second heartbeat
   * safety check — if a real worker is alive and writing heartbeats, it
   * returns 'active_refused' and we leave the lock alone. If the heartbeat
   * is stale (the worker died, or the lock was orphaned by the old
   * stale-detector), it clears the lock so the new job can proceed.
   *
   * This is the difference between "click Sync, nothing happens for hours"
   * and "click Sync, it just works." We accept any error silently — the
   * downstream runSync lock check is the final authority.
   */
  private async autoHealStuckLock(configId: string, tenantId: string): Promise<void> {
    const result = await this.margEdeService.forceUnlockConfig(configId, tenantId, { force: false });
    if (result.outcome === 'unlocked') {
      this.logger.warn(
        `Auto-healed stuck Marg sync lock before new trigger: configId=${configId}, ` +
        `previousStatus=${JSON.stringify(result.previousStatus)}, ` +
        `syncLogsMarkedFailed=${result.syncLogsMarkedFailed}. ` +
        `The prior sync's worker was either dead or killed by the legacy stale-detector.`,
      );
    }
  }

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
    // Fail loud at the boundary if the JWT didn't carry a tenantId.
    // Without this, the request would 200-OK with status:queued, BullMQ
    // would accept the job (no payload validation), and the worker would
    // fail at "Marg sync job missing tenantId" — silent to the user, who
    // sees nothing happen and no new sync log row. Re-login is the user
    // workaround; this guard makes the next-best UX: a clear 401 that
    // tells them what to do.
    if (!user?.tenantId || typeof user.tenantId !== 'string') {
      throw new BadRequestException(
        'Sync trigger missing tenant context. Your session token does not carry a tenantId. ' +
        'Log out and log back in to refresh your session, then retry.',
      );
    }

    const validatedWindow = this.validateSyncWindow(fromDate, endDate);
    const hasDateWindow = Boolean(validatedWindow.fromDate || validatedWindow.endDate);
    const syncLabel = scope === MARG_SYNC_SCOPE.ACCOUNTING
      ? 'accounting-only'
      : hasDateWindow
        ? 'windowed full'
        : 'incremental full';
    const operationLabel = mode === MARG_SYNC_MODE.REPROJECT ? 'reprojection' : 'sync';

    // Auto-heal stuck lock before enqueueing. A previous sync that was
    // killed by the (now-fixed) stale-detector or a crashed worker can
    // leave margSyncConfig.lastSyncStatus = 'RUNNING' even though nothing
    // is actually running. Without this pre-check, the user clicks Sync,
    // the worker picks up the job, runSync's lock check fails with
    // "Sync is already running", BullMQ marks failed, the UI keeps
    // polling and shows the STALE running state forever — looking like
    // "the sync never starts". We use the same liveness criterion as
    // forceUnlockConfig: heartbeat older than 90 seconds = dead.
    await this.autoHealStuckLock(configId, user.tenantId).catch((err) => {
      // Best-effort: if auto-heal fails (race, transient DB hiccup), the
      // sync still proceeds — runSync's lock check is the final
      // authority, and a real active sync will rightly reject the new
      // request.
      this.logger.warn(`autoHealStuckLock failed for config=${configId}: ${(err as Error).message}`);
    });

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
  @ApiOperation({
    summary: 'Get sync history for a Marg config (50 most recent runs)',
    description:
      'Returns sync logs in MargSyncLogStatusDto shape: legacy fields preserved verbatim, plus current_stage, current_api_type, current_request_index, current_response_index, current_entity_type, current_batch_number, rows_processed (string-encoded), total_rows_discovered, last_heartbeat_at, retry_count, failure_type, resumed_from_sync_log_id, from_date, end_date, sync_mode, sync_scope, heartbeat_age_ms, and is_stale.',
  })
  async getSyncLogs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.margEdeService.getSyncLogs(id, user);
  }

  @Get('configs/:id/syncs/:syncLogId/status')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({
    summary: 'Get the full progress snapshot for a single Marg sync log',
    description:
      'Returns the MargSyncLogStatusDto for one sync log so the UI can show meaningful per-stage / per-batch progress during a long sync. Refuses to surface a log that does not belong to the requested (tenant, config).',
  })
  async getSyncLogStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('syncLogId', ParseUUIDPipe) syncLogId: string,
    @CurrentUser() user: any,
  ) {
    return this.margEdeService.getSyncLogStatus(id, syncLogId, user);
  }

  @Get('configs/locked')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'List Marg sync configs whose lock is currently held (lastSyncStatus=RUNNING)',
    description:
      'Operator diagnostic for "I keep getting Sync is already running for this configuration". Returns every config (within the caller\'s tenant) whose lastSyncStatus or lastAccountingSyncStatus is RUNNING, with the lock age and the matching latest sync log\'s heartbeat. isStale=true means the lock is older than MARG_SYNC_STALE_AFTER_MS and is safe to /force-unlock without worry.',
  })
  async listLockedConfigs(@CurrentUser() user: any) {
    return this.margEdeService.listLockedConfigs(user.tenantId);
  }

  @Post('configs/:id/force-unlock')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Release a stuck config-level lock so the next /sync can proceed',
    description:
      'Marks every still-RUNNING sync log under this config as FAILED_RETRYABLE and resets the config\'s lastSyncStatus/lastAccountingSyncStatus to FAILED. Refuses by default if the latest sync log produced a heartbeat in the last 60 seconds (= an active worker is still running). Pass force=true ONLY when you are CERTAIN the worker process is dead (e.g. you just restarted the container). After unlock, the operator typically runs /resume on the affected sync logs to recover their progress without refetching from Marg.',
  })
  @ApiQuery({ name: 'force', required: false, type: Boolean, description: 'Bypass the recent-heartbeat safety check. Use only when the worker process is known-dead.' })
  async forceUnlockConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('force') force?: string,
  ) {
    const result = await this.margEdeService.forceUnlockConfig(id, user.tenantId, {
      force: force === 'true' || force === '1',
    });
    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'MargSyncConfig',
      id,
      null,
      null,
      [],
      { action: 'marg_sync_force_unlock', ...result },
    ).catch(() => {/* best-effort */});
    return result;
  }

  @Post('configs/:id/syncs/:syncLogId/recover-stale')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Mark a stale RUNNING Marg sync log as FAILED_RETRYABLE so resume / fresh sync can proceed',
    description:
      'Use when a sync log has been RUNNING for longer than MARG_SYNC_STALE_AFTER_MS (default 30 min) with no recent heartbeat — typically because the worker crashed before its outer catch handler could mark the log FAILED. This endpoint NEVER auto-resumes; it only releases the config lock and classifies the log so an operator can decide whether to /resume, start fresh, or investigate. A healthy heartbeat returns outcome=not_stale and leaves the log untouched.',
  })
  async recoverStaleSyncLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('syncLogId', ParseUUIDPipe) syncLogId: string,
    @CurrentUser() user: any,
  ) {
    const result = await this.margEdeService.recoverStaleSyncLog(id, user.tenantId, syncLogId);
    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'MargSyncLog',
      syncLogId,
      null,
      null,
      [],
      { action: 'marg_sync_stale_recovery', configId: id, ...result },
    ).catch(() => {/* best-effort */});
    return result;
  }

  @Post('raw-pages/cleanup')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Delete raw-page payload files older than the supplied age',
    description:
      'Operator-triggered retention sweep over MARG_RAW_PAGE_STORAGE_DIR. Walks <tenant>/<config>/<syncLog>/ directories and deletes any whose mtime is older than maxAgeDays. Does NOT touch the marg_raw_sync_pages DB rows — operators wanting to purge those should also DELETE FROM marg_raw_sync_pages WHERE storage_path IS NULL after the sweep. Default age is 30 days; minimum is 1 day to guard against accidental immediate purges.',
  })
  @ApiQuery({ name: 'maxAgeDays', required: false, type: Number, description: 'Minimum 1, default 30.' })
  async cleanupRawPages(
    @CurrentUser() user: any,
    @Query('maxAgeDays') maxAgeDays?: string,
  ) {
    const days = Math.max(1, Number(maxAgeDays) || 30);
    const result = await this.margEdeService.cleanupRawPageStorage(days * 24 * 60 * 60 * 1000);
    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.DELETE,
      'MargRawSyncPage',
      null,
      null,
      null,
      [],
      { action: 'marg_raw_page_cleanup', maxAgeDays: days, ...result },
    ).catch(() => {/* best-effort */});
    return { maxAgeDays: days, ...result };
  }

  @Post('configs/:id/syncs/:syncLogId/resume')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({
    summary: 'Resume a failed Marg sync from saved raw pages without refetching from Marg',
    description:
      'Re-stages every MargRawSyncPage row attached to the supplied syncLogId by reading the parsed payload back from the durable raw-page storage backend. Allowed only when the prior run failed with a RETRYABLE classification (or is a stale RUNNING with no recent heartbeat). After this completes, run /reproject to also re-run transforms/projections from the now-complete staged data.',
  })
  async resumeSync(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('syncLogId', ParseUUIDPipe) syncLogId: string,
    @CurrentUser() user: any,
  ) {
    if (this.margSyncQueue) {
      const job = await this.margSyncQueue.add(
        'marg-resume',
        {
          configId: id,
          tenantId: user.tenantId,
          triggeredBy: user.id,
          mode: MARG_SYNC_MODE.RESUME,
          resumeSyncLogId: syncLogId,
        },
        { attempts: 1 },
      );
      await this.auditService.log(
        user.tenantId,
        user.id,
        AuditAction.IMPORT,
        'MargSyncLog',
        syncLogId,
        null,
        null,
        [],
        { action: 'marg_sync_resume_queued', jobId: job.id, configId: id },
      ).catch(() => {/* best-effort */});
      return {
        jobId: job.id,
        syncLogId,
        status: 'queued',
        message: 'Marg EDE resume job queued for processing',
      };
    }

    const result = await this.margEdeService.resumeSync(id, user.tenantId, syncLogId, user.id);
    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.IMPORT,
      'MargSyncLog',
      syncLogId,
      null,
      null,
      [],
      { action: 'marg_sync_resume_completed_inline', configId: id, ...result },
    ).catch(() => {/* best-effort */});
    return {
      ...result,
      status: result.pagesFailed === 0 ? 'completed' : 'partial',
      message: result.pagesFailed === 0
        ? `Resumed ${result.pagesResumed} page(s); ${result.pagesAlreadyStaged} already staged. Run /reproject next to apply transforms.`
        : `Resumed ${result.pagesResumed} page(s) with ${result.pagesFailed} failures. Inspect sync log for details.`,
    };
  }

  @Post('configs/:id/reset-cursor')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Reset Marg pagination cursor so the next sync pulls a complete snapshot',
    description:
      'Clears lastSyncIndex/lastSyncDatetime (and optionally accounting cursors) so the next /sync call starts from index 0 and refetches every Marg row. Use when stock or report totals diverge from Marg ERP because a stale cursor caused unchanged batches to never be re-emitted. Pass clearStaging=true to also flag every staged stock row as deleted, forcing a complete reseed (slow, but exhaustive).',
  })
  @ApiQuery({ name: 'scope', required: false, enum: ['FULL', 'ACCOUNTING'], description: 'Limit the reset to inventory or accounting cursors. Default resets both.' })
  @ApiQuery({ name: 'clearStaging', required: false, type: Boolean, description: 'When true, marks every staged Marg stock row as sourceDeleted so the next sync repopulates them from scratch.' })
  async resetSyncCursor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Query('scope') scope?: string,
    @Query('clearStaging') clearStaging?: string,
  ) {
    const normalizedScope = scope === 'ACCOUNTING'
      ? MARG_SYNC_SCOPE.ACCOUNTING
      : scope === 'FULL'
        ? MARG_SYNC_SCOPE.FULL
        : undefined;
    const result = await this.margEdeService.resetSyncCursor(id, user.tenantId, {
      scope: normalizedScope,
      clearStaging: clearStaging === 'true' || clearStaging === '1',
    });
    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.UPDATE,
      'MargSyncConfig',
      id,
      null,
      null,
      [],
      { action: 'marg_sync_cursor_reset', ...result },
    ).catch(() => {/* best-effort */});
    return result;
  }

  @Get('stock-diagnostic')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({
    summary: 'Inspect raw Marg stock data for a product (debug stock mismatches)',
    description:
      'Returns the per-batch MargStock rows plus aggregated totals (sum opening, sum stock, broken stock, deleted batches) and the InventoryLevel.onHandQty currently shown in reports, so the user can pinpoint exactly where a Marg vs dashboard discrepancy comes from. Filter by Marg PID, product code substring, or product name substring.',
  })
  @ApiQuery({ name: 'pid', required: false, type: String, description: 'Marg PID (exact match)' })
  @ApiQuery({ name: 'productCode', required: false, type: String, description: 'Marg product Code substring (case-insensitive)' })
  @ApiQuery({ name: 'productName', required: false, type: String, description: 'Marg product Name substring (case-insensitive)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max products to return (default 50, max 500)' })
  async getStockDiagnostic(
    @CurrentUser() user: any,
    @Query('pid') pid?: string,
    @Query('productCode') productCode?: string,
    @Query('productName') productName?: string,
    @Query('limit') limit?: string,
  ) {
    return this.margEdeService.getStockProjectionDiagnostic(user.tenantId, {
      pid,
      productCode,
      productName,
      limit: limit ? Number(limit) : undefined,
    });
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

  // ==================== OUTSTANDING & LEDGER REPORTS ====================

  @Get('reports/outstanding')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({
    summary: 'Outstanding receivables / payables summary by party',
    description:
      'Returns per-party open balances broken into Marg-style aging buckets (current / 31-60 / 61-90 / 91+) plus grand totals. Filter partyType=CUSTOMER (sundry debtors, group prefix C) or partyType=SUPPLIER (sundry creditors, group prefix D) — without it, both flow into the same response.',
  })
  @ApiQuery({ name: 'partyType', required: false, enum: ['CUSTOMER', 'SUPPLIER', 'ALL'] })
  @ApiQuery({ name: 'companyId', required: false, type: Number, description: 'Limit to a specific Marg company / branch.' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getOutstandingSummary(
    @CurrentUser() user: any,
    @Query('partyType') partyType?: string,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const normalizedType = partyType === 'CUSTOMER' || partyType === 'SUPPLIER' || partyType === 'ALL'
      ? partyType
      : 'ALL';
    return this.margEdeService.getMargOutstandingSummary(user.tenantId, {
      partyType: normalizedType,
      companyId: companyId ? Number(companyId) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('reports/outstanding/:partyCode')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({
    summary: 'Outstanding invoice detail for a single party',
    description: 'Per-invoice breakdown for a specific customer or supplier — VCN, date, days outstanding, original amount, current balance, post-dated less, and aging bucket.',
  })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'includeSettled', required: false, type: Boolean, description: 'Include rows with balance=0 (default false).' })
  async getOutstandingDetail(
    @CurrentUser() user: any,
    @Param('partyCode') partyCode: string,
    @Query('companyId') companyId?: string,
    @Query('includeSettled') includeSettled?: string,
  ) {
    return this.margEdeService.getMargOutstandingDetail(user.tenantId, partyCode, {
      companyId: companyId ? Number(companyId) : undefined,
      includeSettled: includeSettled === 'true' || includeSettled === '1',
    });
  }

  @Get('reports/ledger/:partyCode')
  @Roles('ADMIN', 'FINANCE', 'PLANNER')
  @ApiOperation({
    summary: 'Tally-style party ledger with opening, transactions, closing',
    description:
      'Returns the full chronological ledger for a customer or supplier: opening balance (from Marg PartyBalance, or summed from postings before the window), every posting in the date window with running balance, and closing. Each row carries voucher number, source book (Sales / Purchase / Receipt / Payment / Journal / …), counter-party code+name, Marg remark, and signed Debit / Credit amounts. Mirrors a Tally party ledger printout.',
  })
  @ApiQuery({ name: 'companyId', required: false, type: Number })
  @ApiQuery({ name: 'fromDate', required: false, type: String, description: 'YYYY-MM-DD inclusive lower bound.' })
  @ApiQuery({ name: 'toDate', required: false, type: String, description: 'YYYY-MM-DD inclusive upper bound.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Default 200, max 5000.' })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getPartyLedger(
    @CurrentUser() user: any,
    @Param('partyCode') partyCode: string,
    @Query('companyId') companyId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.margEdeService.getMargPartyLedger(user.tenantId, partyCode, {
      companyId: companyId ? Number(companyId) : undefined,
      fromDate,
      toDate,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
