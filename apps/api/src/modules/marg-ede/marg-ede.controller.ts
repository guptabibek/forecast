import { InjectQueue } from '@nestjs/bullmq';
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../../core/audit/audit.service';
import { QUEUE_NAMES } from '../../core/queue/queue.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateMargConfigDto, UpdateMargConfigDto } from './dto';
import { MargEdeService } from './marg-ede.service';

@ApiTags('Marg EDE Integration')
@ApiBearerAuth()
@Controller('marg-ede')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MargEdeController {
  constructor(
    private readonly margEdeService: MargEdeService,
    private readonly auditService: AuditService,
    @InjectQueue(QUEUE_NAMES.MARG_SYNC) private readonly margSyncQueue: Queue,
  ) {}

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
  async triggerSync(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    // Queue it as a background job to avoid HTTP timeout
    const job = await this.margSyncQueue.add(
      'marg-sync',
      {
        configId: id,
        tenantId: user.tenantId,
        triggeredBy: user.id,
      },
      { attempts: 1 },
    );

    await this.auditService.log(
      user.tenantId,
      user.id,
      AuditAction.IMPORT,
      'MargSyncConfig',
      id,
      null,
      null,
      [],
      { action: 'marg_sync_triggered', jobId: job.id },
    ).catch(() => {/* best-effort */});

    return {
      jobId: job.id,
      status: 'queued',
      message: 'Marg EDE sync job queued for processing',
    };
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
}
