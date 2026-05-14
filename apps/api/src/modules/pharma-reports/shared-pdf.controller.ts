import { Controller, Get, Param, Query, Res, SetMetadata, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { SKIP_TENANT_CHECK } from '../../core/guards/tenant.guard';
import { PdfShareService } from './services/pdf-share.service';

@ApiTags('Shared PDF')
@Controller({ path: 'pharma-reports', version: [VERSION_NEUTRAL, '1'] })
export class SharedPdfController {
  constructor(private readonly pdfShare: PdfShareService) {}

  @Public()
  @SetMetadata(SKIP_TENANT_CHECK, true)
  @Get('shared-pdf/:fileId')
  @ApiOperation({ summary: 'Download a shared PDF by file ID and token' })
  @ApiResponse({ status: 200, description: 'PDF file stream' })
  async downloadSharedPdf(
    @Param('fileId') fileId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const result = await this.pdfShare.getSharedPdf(fileId, token);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    result.stream.pipe(res);
  }
}
