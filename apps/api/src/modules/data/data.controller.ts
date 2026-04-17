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
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../platform/require-module.decorator';
import { DataService } from './data.service';
import { ActualsQueryDto } from './dto/actuals-query.dto';
import { CreateDimensionDto } from './dto/create-dimension.dto';
import { DimensionQueryDto } from './dto/dimension-query.dto';
import { ImportDataDto } from './dto/import-data.dto';
import { UpdateDimensionDto } from './dto/update-dimension.dto';

@ApiTags('Data')
@ApiBearerAuth()
@Controller('data')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireModule('data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  private static readonly importUploadBaseDir = join(process.cwd(), 'tmp', 'imports');
  private static readonly importMaxSizeMb = Number(process.env.IMPORT_FILE_MAX_MB ?? '100');
  private static readonly importMaxSizeBytes = (Number.isFinite(DataController.importMaxSizeMb)
    ? Math.max(1, DataController.importMaxSizeMb)
    : 100) * 1024 * 1024;

  // ==================== IMPORTS ====================

  @Post('import')
  @Roles('ADMIN', 'PLANNER')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (req, _file, cb) => {
        // Tenant-scoped upload directory to isolate file storage per tenant
        const tenantId = (req as any).tenantId;
        // Reject uploads without a valid tenant context to prevent path traversal
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!tenantId || !uuidRegex.test(tenantId)) {
          cb(new Error('Missing tenant context for file upload'), '');
          return;
        }
        const dir = join(DataController.importUploadBaseDir, tenantId);
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname);
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: DataController.importMaxSizeBytes },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import data from file' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: ['actuals', 'products', 'locations', 'customers', 'accounts'] },
        mapping: { type: 'object' },
      },
    },
  })
  async importFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() importDto: ImportDataDto,
    @CurrentUser() user: any,
  ) {
    return this.dataService.importFile(file, importDto, user);
  }

  @Get('imports')
  @ApiOperation({ summary: 'Get import history' })
  async getImportHistory(@CurrentUser() user: any) {
    return this.dataService.getImportHistory(user);
  }

  @Get('imports/:id')
  @ApiOperation({ summary: 'Get import job status' })
  async getImportStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.dataService.getImportStatus(id, user);
  }

  @Get('templates/:type/info')
  @ApiOperation({ summary: 'Get import template info with column definitions' })
  async getTemplateInfo(@Param('type') type: string) {
    return this.dataService.getImportTemplateInfo(type);
  }

  @Get('templates/:type')
  @ApiOperation({ summary: 'Download import template as CSV' })
  async downloadTemplate(
    @Param('type') type: string,
    @Res() res: Response,
  ) {
    const template = this.dataService.generateTemplate(type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_template.csv`);
    res.send(template);
  }

  // ==================== ACTUALS ====================

  @Get('actuals')
  @ApiOperation({ summary: 'Get actuals data' })
  async getActuals(@Query() query: ActualsQueryDto, @CurrentUser() user: any) {
    return this.dataService.getActuals(query, user);
  }

  @Get('actuals/summary')
  @ApiOperation({ summary: 'Get actuals summary' })
  async getActualsSummary(@CurrentUser() user: any) {
    return this.dataService.getActualsSummary(user);
  }

  @Delete('actuals')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete actuals by filter' })
  async deleteActuals(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @CurrentUser() user: any,
  ) {
    return this.dataService.deleteActuals(startDate, endDate, user);
  }

  // ==================== DIMENSIONS ====================

  @Get('dimensions/:type')
  @ApiOperation({ summary: 'Get dimensions by type' })
  async getDimensions(
    @Param('type') type: string,
    @Query() query: DimensionQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.dataService.getDimensions(type, query, user);
  }

  @Get('dimensions/:type/hierarchy')
  @ApiOperation({ summary: 'Get dimension hierarchy' })
  async getDimensionHierarchy(
    @Param('type') type: string,
    @CurrentUser() user: any,
  ) {
    return this.dataService.getDimensionHierarchy(type, user);
  }

  @Post('dimensions/:type')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Create a dimension' })
  async createDimension(
    @Param('type') type: string,
    @Body() createDto: CreateDimensionDto,
    @CurrentUser() user: any,
  ) {
    return this.dataService.createDimension(type, createDto, user);
  }

  @Get('dimensions/:type/:id')
  @ApiOperation({ summary: 'Get a dimension by ID' })
  async getDimension(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.dataService.getDimension(type, id, user);
  }

  @Patch('dimensions/:type/:id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Update a dimension' })
  async updateDimension(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateDimensionDto,
    @CurrentUser() user: any,
  ) {
    return this.dataService.updateDimension(type, id, updateDto, user);
  }

  @Delete('dimensions/:type/:id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dimension' })
  async deleteDimension(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    await this.dataService.deleteDimension(type, id, user);
  }

  // ==================== IMPORT MANAGEMENT ====================

  @Delete('imports/:id')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Cancel an import' })
  async cancelImport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.dataService.cancelImport(id, user);
  }

  // ==================== SYNC ====================

  @Get('sync-status')
  @ApiOperation({ summary: 'Get data sync status' })
  async getSyncStatus(@CurrentUser() user: any) {
    return this.dataService.getSyncStatus(user);
  }

  @Post('sync')
  @Roles('ADMIN', 'PLANNER')
  @ApiOperation({ summary: 'Trigger data sync' })
  async triggerSync(@CurrentUser() user: any) {
    return this.dataService.triggerSync(user);
  }
}

