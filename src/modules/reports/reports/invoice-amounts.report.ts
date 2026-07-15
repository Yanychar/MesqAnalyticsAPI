import { Injectable } from '@nestjs/common';
import { AppEventLevel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReportDefinition,
  ReportExecutionResult,
  ReportImplementation,
} from '../report.types';

@Injectable()
export class InvoiceAmountsReport implements ReportImplementation {
  constructor(private readonly prisma: PrismaService) {}

  getDefinition(): ReportDefinition {
    return {
      key: 'invoice-amounts',
      name: 'Invoice amounts report',
      description: 'Present main invoice digits (total, material costs, service costs) for a selected invoice date range.',
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

    const invoices = await this.prisma.cmInvoice.findMany({
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
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalExclTaxes: true,
        totalInclTaxes: true,
        totalTax: true,
        totalPaid: true,
        materialRows: {
          select: {
            quantity: true,
            treatment: {
              select: {
                id: true,
                treatment: true,
                purchasePrice: true,
              },
            },
          },
        },
      },
    });

    const errors = new Map<string, { message: string; payload: Record<string, string | number | boolean | null> }>();

    const rows = invoices.map((invoice) => {
      const totalVatExcl = this.toNumber(invoice.totalExclTaxes);
      const totalGross = this.toNumber(invoice.totalInclTaxes);
      const totalTax = this.toNumber(invoice.totalTax);
      const paid = this.toNumber(invoice.totalPaid);

      let materialsVatExcl = 0;

      for (const materialRow of invoice.materialRows) {
        const quantity = this.toNumber(materialRow.quantity);
        const purchasePrice = materialRow.treatment.purchasePrice === null
          ? null
          : Number(materialRow.treatment.purchasePrice);

        if (purchasePrice === null) {
          const message = `Missing purchase price for invoice ${invoice.invoiceNumber}, material "${materialRow.treatment.treatment}". Material cost was set to 0.`;
          errors.set(message, {
            message,
            payload: {
              invoiceId: String(invoice.id),
              invoiceNumber: invoice.invoiceNumber,
              treatmentId: String(materialRow.treatment.id),
              treatment: materialRow.treatment.treatment,
              quantity,
              purchasePrice: null,
            },
          });
          continue;
        }

        materialsVatExcl += quantity * purchasePrice;
      }

      return {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate ?? '',
        creditOrDebit: totalVatExcl < 0 || totalGross < 0 ? 'Credit' : 'Debit',
        totalVatExcl: this.round2(totalVatExcl),
        materialsVatExcl: this.round2(materialsVatExcl),
        withoutMaterialsVatExcl: this.round2(totalVatExcl - materialsVatExcl),
        vat: this.round2(totalTax),
        paid: this.round2(paid),
      };
    });

    const errorList = Array.from(errors.values());
    await this.persistErrors(errorList);

    const totals = rows.reduce(
      (accumulator, row) => ({
        totalVatExcl: accumulator.totalVatExcl + this.toNumber(row.totalVatExcl),
        materialsVatExcl: accumulator.materialsVatExcl + this.toNumber(row.materialsVatExcl),
        withoutMaterialsVatExcl: accumulator.withoutMaterialsVatExcl + this.toNumber(row.withoutMaterialsVatExcl),
        vat: accumulator.vat + this.toNumber(row.vat),
        paid: accumulator.paid + this.toNumber(row.paid),
      }),
      {
        totalVatExcl: 0,
        materialsVatExcl: 0,
        withoutMaterialsVatExcl: 0,
        vat: 0,
        paid: 0,
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
        { key: 'creditOrDebit', label: 'Credit or debit' },
        { key: 'totalVatExcl', label: 'Total\n(VAT excl)' },
        { key: 'materialsVatExcl', label: 'Materials\n(VAT excl)' },
        { key: 'withoutMaterialsVatExcl', label: 'Without materials\n(VAT excl)' },
        { key: 'vat', label: 'VAT' },
        { key: 'paid', label: 'Paid' },
      ],
      rows,
      summary: [
        { label: 'Invoices', value: rows.length },
        { label: 'Total (VAT excl)', value: totals.totalVatExcl.toFixed(2) },
        { label: 'Materials (VAT excl)', value: totals.materialsVatExcl.toFixed(2) },
        { label: 'Without materials (VAT excl)', value: totals.withoutMaterialsVatExcl.toFixed(2) },
        { label: 'VAT', value: totals.vat.toFixed(2) },
        { label: 'Paid', value: totals.paid.toFixed(2) },
      ],
      errors: errorList.map((item) => item.message),
    };
  }

  private async persistErrors(
    errors: Array<{ message: string; payload: Record<string, string | number | boolean | null> }>,
  ) {
    for (const error of errors) {
      await this.prisma.appEvent.create({
        data: {
          level: AppEventLevel.ERROR,
          source: 'InvoiceAmountsReport',
          entityKey: 'invoice-amounts',
          title: 'Missing material purchase price in invoice report',
          message: error.message,
          payload: error.payload,
        },
      });
    }
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private toNumber(value: unknown) {
    if (value === null || value === undefined) {
      return 0;
    }

    return Number(value);
  }
}
