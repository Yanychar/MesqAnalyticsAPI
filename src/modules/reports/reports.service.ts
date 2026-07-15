import { Injectable, NotFoundException } from '@nestjs/common';

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
  ): Promise<{ contentType: string; filename: string; body: string }> {
    const result = await this.runReport(reportKey, filters);

    if (format !== 'csv') {
      throw new NotFoundException(`Report format ${format} is not supported.`);
    }

    const definition = this.getDefinition(reportKey);
    const csv = this.toCsv(result);

    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${definition.key}-${this.timestampForFilename()}.csv`,
      body: csv,
    };
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

  private escapeCsv(value: unknown): string {
    const normalized = value === null || value === undefined ? '' : String(value);
    const escaped = normalized.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private timestampForFilename(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}
