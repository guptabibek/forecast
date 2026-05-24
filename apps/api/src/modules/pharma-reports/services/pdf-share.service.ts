import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportExportService } from './report-export.service';
import PDFDocument = require('pdfkit');

export interface PdfField {
  label: string;
  value: string | number | null | undefined;
}

export interface PdfTableColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
}

export interface PdfTable {
  title?: string;
  columns: PdfTableColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface GeneratePdfPayload {
  title: string;
  documentNumber?: string | null;
  fields: PdfField[];
  tables?: PdfTable[];
  totals?: PdfField[];
  tenantName?: string;
  generatedBy?: string;
  appliedFilters?: Record<string, string>;
  reportKey?: string;
  drilldownTitle?: string;
  exportMode?: 'current-page' | 'all';
}

export interface PdfShareResult {
  fileId: string;
  downloadUrl: string;
  expiresAt: string;
  whatsappUrl: string;
}

@Injectable()
export class PdfShareService {
  private readonly logger = new Logger(PdfShareService.name);
  private readonly storageRoot: string;
  private readonly baseUrl: string;
  private readonly expiryHours: number;

  constructor(
    private readonly config: ConfigService,
    private readonly reportExport: ReportExportService,
  ) {
    this.storageRoot = this.config.get<string>('PDF_STORAGE_PATH') || path.join(os.tmpdir(), 'pdf-exports');
    this.baseUrl = this.config.get<string>('APP_BASE_URL') || 'http://localhost:3000';
    this.expiryHours = this.config.get<number>('PDF_LINK_EXPIRY_HOURS') || 24;
  }

  async generateAndSave(tenantId: string, payload: GeneratePdfPayload, requestOrigin?: string): Promise<PdfShareResult> {
    const pdfBuffer = await this.buildPdf(payload);

    const fileId = crypto.randomBytes(12).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.expiryHours * 60 * 60 * 1000);

    const tenantDir = path.join(this.storageRoot, tenantId);
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const safeName = (payload.title + '-' + (payload.documentNumber || fileId.slice(0, 8)))
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
    const fileName = `${safeName}-${fileId.slice(0, 8)}.pdf`;
    const filePath = path.join(tenantDir, fileName);

    fs.writeFileSync(filePath, pdfBuffer);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const metaPath = path.join(tenantDir, `${fileId}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      fileId,
      tokenHash,
      fileName,
      tenantId,
      title: payload.title,
      documentNumber: payload.documentNumber,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      downloadCount: 0,
      isRevoked: false,
    }), 'utf-8');

    const base = requestOrigin || this.baseUrl;
    const downloadUrl = `${base}/api/v1/pharma-reports/shared-pdf/${fileId}?token=${token}`;

    const summaryLines = [
      `📄 *${payload.title}*`,
      '',
      ...payload.fields.slice(0, 6)
        .filter((f) => f.value != null && f.value !== '' && String(f.value) !== '-')
        .map((f) => `• ${f.label}: ${f.value}`),
    ];
    if (payload.totals?.length) {
      summaryLines.push('');
      payload.totals.slice(0, 4).forEach((t) => summaryLines.push(`*${t.label}*: ${t.value ?? '-'}`));
    }
    summaryLines.push('', `📥 Download PDF: ${downloadUrl}`, `⏳ Link expires: ${expiresAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`);
    const whatsappText = encodeURIComponent(summaryLines.join('\n'));
    const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

    this.logger.log(`PDF generated: ${fileName} for tenant ${tenantId}, expires ${expiresAt.toISOString()}`);

    return {
      fileId,
      downloadUrl,
      expiresAt: expiresAt.toISOString(),
      whatsappUrl,
    };
  }

  async generateReportPdf(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
    meta: { tenantName?: string; generatedBy?: string },
    requestOrigin?: string,
  ): Promise<PdfShareResult> {
    const dataSet = await this.reportExport.getReportDataForPdf(tenantId, reportType, filters);

    const title = reportType.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const columns = dataSet?.columns ?? [];
    const rows = (dataSet?.rows ?? []).slice(0, 5000);

    const fields: PdfField[] = [
      { label: 'Report', value: title },
      { label: 'Records', value: rows.length },
      { label: 'Generated', value: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) },
    ];

    if (rows.length === 5000) {
      fields.push({ label: 'Note', value: 'Showing first 5,000 rows — use CSV/Excel for larger datasets' });
    }

    const appliedFilters: Record<string, string> = {};
    for (const [key, val] of Object.entries(filters)) {
      if (val != null && val !== '' && key !== 'limit' && key !== 'offset') {
        appliedFilters[key] = String(val);
      }
    }

    const tableColumns = columns.map((c) => ({ key: c.key, header: c.header, align: 'left' as const }));
    const tableRows = rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const col of columns) {
        const val = row[col.key];
        mapped[col.key] = val === null || val === undefined ? '-' : val instanceof Date ? val.toISOString().slice(0, 10) : val;
      }
      return mapped;
    });

    return this.generateAndSave(tenantId, {
      title,
      documentNumber: reportType,
      fields,
      tables: tableRows.length ? [{ title: `${title} (${rows.length} rows)`, columns: tableColumns, rows: tableRows }] : [],
      totals: [],
      tenantName: meta.tenantName,
      generatedBy: meta.generatedBy,
      appliedFilters,
      reportKey: reportType,
    }, requestOrigin);
  }

  async generatePdfDownload(tenantId: string, payload: GeneratePdfPayload): Promise<{ buffer: Buffer; fileName: string }> {
    const pdfBuffer = await this.buildPdf(payload);
    const safeName = (payload.title + '-' + (payload.documentNumber || 'report'))
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
    return { buffer: pdfBuffer, fileName: `${safeName}.pdf` };
  }

  async getSharedPdf(fileId: string, token: string): Promise<{ stream: fs.ReadStream; contentType: string; fileName: string }> {
    if (!fileId || !token || fileId.length > 50 || token.length > 100) {
      throw new NotFoundException('Invalid PDF link');
    }

    const safeFileId = fileId.replace(/[^a-f0-9]/gi, '');
    if (safeFileId !== fileId) {
      throw new NotFoundException('Invalid PDF link');
    }

    const dirs = fs.existsSync(this.storageRoot) ? fs.readdirSync(this.storageRoot) : [];

    for (const tenantDir of dirs) {
      const tenantPath = path.join(this.storageRoot, tenantDir);
      const stat = fs.statSync(tenantPath);
      if (!stat.isDirectory()) continue;

      const metaPath = path.join(tenantPath, `${safeFileId}.meta.json`);
      if (!fs.existsSync(metaPath)) continue;

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      if (meta.isRevoked) {
        throw new NotFoundException('This PDF link has been revoked');
      }

      if (new Date(meta.expiresAt) < new Date()) {
        throw new NotFoundException('This PDF link has expired');
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(meta.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'))) {
        throw new NotFoundException('Invalid or expired PDF link');
      }

      const filePath = path.join(tenantPath, meta.fileName);
      if (!fs.existsSync(filePath)) {
        throw new NotFoundException('PDF file not found');
      }

      meta.downloadCount = (meta.downloadCount || 0) + 1;
      fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');

      return {
        stream: fs.createReadStream(filePath),
        contentType: 'application/pdf',
        fileName: meta.fileName,
      };
    }

    throw new NotFoundException('PDF not found or link expired');
  }

  cleanExpiredFiles(): void {
    if (!fs.existsSync(this.storageRoot)) return;

    const tenantDirs = fs.readdirSync(this.storageRoot);
    let cleaned = 0;

    for (const tenantDir of tenantDirs) {
      const dirPath = path.join(this.storageRoot, tenantDir);
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) continue;

      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.meta.json'));
      for (const metaFile of files) {
        const metaPath = path.join(dirPath, metaFile);
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (new Date(meta.expiresAt) < new Date()) {
            const pdfPath = path.join(dirPath, meta.fileName);
            if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
            fs.unlinkSync(metaPath);
            cleaned++;
          }
        } catch {
          fs.unlinkSync(metaPath);
        }
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned ${cleaned} expired PDF files`);
    }
  }

  // ─── PDFKit-based PDF Generation ───────────────────────────────────────────

  private buildPdf(payload: GeneratePdfPayload): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margins: { top: 36, bottom: 36, left: 28, right: 28 },
          bufferPages: true,
          info: {
            Title: payload.title,
            Author: payload.generatedBy || 'ERP System',
            Subject: payload.reportKey || payload.title,
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.renderHeader(doc, payload);
        this.renderFields(doc, payload);
        this.renderFilters(doc, payload);
        this.renderTables(doc, payload);
        this.renderTotals(doc, payload);
        this.renderPageNote(doc, payload);
        this.renderPageFooters(doc, payload);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private renderHeader(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    const { title, documentNumber, drilldownTitle, tenantName, generatedBy } = payload;
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1f2937').text(title, 28, 36);

    if (documentNumber) {
      doc.fontSize(8).font('Helvetica').fillColor('#6b7280').text(`Document: ${documentNumber}`, 28, doc.y + 2);
    }
    if (drilldownTitle) {
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#4b5563').text(drilldownTitle, 28, doc.y + 1);
    }

    const rightX = doc.page.width - 28;
    let rightY = 36;
    if (tenantName) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1f2937').text(tenantName, rightX - 180, rightY, { width: 180, align: 'right' });
      rightY += 12;
    }
    doc.fontSize(7).font('Helvetica').fillColor('#6b7280').text(`Generated: ${generatedAt}`, rightX - 180, rightY, { width: 180, align: 'right' });
    rightY += 9;
    if (generatedBy) {
      doc.fontSize(7).font('Helvetica').fillColor('#6b7280').text(`By: ${generatedBy}`, rightX - 180, rightY, { width: 180, align: 'right' });
    }

    const headerBottom = Math.max(doc.y, rightY + 12);
    doc.moveTo(28, headerBottom + 4).lineTo(doc.page.width - 28, headerBottom + 4).strokeColor('#1f2937').lineWidth(1.5).stroke();
    doc.y = headerBottom + 12;
  }

  private renderFields(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    const fields = (payload.fields || []).filter((f) => f.value != null && String(f.value) !== '' && String(f.value) !== '-');
    if (!fields.length) return;

    const startY = doc.y;
    const pageWidth = doc.page.width - 56;
    const colCount = 4;
    const colWidth = pageWidth / colCount;

    doc.rect(28, startY, pageWidth, 6 + fields.length * 5 + Math.ceil(fields.length / colCount) * 10)
      .fillColor('#f9fafb').fill();
    doc.rect(28, startY, pageWidth, 6 + Math.ceil(fields.length / colCount) * 20)
      .strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    let x = 32;
    let y = startY + 6;

    fields.forEach((field, i) => {
      if (i > 0 && i % colCount === 0) {
        x = 32;
        y += 20;
      }
      doc.fontSize(5.5).font('Helvetica').fillColor('#6b7280').text(String(field.label).toUpperCase(), x, y, { width: colWidth - 8 });
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#111827').text(String(field.value ?? '-'), x, y + 7, { width: colWidth - 8 });
      x += colWidth;
    });

    doc.y = y + 24;
  }

  private renderFilters(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    const filters = payload.appliedFilters;
    if (!filters || !Object.keys(filters).length) return;

    const entries = Object.entries(filters);
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#1e40af').text('Applied Filters: ', 28, doc.y, { continued: true });
    doc.font('Helvetica').fontSize(6.5).fillColor('#1e40af');
    entries.forEach(([key, val], i) => {
      const label = key.replace(/([A-Z])/g, ' $1').trim();
      doc.text(`${label}: ${val}${i < entries.length - 1 ? '  |  ' : ''}`, { continued: i < entries.length - 1 });
    });
    doc.text('');
    doc.y += 8;
  }

  private renderTables(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    const tables = payload.tables || [];
    if (!tables.length) return;

    for (const table of tables) {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }

      if (table.title) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text(table.title, 28, doc.y);
        doc.moveTo(28, doc.y + 2).lineTo(doc.page.width - 28, doc.y + 2).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        doc.y += 6;
      }

      this.renderDataTable(doc, table.columns, table.rows);
    }
  }

  private renderDataTable(doc: PDFKit.PDFDocument, columns: PdfTableColumn[], rows: Array<Record<string, unknown>>): void {
    if (!columns.length) return;

    const pageWidth = doc.page.width - 56;
    const maxCols = Math.min(columns.length, 20);
    const visibleCols = columns.slice(0, maxCols);
    const colWidth = pageWidth / visibleCols.length;
    
    const CELL_FONT_SIZE = 6.5;
    const HEADER_FONT_SIZE = 6;
    const PAD_H = 3;          // horizontal padding per side
    const PAD_V = 3;          // vertical padding per side (top + bottom = PAD_V * 2)
    const MIN_ROW_HEIGHT = 13;
    const cellWidth = colWidth - PAD_H * 2;

    // Pre-measure text height at the current font/size within the cell width.
    // Called before drawing so we know the row height before placing any ink.
    const measureH = (text: string, fontSize: number, font: string): number => {
      doc.fontSize(fontSize).font(font);
      return doc.heightOfString(text, { width: cellWidth });
    };

    // Header height grows to fit the tallest header label (uncommon but correct).
    const headerContentH = Math.max(...visibleCols.map((col) => measureH(col.header, HEADER_FONT_SIZE, 'Helvetica-Bold')));
    const headerHeight = Math.max(15, headerContentH + PAD_V * 2);

    const drawHeader = (y: number): number => {
      doc.rect(28, y, pageWidth, headerHeight).fillColor('#1f2937').fill();
      visibleCols.forEach((col, i) => {
        const x = 28 + i * colWidth;
        const align = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left';
        doc.fontSize(HEADER_FONT_SIZE).font('Helvetica-Bold').fillColor('#ffffff')
          .text(col.header, x + PAD_H, y + PAD_V, { width: cellWidth, align, lineBreak: true });
      });
      return y + headerHeight;
    };

    let y = drawHeader(doc.y);

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];

      // Resolve display text for every cell in this row.
      const cellTexts = visibleCols.map((col) => {
        const v = row[col.key];
        return v === null || v === undefined || v === '' ? '-' : String(v);
      });

      // Measure each cell, then size the row to the tallest one so that no
      // cell's content bleeds into the next row.
      const rowContentH = Math.max(...cellTexts.map((t) => measureH(t, CELL_FONT_SIZE, 'Helvetica')));
      const rowHeight = Math.max(MIN_ROW_HEIGHT, rowContentH + PAD_V * 2);

      // If this row won't fit on the remaining page, start a fresh page with a
      // repeated header so column labels are always visible.
      if (y + rowHeight > doc.page.height - 50) {
        doc.addPage();
        y = drawHeader(36);
      }

      // Alternating stripe + row border drawn at the computed height.
      if (rowIdx % 2 === 0) {
        doc.rect(28, y, pageWidth, rowHeight).fillColor('#f9fafb').fill();
      }
      doc.rect(28, y, pageWidth, rowHeight).strokeColor('#e5e7eb').lineWidth(0.25).stroke();

      // Render cell text with wrapping enabled; absolute y anchors each cell to
      // the top of this row so multi-line cells stay vertically aligned.
      visibleCols.forEach((col, i) => {
        const x = 28 + i * colWidth;
        const align = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left';
        doc.fontSize(CELL_FONT_SIZE).font('Helvetica').fillColor('#111827')
          .text(cellTexts[i], x + PAD_H, y + PAD_V, { width: cellWidth, align, lineBreak: true });
      });

      y += rowHeight;
    }

    doc.y = y + 6;
  }

  private renderTotals(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    const totals = payload.totals || [];
    if (!totals.length) return;

    if (doc.y > doc.page.height - 80) {
      doc.addPage();
    }

    const tableWidth = 200;
    const startX = doc.page.width - 28 - tableWidth;
    let y = doc.y + 4;

    doc.rect(startX, y, tableWidth, 14).fillColor('#f3f4f6').fill();
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#374151').text('TOTALS', startX + 6, y + 4, { width: tableWidth - 12 });
    y += 14;

    for (const t of totals) {
      doc.rect(startX, y, tableWidth, 12).strokeColor('#e5e7eb').lineWidth(0.25).stroke();
      doc.fontSize(6.5).font('Helvetica').fillColor('#374151').text(String(t.label), startX + 6, y + 3, { width: 100 });
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#111827').text(String(t.value ?? '-'), startX + 110, y + 3, { width: 80, align: 'right' });
      y += 12;
    }

    doc.y = y + 8;
  }

  private renderPageNote(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    if (payload.exportMode === 'current-page') {
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#6b7280')
        .text('Note: This PDF contains the current page view only. Use CSV/Excel export for the complete dataset.', 28, doc.y, { align: 'center' });
    }
  }

  private renderPageFooters(doc: PDFKit.PDFDocument, payload: GeneratePdfPayload): void {
    const pages = doc.bufferedPageRange();
    const totalPages = pages.count;
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.height - 20;

      doc.moveTo(28, bottom - 4).lineTo(doc.page.width - 28, bottom - 4).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc.fontSize(6).font('Helvetica').fillColor('#9ca3af')
        .text(`${payload.title}`, 28, bottom, { width: 300, lineBreak: false });
      doc.fontSize(6).font('Helvetica').fillColor('#9ca3af')
        .text(`Generated: ${generatedAt}  |  Page ${i + 1} of ${totalPages}`, doc.page.width - 228, bottom, { width: 200, align: 'right', lineBreak: false });
    }
  }
}
