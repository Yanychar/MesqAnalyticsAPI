import { Injectable } from '@nestjs/common';
import { AppEventLevel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReportDefinition,
  ReportDetailSection,
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
      supportedFormats: ['csv', 'xlsx'],
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
        treatmentRows: {
          orderBy: { id: 'asc' },
          select: {
            amount: true,
            treatment: {
              select: {
                treatment: true,
              },
            },
          },
        },
        materialRows: {
          orderBy: { id: 'asc' },
          select: {
            quantity: true,
            treatment: {
              select: {
                id: true,
                treatment: true,
                purchasePrice: true,
                salesPriceInclTaxes: true,
              },
            },
          },
        },
      },
    });

    const errors = new Map<string, { message: string; payload: Record<string, string | number | boolean | null> }>();
    const detailSectionsByRowKey: Record<string, ReportDetailSection[]> = {};

    const rows = invoices.map((invoice) => {
      const totalVatExcl = this.toNumber(invoice.totalExclTaxes);
      const totalGross = this.toNumber(invoice.totalInclTaxes);
      const totalTax = this.toNumber(invoice.totalTax);
      const paid = this.toNumber(invoice.totalPaid);

      let materialsVatExcl = 0;

      const treatmentDetailRows = invoice.treatmentRows.map((treatmentRow) => ({
        columns: [
          treatmentRow.treatment.treatment,
          this.round2(this.toNumber(treatmentRow.amount)),
        ],
      }));

      const materialDetailRows = invoice.materialRows.map((materialRow) => {
        const quantity = this.toNumber(materialRow.quantity);
        const purchasePrice = materialRow.treatment.purchasePrice === null
          ? null
          : Number(materialRow.treatment.purchasePrice);
        const totalPurchaseCost = purchasePrice === null ? 0 : quantity * purchasePrice;
        const estimatedTreatmentCostVatExcl = materialRow.treatment.salesPriceInclTaxes === null
          ? null
          : this.round2((Number(materialRow.treatment.salesPriceInclTaxes) / 1.24) * quantity);

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
        } else {
          materialsVatExcl += totalPurchaseCost;
        }

        return {
          columns: [
            materialRow.treatment.treatment,
            this.round2(quantity),
            purchasePrice === null ? '' : this.round2(purchasePrice),
            this.round2(totalPurchaseCost),
            estimatedTreatmentCostVatExcl === null ? '' : estimatedTreatmentCostVatExcl,
          ],
        };
      });

      detailSectionsByRowKey[invoice.invoiceNumber] = [
        {
          title: 'Treatments',
          columns: ['Treatment name', 'Treatment cost (VAT excl)'],
          rows: treatmentDetailRows,
        },
        {
          title: 'Materials',
          columns: [
            'Material treatment name',
            'Quantity used',
            'Purchase price for 1',
            'Total purchase cost',
            'Treatment cost (VAT excl)',
          ],
          rows: materialDetailRows,
        },
      ];

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

    const treatmentCount = invoices.reduce(
      (accumulator, invoice) => accumulator + invoice.treatmentRows.length,
      0,
    );
    const treatmentAmount = invoices.reduce(
      (accumulator, invoice) => accumulator + invoice.treatmentRows.reduce(
        (invoiceTotal, row) => invoiceTotal + this.toNumber(row.amount),
        0,
      ),
      0,
    );
    const materialCount = invoices.reduce(
      (accumulator, invoice) => accumulator + invoice.materialRows.reduce(
        (invoiceTotal, row) => invoiceTotal + this.toNumber(row.quantity),
        0,
      ),
      0,
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
        { key: 'totalVatExcl', label: 'Total\n(VAT excl)', format: 'currency' },
        { key: 'materialsVatExcl', label: 'Materials\n(VAT excl)', format: 'currency' },
        { key: 'withoutMaterialsVatExcl', label: 'Remaining\n(VAT excl)', format: 'currency' },
        { key: 'vat', label: 'VAT', format: 'currency' },
        { key: 'paid', label: 'Paid', format: 'currency' },
      ],
      rows,
      summary: [
        { label: 'Invoices', value: rows.length, format: 'number' },
        { label: 'Total (VAT excl)', value: Number(totals.totalVatExcl.toFixed(2)), format: 'currency' },
        { label: 'Materials (VAT excl)', value: Number(totals.materialsVatExcl.toFixed(2)), format: 'currency' },
        { label: 'Remaining (VAT excl)', value: Number(totals.withoutMaterialsVatExcl.toFixed(2)), format: 'currency' },
        { label: 'VAT', value: Number(totals.vat.toFixed(2)), format: 'currency' },
        { label: 'Paid', value: Number(totals.paid.toFixed(2)), format: 'currency' },
      ],
      summaryRows: [
        { label: 'Invoices', number: rows.length, amount: null },
        { label: 'Treatments performed', number: treatmentCount, amount: Number(treatmentAmount.toFixed(2)) },
        { label: 'Materials used in treatments', number: Number(materialCount.toFixed(2)), amount: Number(totals.materialsVatExcl.toFixed(2)) },
        { label: 'Total (VAT excl)', number: null, amount: Number(totals.totalVatExcl.toFixed(2)) },
        { label: 'Remaining (VAT excl)', number: null, amount: Number(totals.withoutMaterialsVatExcl.toFixed(2)) },
        { label: 'VAT', number: null, amount: Number(totals.vat.toFixed(2)) },
        { label: 'Paid', number: null, amount: Number(totals.paid.toFixed(2)) },
      ],
      detailSectionsByRowKey,
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
