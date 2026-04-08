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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlanQueryDto } from './dto/plan-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@ApiBearerAuth()
@Controller('plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

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
  ) {
    const plan = await this.plansService.findOne(id, user);
    return {
      data: plan,
      format,
      exportedAt: new Date().toISOString(),
    };
  }
}

