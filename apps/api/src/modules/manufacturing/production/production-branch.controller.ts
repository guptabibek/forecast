import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RequireModule } from '../../platform/require-module.decorator';
import {
    CreateDowntimeReasonDto,
    CreateDowntimeRecordDto,
    CreateProductionLineDto,
    CreateProductionLineStationDto,
    CreateScrapReasonDto,
    UpdateDowntimeReasonDto,
    UpdateDowntimeRecordDto,
    UpdateProductionLineDto,
    UpdateScrapReasonDto,
} from '../dto';
import { ProductionBranchService } from './production-branch.service';

@Controller({ path: 'manufacturing/production', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('manufacturing')
export class ProductionBranchController {
  constructor(private readonly productionService: ProductionBranchService) {}

  @Get('lines')
  getProductionLines(@Request() req: any) {
    return this.productionService.getProductionLines(req.user.tenantId);
  }

  @Get('lines/:id')
  getProductionLine(@Request() req: any, @Param('id') id: string) {
    return this.productionService.getProductionLine(req.user.tenantId, id);
  }

  @Post('lines')
  @Roles('ADMIN', 'PLANNER')
  createProductionLine(@Request() req: any, @Body() dto: CreateProductionLineDto) {
    return this.productionService.createProductionLine(req.user.tenantId, dto);
  }

  @Patch('lines/:id')
  @Roles('ADMIN', 'PLANNER')
  updateProductionLine(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateProductionLineDto) {
    return this.productionService.updateProductionLine(req.user.tenantId, id, dto);
  }

  @Delete('lines/:id')
  @Roles('ADMIN')
  deleteProductionLine(@Request() req: any, @Param('id') id: string) {
    return this.productionService.deleteProductionLine(req.user.tenantId, id);
  }

  @Post('lines/:id/stations')
  @Roles('ADMIN', 'PLANNER')
  addProductionLineStation(@Request() req: any, @Param('id') id: string, @Body() dto: CreateProductionLineStationDto) {
    return this.productionService.addProductionLineStation(req.user.tenantId, id, dto);
  }

  @Delete('lines/:lineId/stations/:stationId')
  @Roles('ADMIN', 'PLANNER')
  removeProductionLineStation(@Request() req: any, @Param('lineId') lineId: string, @Param('stationId') stationId: string) {
    return this.productionService.removeProductionLineStation(req.user.tenantId, lineId, stationId);
  }

  @Get('downtime-reasons')
  getDowntimeReasons(@Request() req: any) {
    return this.productionService.getDowntimeReasons(req.user.tenantId);
  }

  @Post('downtime-reasons')
  @Roles('ADMIN', 'PLANNER')
  createDowntimeReason(@Request() req: any, @Body() dto: CreateDowntimeReasonDto) {
    return this.productionService.createDowntimeReason(req.user.tenantId, dto);
  }

  @Patch('downtime-reasons/:id')
  @Roles('ADMIN', 'PLANNER')
  updateDowntimeReason(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateDowntimeReasonDto) {
    return this.productionService.updateDowntimeReason(req.user.tenantId, id, dto);
  }

  @Delete('downtime-reasons/:id')
  @Roles('ADMIN')
  deleteDowntimeReason(@Request() req: any, @Param('id') id: string) {
    return this.productionService.deleteDowntimeReason(req.user.tenantId, id);
  }

  @Get('downtime-records')
  getDowntimeRecords(
    @Request() req: any,
    @Query('productionLineId') productionLineId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.productionService.getDowntimeRecords(req.user.tenantId, {
      productionLineId,
      startDate,
      endDate,
    });
  }

  @Post('downtime-records')
  @Roles('ADMIN', 'PLANNER', 'OPERATOR')
  createDowntimeRecord(@Request() req: any, @Body() dto: CreateDowntimeRecordDto) {
    return this.productionService.createDowntimeRecord(req.user.tenantId, req.user.id, dto);
  }

  @Patch('downtime-records/:id')
  @Roles('ADMIN', 'PLANNER', 'OPERATOR')
  updateDowntimeRecord(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateDowntimeRecordDto) {
    return this.productionService.updateDowntimeRecord(req.user.tenantId, id, dto);
  }

  @Delete('downtime-records/:id')
  @Roles('ADMIN')
  deleteDowntimeRecord(@Request() req: any, @Param('id') id: string) {
    return this.productionService.deleteDowntimeRecord(req.user.tenantId, id);
  }

  @Get('scrap-reasons')
  getScrapReasons(@Request() req: any) {
    return this.productionService.getScrapReasons(req.user.tenantId);
  }

  @Post('scrap-reasons')
  @Roles('ADMIN', 'PLANNER')
  createScrapReason(@Request() req: any, @Body() dto: CreateScrapReasonDto) {
    return this.productionService.createScrapReason(req.user.tenantId, dto);
  }

  @Patch('scrap-reasons/:id')
  @Roles('ADMIN', 'PLANNER')
  updateScrapReason(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateScrapReasonDto) {
    return this.productionService.updateScrapReason(req.user.tenantId, id, dto);
  }

  @Delete('scrap-reasons/:id')
  @Roles('ADMIN')
  deleteScrapReason(@Request() req: any, @Param('id') id: string) {
    return this.productionService.deleteScrapReason(req.user.tenantId, id);
  }

  @Get('kpis')
  getProductionKPIs(
    @Request() req: any,
    @Query('productionLineId') productionLineId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.productionService.getProductionKPIs(req.user.tenantId, {
      productionLineId,
      startDate,
      endDate,
    });
  }
}
