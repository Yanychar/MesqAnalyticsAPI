import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { InvoiceAmountsReport } from './reports/invoice-amounts.report';
import { QuotesReport } from './reports/quotes-report.report';
import {
  ReportDefinition,
  ReportDetailSection,
  ReportExecutionResult,
  ReportImplementation,
} from './report.types';

@Injectable()
export class ReportsService {
  private readonly reports: ReportImplementation[];

  constructor(
    private readonly invoiceAmountsReport: InvoiceAmountsReport,
    private readonly quotesReport: QuotesReport,
  ) {
    // Keep the registry explicit and simple so new reports are easy to add later.
    this.reports = [this.invoiceAmountsReport, this.quotesReport];
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
        filename: `${this.toFileSafeName(definition.name)}.xlsx`,
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
      .map((column) => this.escapeCsv(this.formatCsvValue(column.format, row[column.key])))
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
    const generatedAtRow = summarySheet.addRow(['Generated at', new Date(result.generatedAt)]);
    generatedAtRow.getCell(2).numFmt = 'dd.mm.yyyy hh:mm';
    summarySheet.addRow([]);
    const filtersHeader = summarySheet.addRow(['Filter', 'Value']);
    filtersHeader.font = { bold: true };
    Object.entries(result.filters).forEach(([key, value]) => {
      summarySheet.addRow([key, value]);
    });
    summarySheet.addRow([]);
    const summaryRows = result.summaryRows || result.summary.map((item) => ({
      label: item.label,
      number: null,
      amount: item.value,
    }));
    const summaryHeader = summarySheet.addRow(['Item', 'Number', 'Amount']);
    summaryHeader.font = { bold: true };
    summaryRows.forEach((item) => {
      const row = summarySheet.addRow([item.label, item.number, item.amount]);
      row.getCell(2).numFmt = '#,##0';
      row.getCell(3).numFmt = '#,##0.00 "€"';
    });

    summarySheet.getColumn(1).width = 36;
    summarySheet.getColumn(2).width = 18;
    summarySheet.getColumn(3).width = 24;

    this.addDetailWorksheet(
      workbook,
      'Treatments',
      this.collectTreatmentSummaryRows(result),
    );
    this.addDetailWorksheet(
      workbook,
      'Materials',
      this.collectDetailRows(
        result,
        'Materials',
        [
          'Invoice number',
          'Material treatment name',
          'Quantity used',
          'Purchase price for 1',
          'Total purchase cost',
        ],
      ),
    );

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

  private addDetailWorksheet(
    workbook: ExcelJS.Workbook,
    name: string,
    rows: Array<Record<string, string | number | boolean | null>>,
  ) {
    const worksheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headers = rows.length > 0
      ? Object.keys(rows[0])
      : name === 'Treatments'
        ? ['Treatment name', 'Quantity', 'Total amount']
        : [
            'Invoice number',
            'Material treatment name',
            'Quantity used',
            'Purchase price for 1',
            'Total purchase cost',
          ];

    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
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

    for (const row of rows) {
      worksheet.addRow(headers.map((header) => row[header] ?? ''));
    }

    this.addDetailWorksheetTotalRow(worksheet, name, headers, rows.length);

    headers.forEach((header, index) => {
      const column = worksheet.getColumn(index + 1);
      column.width = this.computeColumnWidth(header, rows, header);

      if ([
        'Total amount',
        'Treatment amount (VAT excl)',
        'Treatment cost (VAT excl)',
        'Treatments cost (VAT excl)',
        'Purchase price for 1',
        'Total purchase cost',
      ].includes(header)) {
        column.numFmt = '#,##0.00 "€"';
      }
    });
  }

  private addDetailWorksheetTotalRow(
    worksheet: ExcelJS.Worksheet,
    name: string,
    headers: string[],
    dataRowCount: number,
  ) {
    if (dataRowCount === 0) {
      return;
    }

    const totalRow = worksheet.addRow(headers.map((_, index) => index === 0 ? 'Total' : ''));
    const totalRowNumber = totalRow.number;
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF4F7FA' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD7E0EA' } },
      };
    });

    const sumHeaders = name === 'Treatments'
      ? ['Quantity', 'Total amount']
      : ['Quantity used', 'Total purchase cost'];

    headers.forEach((header, index) => {
      if (!sumHeaders.includes(header)) {
        return;
      }

      const columnLetter = this.toExcelColumnName(index + 1);
      totalRow.getCell(index + 1).value = {
        formula: `SUM(${columnLetter}2:${columnLetter}${dataRowCount + 1})`,
      };
    });
  }

  private toExcelColumnName(columnNumber: number): string {
    let current = columnNumber;
    let label = '';

    while (current > 0) {
      const remainder = (current - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      current = Math.floor((current - 1) / 26);
    }

    return label;
  }

  private collectTreatmentSummaryRows(
    result: ReportExecutionResult,
  ): Array<Record<string, string | number | boolean | null>> {
    const totals = new Map<string, { quantity: number; totalAmount: number }>();

    for (const sections of Object.values(result.detailSectionsByRowKey ?? {})) {
      const treatmentSection = sections.find((item) => item.title === 'Treatments');
      if (!treatmentSection) {
        continue;
      }

      for (const row of treatmentSection.rows) {
        const treatmentName = String(row.columns[0] ?? '').trim();

        if (!treatmentName) {
          continue;
        }

        const treatmentAmount = this.toNumber(row.columns[1]);
        const existing = totals.get(treatmentName) ?? {
          quantity: 0,
          totalAmount: 0,
        };

        existing.quantity += 1;
        existing.totalAmount += treatmentAmount;

        totals.set(treatmentName, existing);
      }
    }

    return Array.from(totals.entries())
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([treatmentName, values]) => ({
        'Treatment name': treatmentName,
        Quantity: values.quantity,
        'Total amount': this.round2(values.totalAmount),
      }));
  }

  private collectDetailRows(
    result: ReportExecutionResult,
    sectionTitle: string,
    headers: string[],
  ): Array<Record<string, string | number | boolean | null>> {
    const rows: Array<Record<string, string | number | boolean | null>> = [];

    for (const [rowKey, sections] of Object.entries(result.detailSectionsByRowKey ?? {})) {
      const section = sections.find((item) => item.title === sectionTitle);

      if (!section) {
        continue;
      }

      rows.push(...this.buildDetailRows(rowKey, section, headers));
    }

    return rows;
  }

  private buildDetailRows(
    rowKey: string,
    section: ReportDetailSection,
    headers: string[],
  ): Array<Record<string, string | number | boolean | null>> {
    return section.rows.map((row) => {
      const item: Record<string, string | number | boolean | null> = {
        'Invoice number': rowKey,
      };

      headers.slice(1).forEach((header, index) => {
        const column = section.columns[index];
        item[header] = column ? row.columns[index] ?? '' : '';
      });

      return item;
    });
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

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private toNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return 0;
    }

    return Number(value);
  }

  private formatCsvValue(
    format: 'text' | 'currency' | 'number' | undefined,
    value: unknown,
  ): string | number | boolean | null | undefined {
    if (format === 'currency') {
      return this.formatCurrencyValue(value);
    }

    return value as string | number | boolean | null | undefined;
  }

  private formatCurrencyValue(value: unknown): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.toNumber(value));
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
