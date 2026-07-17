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
        totalTreatments: true,
        totalPackages: true,
        totalProducts: true,
        totalGiftcard: true,
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
      const totalTreatments = this.toNumber(invoice.totalTreatments);
      const totalPackages = this.toNumber(invoice.totalPackages);
      const totalProducts = this.toNumber(invoice.totalProducts);
      const totalGiftcards = this.toNumber(invoice.totalGiftcard);
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
        type: totalVatExcl < 0 || totalGross < 0 ? 'CR' : 'DB',
        totalTreatments: this.round2(totalTreatments),
        totalPackages: this.round2(totalPackages),
        totalProducts: this.round2(totalProducts),
        totalGiftcards: this.round2(totalGiftcards),
        materialsVatExcl: this.round2(materialsVatExcl),
        totalInvoiced: this.round2(totalVatExcl),
        ownPlus: this.round2(totalVatExcl - materialsVatExcl),
      };
    });

    const errorList = Array.from(errors.values());
    await this.persistErrors(errorList);

    const totals = rows.reduce(
      (accumulator, row) => ({
        totalVatExcl: accumulator.totalVatExcl + this.toNumber(row.ownPlus) + this.toNumber(row.materialsVatExcl),
        totalTreatments: accumulator.totalTreatments + this.toNumber(row.totalTreatments),
        totalPackages: accumulator.totalPackages + this.toNumber(row.totalPackages),
        totalProducts: accumulator.totalProducts + this.toNumber(row.totalProducts),
        totalGiftcards: accumulator.totalGiftcards + this.toNumber(row.totalGiftcards),
        materialsVatExcl: accumulator.materialsVatExcl + this.toNumber(row.materialsVatExcl),
        totalInvoiced: accumulator.totalInvoiced + this.toNumber(row.totalInvoiced),
        ownPlus: accumulator.ownPlus + this.toNumber(row.ownPlus),
      }),
      {
        totalVatExcl: 0,
        totalTreatments: 0,
        totalPackages: 0,
        totalProducts: 0,
        totalGiftcards: 0,
        materialsVatExcl: 0,
        totalInvoiced: 0,
        ownPlus: 0,
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
        { key: 'type', label: 'Type' },
        { key: 'totalTreatments', label: 'Treatments', format: 'currency' },
        { key: 'totalPackages', label: 'Packages', format: 'currency' },
        { key: 'totalProducts', label: 'Products', format: 'currency' },
        { key: 'totalGiftcards', label: 'Gift cards', format: 'currency' },
        { key: 'materialsVatExcl', label: 'Materials', format: 'currency' },
        { key: 'totalInvoiced', label: 'Total invoiced', format: 'currency' },
        { key: 'ownPlus', label: 'Total without materials', format: 'currency' },
      ],
      rows,
      summary: [
        { label: 'Invoices', value: rows.length, format: 'number' },
        { label: 'Treatments', value: Number(totals.totalTreatments.toFixed(2)), format: 'currency' },
        { label: 'Packages', value: Number(totals.totalPackages.toFixed(2)), format: 'currency' },
        { label: 'Products', value: Number(totals.totalProducts.toFixed(2)), format: 'currency' },
        { label: 'Gift cards', value: Number(totals.totalGiftcards.toFixed(2)), format: 'currency' },
        { label: 'Materials', value: Number(totals.materialsVatExcl.toFixed(2)), format: 'currency' },
        { label: 'Total invoiced', value: Number(totals.totalInvoiced.toFixed(2)), format: 'currency' },
        { label: 'Total without materials', value: Number(totals.ownPlus.toFixed(2)), format: 'currency' },
      ],
      summaryRows: [
        { label: 'Invoices', number: rows.length, amount: null },
        { label: 'Treatments performed', number: treatmentCount, amount: Number(totals.totalTreatments.toFixed(2)) },
        { label: 'Materials used in treatments', number: Number(materialCount.toFixed(2)), amount: Number(totals.materialsVatExcl.toFixed(2)) },
        { label: 'Packages sold', number: null, amount: Number(totals.totalPackages.toFixed(2)) },
        { label: 'Products sold', number: null, amount: Number(totals.totalProducts.toFixed(2)) },
        { label: 'Gift cards', number: null, amount: Number(totals.totalGiftcards.toFixed(2)) },
        { label: 'Total invoiced', number: null, amount: Number(totals.totalInvoiced.toFixed(2)) },
        { label: 'Total without materials', number: null, amount: Number(totals.ownPlus.toFixed(2)) },
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
