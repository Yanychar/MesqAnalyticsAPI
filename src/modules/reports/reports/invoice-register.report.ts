import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReportDefinition,
  ReportExecutionResult,
  ReportImplementation,
} from '../report.types';

@Injectable()
export class InvoiceRegisterReport implements ReportImplementation {
  constructor(private readonly prisma: PrismaService) {}

  getDefinition(): ReportDefinition {
    return {
      key: 'invoice-register',
      name: 'Invoice Register',
      description: 'Preview staged invoices for a selected invoice date range and download the result as CSV.',
      supportedFormats: ['csv'],
      filters: [
        {
          key: 'invoiceDateFrom',
          label: 'Invoice date from',
          type: 'date',
          required: true,
          defaultValue: '2026-01-01',
        },
        {
          key: 'invoiceDateTo',
          label: 'Invoice date to',
          type: 'date',
          required: true,
          defaultValue: new Date().toISOString().slice(0, 10),
        },
      ],
    };
  }

  async run(filters: Record<string, string>): Promise<ReportExecutionResult> {
    const definition = this.getDefinition();
    const invoiceDateFrom = filters.invoiceDateFrom || definition.filters[0].defaultValue || '';
    const invoiceDateTo = filters.invoiceDateTo || definition.filters[1].defaultValue || '';

    const rows = await this.prisma.cmInvoice.findMany({
      where: {
        invoiceDate: {
          gte: invoiceDateFrom,
          lte: invoiceDateTo,
        },
      },
      orderBy: [
        { invoiceDate: 'asc' },
        { invoiceNumber: 'asc' },
      ],
      select: {
        invoiceNumber: true,
        invoiceDate: true,
        patientNumber: true,
        location: true,
        user: true,
        totalInclTaxes: true,
        totalPaid: true,
        outstanding: true,
      },
    });

    const reportRows = rows.map((row) => ({
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate ?? '',
      patientNumber: row.patientNumber ?? '',
      location: row.location ?? '',
      user: row.user ?? '',
      totalInclTaxes: row.totalInclTaxes ? Number(row.totalInclTaxes) : 0,
      totalPaid: row.totalPaid ? Number(row.totalPaid) : 0,
      outstanding: row.outstanding ? Number(row.outstanding) : 0,
    }));

    const totals = reportRows.reduce(
      (accumulator, row) => ({
        totalInclTaxes: accumulator.totalInclTaxes + row.totalInclTaxes,
        totalPaid: accumulator.totalPaid + row.totalPaid,
        outstanding: accumulator.outstanding + row.outstanding,
      }),
      {
        totalInclTaxes: 0,
        totalPaid: 0,
        outstanding: 0,
      },
    );

    return {
      reportKey: definition.key,
      reportName: definition.name,
      generatedAt: new Date().toISOString(),
      filters: {
        invoiceDateFrom,
        invoiceDateTo,
      },
      columns: [
        { key: 'invoiceNumber', label: 'Invoice number' },
        { key: 'invoiceDate', label: 'Invoice date' },
        { key: 'patientNumber', label: 'Patient number' },
        { key: 'location', label: 'Location' },
        { key: 'user', label: 'User' },
        { key: 'totalInclTaxes', label: 'Total incl. taxes' },
        { key: 'totalPaid', label: 'Total paid' },
        { key: 'outstanding', label: 'Outstanding' },
      ],
      rows: reportRows,
      summary: [
        { label: 'Invoices', value: reportRows.length },
        { label: 'Total incl. taxes', value: totals.totalInclTaxes.toFixed(2) },
        { label: 'Total paid', value: totals.totalPaid.toFixed(2) },
        { label: 'Outstanding', value: totals.outstanding.toFixed(2) },
      ],
      errors: [],
    };
  }
}
