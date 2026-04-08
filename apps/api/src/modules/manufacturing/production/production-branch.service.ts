import { Injectable } from '@nestjs/common';
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
import { ManufacturingService } from '../manufacturing.service';

@Injectable()
export class ProductionBranchService {
  constructor(private readonly manufacturingService: ManufacturingService) {}

  getProductionLines(tenantId: string) {
    return this.manufacturingService.getProductionLines(tenantId);
  }

  getProductionLine(tenantId: string, id: string) {
    return this.manufacturingService.getProductionLine(tenantId, id);
  }

  createProductionLine(tenantId: string, dto: CreateProductionLineDto) {
    return this.manufacturingService.createProductionLine(tenantId, dto);
  }

  updateProductionLine(tenantId: string, id: string, dto: UpdateProductionLineDto) {
    return this.manufacturingService.updateProductionLine(tenantId, id, dto);
  }

  deleteProductionLine(tenantId: string, id: string) {
    return this.manufacturingService.deleteProductionLine(tenantId, id);
  }

  addProductionLineStation(tenantId: string, lineId: string, dto: CreateProductionLineStationDto) {
    return this.manufacturingService.addProductionLineStation(tenantId, lineId, dto);
  }

  removeProductionLineStation(tenantId: string, lineId: string, stationId: string) {
    return this.manufacturingService.removeProductionLineStation(tenantId, lineId, stationId);
  }

  getDowntimeReasons(tenantId: string) {
    return this.manufacturingService.getDowntimeReasons(tenantId);
  }

  createDowntimeReason(tenantId: string, dto: CreateDowntimeReasonDto) {
    return this.manufacturingService.createDowntimeReason(tenantId, dto);
  }

  updateDowntimeReason(tenantId: string, id: string, dto: UpdateDowntimeReasonDto) {
    return this.manufacturingService.updateDowntimeReason(tenantId, id, dto);
  }

  deleteDowntimeReason(tenantId: string, id: string) {
    return this.manufacturingService.deleteDowntimeReason(tenantId, id);
  }

  getDowntimeRecords(
    tenantId: string,
    params?: { productionLineId?: string; startDate?: string; endDate?: string },
  ) {
    return this.manufacturingService.getDowntimeRecords(tenantId, params);
  }

  createDowntimeRecord(tenantId: string, userId: string, dto: CreateDowntimeRecordDto) {
    return this.manufacturingService.createDowntimeRecord(tenantId, userId, dto);
  }

  updateDowntimeRecord(tenantId: string, id: string, dto: UpdateDowntimeRecordDto) {
    return this.manufacturingService.updateDowntimeRecord(tenantId, id, dto);
  }

  deleteDowntimeRecord(tenantId: string, id: string) {
    return this.manufacturingService.deleteDowntimeRecord(tenantId, id);
  }

  getScrapReasons(tenantId: string) {
    return this.manufacturingService.getScrapReasons(tenantId);
  }

  createScrapReason(tenantId: string, dto: CreateScrapReasonDto) {
    return this.manufacturingService.createScrapReason(tenantId, dto);
  }

  updateScrapReason(tenantId: string, id: string, dto: UpdateScrapReasonDto) {
    return this.manufacturingService.updateScrapReason(tenantId, id, dto);
  }

  deleteScrapReason(tenantId: string, id: string) {
    return this.manufacturingService.deleteScrapReason(tenantId, id);
  }

  getProductionKPIs(
    tenantId: string,
    params?: { productionLineId?: string; startDate?: string; endDate?: string },
  ) {
    return this.manufacturingService.getProductionKPIs(tenantId, params);
  }
}
