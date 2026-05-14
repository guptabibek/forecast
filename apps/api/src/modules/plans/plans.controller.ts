import {
    BadRequestException,
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
    Res,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlanQueryDto } from './dto/plan-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@ApiBearerAuth()
@Controller('plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('planning')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  private toCsvValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);
    if (/[",\n\r]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  private toCsvRow(values: unknown[]): string {
    return values.map((value) => this.toCsvValue(value)).join(',');
  }

  private sanitizeFileName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'plan-export';
  }

  private buildPlanCsv(plan: any): string {
    const rows: string[] = [];

    rows.push(this.toCsvRow(['Plan Summary']));
    rows.push(this.toCsvRow(['Field', 'Value']));
    rows.push(this.toCsvRow(['Name', plan.name]));
    rows.push(this.toCsvRow(['Description', plan.description || '']));
    rows.push(this.toCsvRow(['Status', plan.status]));
    rows.push(this.toCsvRow(['Plan Type', plan.planType || '']));
    rows.push(this.toCsvRow(['Fiscal Year', plan.fiscalYear || '']));
    rows.push(this.toCsvRow(['Start Date', plan.startDate]));
    rows.push(this.toCsvRow(['End Date', plan.endDate]));
    rows.push(this.toCsvRow(['Created By', plan.createdBy?.email || '']));
    rows.push(this.toCsvRow(['Approved By', plan.approvedBy?.email || '']));
    rows.push(this.toCsvRow(['Scenario Count', plan._count?.scenarios || plan.scenarios?.length || 0]));
    rows.push(this.toCsvRow(['Forecast Count', plan._count?.forecasts || plan.forecasts?.length || 0]));
    rows.push('');

    rows.push(this.toCsvRow(['Scenarios']));
    rows.push(this.toCsvRow(['ID', 'Name', 'Type', 'Baseline', 'Forecast Count', 'Assumption Count']));
    for (const scenario of plan.scenarios || []) {
      rows.push(this.toCsvRow([
        scenario.id,
        scenario.name,
        scenario.scenarioType,
        scenario.isBaseline ? 'YES' : 'NO',
        scenario._count?.forecasts || 0,
        scenario._count?.assumptions || 0,
      ]));
    }
    rows.push('');

    rows.push(this.toCsvRow(['Forecasts']));
    rows.push(this.toCsvRow([
      'ID',
      'Scenario',
      'Product Code',
      'Product Name',
      'Location Code',
      'Location Name',
      'Period Date',
      'Period Type',
      'Model',
      'Amount',
      'Quantity',
      'Currency',
    ]));
    for (const forecast of plan.forecasts || []) {
      rows.push(this.toCsvRow([
        forecast.id,
        forecast.scenario?.name || '',
        forecast.product?.code || '',
        forecast.product?.name || '',
        forecast.location?.code || '',
        forecast.location?.name || '',
        forecast.periodDate,
        forecast.periodType,
        forecast.forecastModel || '',
        forecast.forecastAmount || '',
        forecast.forecastQuantity || '',
        forecast.currency || '',
      ]));
    }

    return `${rows.join('\r\n')}\r\n`;
  }

  @Post()
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Create a new plan' })
  async create(
    @Body() createPlanDto: CreatePlanDto,
    @CurrentUser() user: any,
  ) {
    return this.plansService.create(createPlanDto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get all plans' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async findAll(@Query() query: PlanQueryDto, @CurrentUser() user: any) {
    return this.plansService.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a plan by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.findOne(id, user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Update a plan' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePlanDto: UpdatePlanDto,
    @CurrentUser() user: any,
  ) {
    return this.plansService.update(id, updatePlanDto, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a plan' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    await this.plansService.remove(id, user);
  }

  @Post(':id/clone')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Clone an existing plan' })
  async clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('name') name: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.clone(id, name, user);
  }

  @Post(':id/submit')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Submit plan for approval' })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.submit(id, user);
  }

  @Post(':id/approve')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Approve a plan' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.approve(id, user);
  }

  @Post(':id/reject')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Reject a plan' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.reject(id, reason, user);
  }

  @Post(':id/archive')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Archive a plan' })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.archive(id, user);
  }

  @Post(':id/lock')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Lock a plan' })
  async lock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.lock(id, reason || 'Locked by user', user);
  }

  @Post(':id/unlock')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Unlock a plan' })
  async unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.unlock(id, user);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get plan version history' })
  async getVersionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.plansService.getVersionHistory(id, user);
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Export plan data' })
  async exportPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string = 'csv',
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const plan = await this.plansService.findOne(id, user);
    const requestedFormat = format.toLowerCase();

    if (requestedFormat !== 'csv') {
      throw new BadRequestException('Only CSV export is currently supported for plans');
    }

    const fileName = `${this.sanitizeFileName(plan.name || id)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    return this.buildPlanCsv(plan);
  }
}

