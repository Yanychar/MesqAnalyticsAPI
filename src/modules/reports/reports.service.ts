import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { InvoiceAmountsReport } from './reports/invoice-amounts.report';
import {
  ReportDefinition,
  ReportExecutionResult,
  ReportImplementation,
} from './report.types';

@Injectable()
export class ReportsService {
  private readonly reports: ReportImplementation[];

  constructor(private readonly invoiceAmountsReport: InvoiceAmountsReport) {
    // Keep the registry explicit and simple so new reports are easy to add later.
    this.reports = [this.invoiceAmountsReport];
  }

  listDefinitions(): ReportDefinition[] {
    return this.reports.map((report) => report.getDefinition());
  }

  getDefinition(reportKey: string): ReportDefinition {
    return this.getReport(reportKey).getDefinition();
  }

  async runReport(
    reportKey: string,
    filters: Record<string, string>,
  ): Promise<ReportExecutionResult> {
    return this.getReport(reportKey).run(filters);
  }

  async downloadReport(
    reportKey: string,
    format: string,
    filters: Record<string, string>,
  ): Promise<{ contentType: string; filename: string; body: string | Buffer }> {
    const result = await this.runReport(reportKey, filters);
    const definition = this.getDefinition(reportKey);

    if (format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `${this.toFileSafeName(definition.name)}-${this.timestampForFilename()}.csv`,
        body: this.toCsv(result),
      };
    }

    if (format === 'xlsx') {
      return {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${this.toFileSafeName(definition.name)}-${this.timestampForFilename()}.xlsx`,
        body: await this.toXlsx(result),
      };
    }

    throw new NotFoundException(`Report format ${format} is not supported.`);
  }

  private getReport(reportKey: string): ReportImplementation {
    const report = this.reports.find((item) => item.getDefinition().key === reportKey);

    if (!report) {
      throw new NotFoundException(`Report ${reportKey} is not implemented.`);
    }

    return report;
  }

  private toCsv(result: ReportExecutionResult): string {
    const header = result.columns.map((column) => this.escapeCsv(column.label)).join(',');
    const rows = result.rows.map((row) => result.columns
      .map((column) => this.escapeCsv(row[column.key]))
      .join(','));

    return [header, ...rows].join('\n');
  }

  private async toXlsx(result: ReportExecutionResult): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MESQ Analytics';
    workbook.created = new Date();

    const dataSheet = workbook.addWorksheet('Report data', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    dataSheet.addRow(result.columns.map((column) => column.label));
    const headerRow = dataSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FBFF' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD7E0EA' } },
      };
    });

    for (const row of result.rows) {
      dataSheet.addRow(result.columns.map((column) => row[column.key] ?? ''));
    }

    result.columns.forEach((column, index) => {
      const excelColumn = dataSheet.getColumn(index + 1);
      excelColumn.width = this.computeColumnWidth(column.label, result.rows, column.key);

      if (column.format === 'currency') {
        excelColumn.numFmt = '#,##0.00 "€"';
      }
    });

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Report', result.reportName]);
    summarySheet.addRow(['Generated at', result.generatedAt]);
    summarySheet.addRow([]);
    const filtersHeader = summarySheet.addRow(['Filter', 'Value']);
    filtersHeader.font = { bold: true };
    Object.entries(result.filters).forEach(([key, value]) => {
      summarySheet.addRow([key, value]);
    });
    summarySheet.addRow([]);
    const summaryHeader = summarySheet.addRow(['Metric', 'Value']);
    summaryHeader.font = { bold: true };
    result.summary.forEach((item) => {
      const row = summarySheet.addRow([item.label, item.value]);
      if (item.format === 'currency') {
        row.getCell(2).numFmt = '#,##0.00 "€"';
      }
    });

    summarySheet.getColumn(1).width = 36;
    summarySheet.getColumn(2).width = 24;

    if (result.errors.length > 0) {
      summarySheet.addRow([]);
      const errorsHeader = summarySheet.addRow(['Errors']);
      errorsHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      errorsHeader.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFC03844' },
      };
      result.errors.forEach((message) => {
        const row = summarySheet.addRow([message]);
        row.getCell(1).alignment = { wrapText: true };
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private computeColumnWidth(
    header: string,
    rows: Array<Record<string, string | number | boolean | null>>,
    key: string,
  ) {
    const maxRowLength = rows.reduce((maxValue, row) => {
      const value = row[key];
      return Math.max(maxValue, String(value ?? '').length);
    }, 0);

    return Math.min(Math.max(header.length, maxRowLength, 12), 36);
  }

  private escapeCsv(value: unknown): string {
    const normalized = value === null || value === undefined ? '' : String(value);
    const escaped = normalized.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private toFileSafeName(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/ /g, '_');
  }

  private timestampForFilename(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}
