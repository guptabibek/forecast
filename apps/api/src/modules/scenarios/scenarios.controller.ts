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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { ScenariosService } from './scenarios.service';

@ApiTags('Scenarios')
@ApiBearerAuth()
@Controller('scenarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('forecasting')
export class ScenariosController {
  constructor(private readonly scenariosService: ScenariosService) {}

  @Post()
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Create a new scenario' })
  async create(
    @Body() createDto: CreateScenarioDto,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.create(createDto, user);
  }

  // IMPORTANT: Put specific routes BEFORE parameterized routes
  @Get('compare')
  @ApiOperation({ summary: 'Compare multiple scenarios' })
  async compare(
    @Query('ids') ids: string,
    @CurrentUser() user: any,
  ) {
    const scenarioIds = ids.split(',').map(id => id.trim());
    return this.scenariosService.compare(scenarioIds, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get all scenarios' })
  async findAll(
    @Query('planVersionId') planVersionId: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.findAll(planVersionId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a scenario by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.findOne(id, user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Update a scenario' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateScenarioDto,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.update(id, updateDto, user);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PLANNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a scenario' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    await this.scenariosService.remove(id, user);
  }

  @Post(':id/clone')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Clone a scenario' })
  async clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('name') newName: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.clone(id, newName, user);
  }

  @Post(':id/submit')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Submit scenario for approval' })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.submit(id, user);
  }

  @Post(':id/approve')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Approve scenario' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.approve(id, user);
  }

  @Post(':id/reject')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Reject scenario' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.reject(id, reason, user);
  }

  @Post(':id/lock')
  @Roles('ADMIN', 'FINANCE')
  @ApiOperation({ summary: 'Lock scenario' })
  async lock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.lock(id, reason, user);
  }

  @Post(':id/set-baseline')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Set this scenario as baseline' })
  async setBaseline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.scenariosService.setBaseline(id, user);
  }
}

