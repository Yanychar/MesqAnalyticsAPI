import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ClinicmindsStageRunStatus, ClinicmindsStagingStatus, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { AppExecutionConfig } from 'src/config/app-execution.config';

import { PrismaService } from '../prisma/prisma.service';
import { ClinicmindsSyncConfigService } from './clinicminds-sync-config.service';

interface InvoiceSectionDefinition {
  startOrder: number;
  endOrder: number;
  groupKey: string;
  groupLabel: string;
}

interface InvoiceSectionRow {
  displayOrder: number;
  fieldKey: string;
  label: string;
  rawValue: string | null;
  decimalValue: string | null;
}

interface ParsedTreatmentLabel {
  externalId: string;
  treatment: string;
  brand: string | null;
  unit: string | null;
}

interface InvoiceMaterialRow {
  label: string;
  externalId: string;
  treatment: string;
  brand: string | null;
  unit: string | null;
  quantity: string;
}

interface InvoiceTreatmentRow {
  label: string;
  externalId: string;
  treatment: string;
  brand: string | null;
  unit: string | null;
  amount: string;
}

const INVOICE_SECTION_DEFINITIONS = {
  tax: {
    startOrder: 20,
    endOrder: 23,
    groupKey: 'taxSummary',
    groupLabel: 'Tax summary',
  },
  payment: {
    startOrder: 24,
    endOrder: 33,
    groupKey: 'paymentSummary',
    groupLabel: 'Payment summary',
  },
  productAmount: {
    startOrder: 38,
    endOrder: 40,
    groupKey: 'productAmount',
    groupLabel: 'Product amount summary',
  },
} satisfies Record<string, InvoiceSectionDefinition>;

@Injectable()
export class ClinicmindsStageService {
  private readonly logger = new Logger(ClinicmindsStageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncConfigService: ClinicmindsSyncConfigService,
    private readonly configService: ConfigService,
  ) {}

  listStageEntities() {
    return [
      {
        entityKey: 'cmPatient',
        label: 'CM Patient',
        targetTable: 'cm_patient',
      },
      {
        entityKey: 'cmInvoice',
        label: 'CM Invoice',
        targetTable: 'cm_invoice',
      },
      {
        entityKey: 'cmMaterialTreatment',
        label: 'CM Material Treatment',
        targetTable: 'cm_treatment',
      },
    ];
  }

  async runEntity(entityKey: string, limit?: number) {
    this.ensureStageEnabled();

    if (entityKey === 'cmPatient') {
      return this.stagePatients(limit);
    }

    if (entityKey === 'cmInvoice') {
      return this.stageInvoices(limit);
    }

    if (entityKey === 'cmMaterialTreatment') {
      return this.stageTreatments(limit);
    }

    throw new ServiceUnavailableException(`Stage entity ${entityKey} is not implemented yet.`);
  }

  async listRecentRuns(entityKey?: string, limit = 20) {
    this.ensureStageEnabled();

    const rows = await this.prisma.clinicmindsStageRun.findMany({
      where: entityKey ? { entityKey } : undefined,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return this.serializeForResponse(rows);
  }

  async listPatients(limit = 50) {
    this.ensureStageEnabled();

    const rows = await this.prisma.cmPatient.findMany({
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return this.serializeForResponse(rows);
  }

  async listInvoices(limit = 50) {
    this.ensureStageEnabled();

    const rows = await this.prisma.cmInvoice.findMany({
      include: {
        taxRows: { orderBy: { taxName: 'asc' } },
        paymentRows: { orderBy: { paymentMethod: 'asc' } },
        treatmentRows: { orderBy: { id: 'asc' } },
        productRows: { orderBy: { displayOrder: 'asc' } },
        materialRows: { orderBy: { id: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return this.serializeForResponse(rows);
  }

  async listTreatments(limit = 50) {
    this.ensureStageEnabled();

    const rows = await this.prisma.cmTreatment.findMany({
      orderBy: [
        { treatment: 'asc' },
        { brand: 'asc' },
        { unit: 'asc' },
      ],
      take: Math.min(Math.max(limit, 1), 200),
    });

    return this.serializeForResponse(rows);
  }

  private async stagePatients(limit?: number) {
    const stageRun = await this.prisma.clinicmindsStageRun.create({
      data: {
        entityKey: 'cmPatient',
        targetTable: 'cm_patient',
      },
    });

    const rows = await this.prisma.clinicmindsRawRecord.findMany({
      where: {
        entityKey: 'cmPatient',
        stagingStatus: ClinicmindsStagingStatus.STAGING_NEEDED,
      },
      orderBy: { id: 'asc' },
      ...(limit === undefined ? {} : { take: Math.max(limit, 1) }),
    });

    let staged = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const payload = this.asRecord(row.payload);
        const normalized = this.syncConfigService.normalizePayload('cmPatient', payload);
        const patientNumber = this.toNullableString(normalized.patientNumber);

        if (!patientNumber) {
          throw new Error('Patient number is required for staging.');
        }

        await this.prisma.cmPatient.upsert({
          where: { patientNumber },
          update: {
            lastRawRecordId: row.id,
            externalId: row.externalId,
            nationalIdentificationNumber: this.toNullableString(normalized.nationalIdentificationNumber),
            sex: this.toNullableString(normalized.sex),
            initials: this.toNullableString(normalized.initials),
            firstName: this.toNullableString(normalized.firstName),
            lastName: this.toNullableString(normalized.lastName),
            dateOfBirth: this.toNullableString(normalized.dateOfBirth),
            emailAddress: this.toNullableString(normalized.emailAddress),
            phoneNumber: this.toNullableString(normalized.phoneNumber),
            mobileNumber: this.toNullableString(normalized.mobileNumber),
            registered: this.toNullableString(normalized.registered),
            payload: normalized as Prisma.InputJsonValue,
          },
          create: {
            lastRawRecordId: row.id,
            externalId: row.externalId,
            patientNumber,
            nationalIdentificationNumber: this.toNullableString(normalized.nationalIdentificationNumber),
            sex: this.toNullableString(normalized.sex),
            initials: this.toNullableString(normalized.initials),
            firstName: this.toNullableString(normalized.firstName),
            lastName: this.toNullableString(normalized.lastName),
            dateOfBirth: this.toNullableString(normalized.dateOfBirth),
            emailAddress: this.toNullableString(normalized.emailAddress),
            phoneNumber: this.toNullableString(normalized.phoneNumber),
            mobileNumber: this.toNullableString(normalized.mobileNumber),
            registered: this.toNullableString(normalized.registered),
            payload: normalized as Prisma.InputJsonValue,
          },
        });

        await this.prisma.clinicmindsRawRecord.update({
          where: { id: row.id },
          data: {
            stagingStatus: ClinicmindsStagingStatus.STAGING_DONE,
            stagedAt: new Date(),
          },
        });

        staged += 1;
      } catch (error) {
        await this.prisma.clinicmindsRawRecord.update({
          where: { id: row.id },
          data: {
            stagingStatus: ClinicmindsStagingStatus.STAGING_ERROR,
          },
        });

        failed += 1;
        this.logger.error(
          `Failed to stage cmPatient raw row ${String(row.id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    const runStatus = failed > 0 ? ClinicmindsStageRunStatus.FAILED : ClinicmindsStageRunStatus.SUCCEEDED;

    await this.prisma.clinicmindsStageRun.update({
      where: { id: stageRun.id },
      data: {
        completedAt: new Date(),
        status: runStatus,
        scannedCount: rows.length,
        stagedCount: staged,
        failedCount: failed,
        error: failed > 0 ? 'One or more raw rows failed during staging.' : null,
      },
    });

    return {
      stageRunId: String(stageRun.id),
      entityKey: 'cmPatient',
      scanned: rows.length,
      staged,
      failed,
      status: runStatus,
    };
  }

  private async stageInvoices(limit?: number) {
    const stageRun = await this.prisma.clinicmindsStageRun.create({
      data: {
        entityKey: 'cmInvoice',
        targetTable: 'cm_invoice',
      },
    });

    const rows = await this.prisma.clinicmindsRawRecord.findMany({
      where: {
        entityKey: 'cmInvoice',
        stagingStatus: ClinicmindsStagingStatus.STAGING_NEEDED,
      },
      orderBy: { id: 'asc' },
      ...(limit === undefined ? {} : { take: Math.max(limit, 1) }),
    });

    let staged = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const payload = this.asRecord(row.payload);
        const invoiceData = this.getNestedSection(payload, 'Invoice data');
        const taxes = this.getNestedSection(payload, 'Taxes');
        const debtorData = this.getNestedSection(payload, 'Debtor data');
        const paymentMethods = this.getNestedSection(payload, 'Payment methods');
        const giftCards = this.getNestedSection(payload, 'Gift cards');
        const treatmentsExclTaxes = this.getNestedSection(payload, 'Treatments (excl. taxes)');
        const productsExclTaxes = this.getNestedSection(payload, 'Products (excl. taxes)');
        const treatmentMaterials = this.getNestedSection(payload, 'Treatment materials');
        const invoiceNumber = this.toNullableString(this.findNestedValue(payload, 'Invoice number'));

        if (!invoiceNumber) {
          throw new Error('Invoice number is required for staging.');
        }

        await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.cmInvoice.upsert({
            where: { invoiceNumber },
            update: {
              lastRawRecordId: row.id,
              externalId: row.externalId,
              patientNumber: this.toNullableString(debtorData['Patient number']),
              nationalIdentificationNumber: this.toNullableString(this.findNestedValue(payload, 'National identification number')),
              address: this.toNullableString(this.findNestedValue(payload, 'Address')),
              emailAddress: this.toNullableString(this.findNestedValue(payload, 'Email address')),
              phoneNumber: this.toNullableString(this.findNestedValue(payload, 'Phone number')),
              mobileNumber: this.toNullableString(this.findNestedValue(payload, 'Mobile number')),
              referral: this.toNullableString(this.findNestedValue(payload, 'Referral')),
              invoiceDate: this.toNullableString(invoiceData['Invoice date']),
              dueDate: this.toNullableString(invoiceData['Due date']),
              location: this.toNullableString(invoiceData.Location),
              user: this.toNullableString(invoiceData.User),
              taxExempted: this.toNullableString(invoiceData['Tax exempted']),
              discountNotes: this.toNullableString(invoiceData['Discount notes']),
              discountExclTaxes: this.toNullableDecimalString(invoiceData['Discount (excl. taxes)']),
              totalExclTaxes: this.toNullableDecimalString(invoiceData['Total (excl. taxes)']),
              totalInclTaxes: this.toNullableDecimalString(invoiceData['Total (incl. taxes)']),
              totalTax: this.toNullableDecimalString(taxes.Total),
              treatmentTotal: this.toNullableDecimalString(treatmentsExclTaxes.Total),
              totalGiftcard: this.toNullableDecimalString(giftCards.Total),
              totalPaid: this.toNullableDecimalString(paymentMethods.Total),
              outstanding: this.toNullableDecimalString(invoiceData.Outstanding),
              payload: payload as Prisma.InputJsonValue,
            },
            create: {
              lastRawRecordId: row.id,
              externalId: row.externalId,
              invoiceNumber,
              patientNumber: this.toNullableString(debtorData['Patient number']),
              nationalIdentificationNumber: this.toNullableString(this.findNestedValue(payload, 'National identification number')),
              address: this.toNullableString(this.findNestedValue(payload, 'Address')),
              emailAddress: this.toNullableString(this.findNestedValue(payload, 'Email address')),
              phoneNumber: this.toNullableString(this.findNestedValue(payload, 'Phone number')),
              mobileNumber: this.toNullableString(this.findNestedValue(payload, 'Mobile number')),
              referral: this.toNullableString(this.findNestedValue(payload, 'Referral')),
              invoiceDate: this.toNullableString(invoiceData['Invoice date']),
              dueDate: this.toNullableString(invoiceData['Due date']),
              location: this.toNullableString(invoiceData.Location),
              user: this.toNullableString(invoiceData.User),
              taxExempted: this.toNullableString(invoiceData['Tax exempted']),
              discountNotes: this.toNullableString(invoiceData['Discount notes']),
              discountExclTaxes: this.toNullableDecimalString(invoiceData['Discount (excl. taxes)']),
              totalExclTaxes: this.toNullableDecimalString(invoiceData['Total (excl. taxes)']),
              totalInclTaxes: this.toNullableDecimalString(invoiceData['Total (incl. taxes)']),
              totalTax: this.toNullableDecimalString(taxes.Total),
              treatmentTotal: this.toNullableDecimalString(treatmentsExclTaxes.Total),
              totalGiftcard: this.toNullableDecimalString(giftCards.Total),
              totalPaid: this.toNullableDecimalString(paymentMethods.Total),
              outstanding: this.toNullableDecimalString(invoiceData.Outstanding),
              payload: payload as Prisma.InputJsonValue,
            },
          });

          await tx.cmInvoiceTax.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoicePayment.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoiceTreatment.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoiceProduct.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoiceMaterial.deleteMany({ where: { invoiceId: invoice.id } });

          const taxRows = this.buildInvoiceTaxRows(taxes);
          if (taxRows.length > 0) {
            await tx.cmInvoiceTax.createMany({
              data: taxRows.map((item) => ({
                invoiceId: invoice.id,
                taxName: item.label,
                amount: item.decimalValue,
              })),
            });
          }

          const paymentRows = this.buildInvoicePaymentRows(paymentMethods);
          if (paymentRows.length > 0) {
            await tx.cmInvoicePayment.createMany({
              data: paymentRows.map((item) => ({
                invoiceId: invoice.id,
                paymentMethod: item.label,
                amount: item.decimalValue,
              })),
            });
          }

          const treatmentRows = this.buildInvoiceTreatmentRows(treatmentsExclTaxes);
          const materialRows = this.buildInvoiceMaterialRows(treatmentMaterials);
          const fallbackLocationId = this.getConfiguredTreatmentLocationId();

          for (const item of treatmentRows) {
            const treatment = await this.ensureTreatmentRecord(tx, {
              externalId: item.externalId,
              treatment: item.treatment,
              brand: item.brand,
              unit: item.unit,
              materialStock: false,
              locationId: fallbackLocationId,
              payload: {
                source: 'cmInvoice',
                sourceBlock: 'Treatments (excl. taxes)',
                label: item.label,
              },
            });

            await tx.cmInvoiceTreatment.create({
              data: {
                invoiceId: invoice.id,
                treatmentId: treatment.id,
                amount: item.amount,
              },
            });
          }

          const productRows = this.buildInvoiceSectionRows(
            productsExclTaxes,
            INVOICE_SECTION_DEFINITIONS.productAmount,
          );
          if (productRows.length > 0) {
            await tx.cmInvoiceProduct.createMany({
              data: productRows.map((item) => ({
                invoiceId: invoice.id,
                displayOrder: item.displayOrder,
                fieldKey: item.fieldKey,
                label: item.label,
                amount: item.decimalValue,
                rawValue: item.rawValue,
              })),
            });
          }

          for (const item of materialRows) {
            const treatment = await this.ensureTreatmentRecord(tx, {
              externalId: item.externalId,
              treatment: item.treatment,
              brand: item.brand,
              unit: item.unit,
              materialStock: true,
              locationId: fallbackLocationId,
              payload: {
                source: 'cmInvoice',
                sourceBlock: 'Treatment materials',
                label: item.label,
              },
            });

            await tx.cmInvoiceMaterial.create({
              data: {
                invoiceId: invoice.id,
                treatmentId: treatment.id,
                quantity: item.quantity,
              },
            });
          }

          await tx.clinicmindsRawRecord.update({
            where: { id: row.id },
            data: {
              stagingStatus: ClinicmindsStagingStatus.STAGING_DONE,
              stagedAt: new Date(),
            },
          });
        });

        staged += 1;
      } catch (error) {
        await this.prisma.clinicmindsRawRecord.update({
          where: { id: row.id },
          data: {
            stagingStatus: ClinicmindsStagingStatus.STAGING_ERROR,
          },
        });

        failed += 1;
        this.logger.error(
          `Failed to stage cmInvoice raw row ${String(row.id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    const runStatus = failed > 0 ? ClinicmindsStageRunStatus.FAILED : ClinicmindsStageRunStatus.SUCCEEDED;

    await this.prisma.clinicmindsStageRun.update({
      where: { id: stageRun.id },
      data: {
        completedAt: new Date(),
        status: runStatus,
        scannedCount: rows.length,
        stagedCount: staged,
        failedCount: failed,
        error: failed > 0 ? 'One or more raw rows failed during staging.' : null,
      },
    });

    return {
      stageRunId: String(stageRun.id),
      entityKey: 'cmInvoice',
      scanned: rows.length,
      staged,
      failed,
      status: runStatus,
    };
  }

  private async stageTreatments(limit?: number) {
    const stageRun = await this.prisma.clinicmindsStageRun.create({
      data: {
        entityKey: 'cmMaterialTreatment',
        targetTable: 'cm_treatment',
      },
    });

    const rows = await this.prisma.clinicmindsRawRecord.findMany({
      where: {
        entityKey: 'cmMaterialTreatment',
        stagingStatus: ClinicmindsStagingStatus.STAGING_NEEDED,
      },
      orderBy: { id: 'asc' },
      ...(limit === undefined ? {} : { take: Math.max(limit, 1) }),
    });

    const entityConfig = this.syncConfigService.getEntity('cmMaterialTreatment');
    const configuredLocationId = this.toNullableInt(entityConfig?.staticParams?.location_id);
    let staged = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const payload = this.asRecord(row.payload);
        const normalized = this.syncConfigService.normalizePayload('cmMaterialTreatment', payload);
        const treatment = this.toNullableString(normalized.treatment);
        const brand = this.toNullableString(normalized.brand);
        const unit = this.toNullableString(normalized.unit);
        const externalId = this.buildTreatmentExternalId(treatment, brand, unit);

        if (!treatment) {
          throw new Error('Treatment is required for staging.');
        }

        if (!externalId) {
          throw new Error('External id is required for treatment material stock staging.');
        }

        if (configuredLocationId === null) {
          throw new Error('Configured location_id is required for cmMaterialTreatment staging.');
        }

        await this.prisma.cmTreatment.upsert({
          where: { externalId_materialStock: { externalId, materialStock: true } },
          update: {
            lastRawRecordId: row.id,
            entityKey: 'cmMaterialTreatment',
            locationId: configuredLocationId,
            treatment,
            brand,
            supplier: this.toNullableString(normalized.supplier),
            articleNumber: this.toNullableString(normalized.articleNumber),
            unit,
            salesPriceInclTaxes: this.toNullableDecimalString(normalized.salesPriceInclTaxes),
            purchasePrice: this.toNullableDecimalString(normalized.purchasePrice),
            stock: this.toNullableDecimalString(normalized.stock),
            minimumStock: this.toNullableDecimalString(normalized.minimumStock),
            stockValue: this.toNullableDecimalString(normalized.stockValue),
            materialStock: true,
            payload: payload as Prisma.InputJsonValue,
          },
          create: {
            lastRawRecordId: row.id,
            entityKey: 'cmMaterialTreatment',
            externalId,
            locationId: configuredLocationId,
            treatment,
            brand,
            supplier: this.toNullableString(normalized.supplier),
            articleNumber: this.toNullableString(normalized.articleNumber),
            unit,
            salesPriceInclTaxes: this.toNullableDecimalString(normalized.salesPriceInclTaxes),
            purchasePrice: this.toNullableDecimalString(normalized.purchasePrice),
            stock: this.toNullableDecimalString(normalized.stock),
            minimumStock: this.toNullableDecimalString(normalized.minimumStock),
            stockValue: this.toNullableDecimalString(normalized.stockValue),
            materialStock: true,
            payload: payload as Prisma.InputJsonValue,
          },
        });

        await this.prisma.clinicmindsRawRecord.update({
          where: { id: row.id },
          data: {
            stagingStatus: ClinicmindsStagingStatus.STAGING_DONE,
            stagedAt: new Date(),
          },
        });

        staged += 1;
      } catch (error) {
        await this.prisma.clinicmindsRawRecord.update({
          where: { id: row.id },
          data: {
            stagingStatus: ClinicmindsStagingStatus.STAGING_ERROR,
          },
        });

        failed += 1;
        this.logger.error(
          `Failed to stage cmMaterialTreatment raw row ${String(row.id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    const runStatus = failed > 0 ? ClinicmindsStageRunStatus.FAILED : ClinicmindsStageRunStatus.SUCCEEDED;

    await this.prisma.clinicmindsStageRun.update({
      where: { id: stageRun.id },
      data: {
        completedAt: new Date(),
        status: runStatus,
        scannedCount: rows.length,
        stagedCount: staged,
        failedCount: failed,
        error: failed > 0 ? 'One or more raw rows failed during staging.' : null,
      },
    });

    return {
      stageRunId: String(stageRun.id),
      entityKey: 'cmMaterialTreatment',
      scanned: rows.length,
      staged,
      failed,
      status: runStatus,
    };
  }

  private buildInvoiceSectionRows(
    section: Record<string, unknown>,
    definition: InvoiceSectionDefinition,
  ): InvoiceSectionRow[] {
    // Clinicminds invoice rows are stored as nested report sections, so stage
    // conversion reads each section directly instead of flattening everything first.
    return Object.entries(section)
      .map(([label, value], index) => ({
        displayOrder: definition.startOrder + index,
        fieldKey: this.toFieldKey(label),
        label,
        rawValue: this.toNullableString(value),
        decimalValue: this.toNullableDecimalString(value),
      }))
      .filter((field) => field.rawValue !== null);
  }

  private buildInvoiceMaterialRows(section: Record<string, unknown>): InvoiceMaterialRow[] {
    return Object.entries(section)
      .filter(([label]) => label !== 'Total')
      .map(([label, value]) => ({
        label,
        quantity: this.toNullableDecimalString(value),
        parsed: this.parseTreatmentLabel(label),
      }))
      .filter(
        (item): item is { label: string; quantity: string; parsed: ParsedTreatmentLabel } =>
          item.quantity !== null && item.quantity !== '0' && item.parsed !== null,
      )
      .map((item) => ({
        label: item.label,
        externalId: item.parsed.externalId,
        treatment: item.parsed.treatment,
        brand: item.parsed.brand,
        unit: item.parsed.unit,
        quantity: item.quantity,
      }));
  }

  private buildInvoiceTreatmentRows(section: Record<string, unknown>): InvoiceTreatmentRow[] {
    return Object.entries(section)
      .filter(([label]) => label !== 'Total')
      .map(([label, value]) => ({
        label,
        amount: this.toNullableDecimalString(value),
        parsed: this.parseTreatmentLabel(label),
      }))
      .filter(
        (item): item is { label: string; amount: string; parsed: ParsedTreatmentLabel } =>
          item.amount !== null && item.amount !== '0' && item.parsed !== null,
      )
      .map((item) => ({
        label: item.label,
        externalId: item.parsed.externalId,
        treatment: item.parsed.treatment,
        brand: item.parsed.brand,
        unit: item.parsed.unit,
        amount: item.amount,
      }));
  }

  private buildInvoicePaymentRows(section: Record<string, unknown>): InvoiceSectionRow[] {
    return Object.entries(section)
      .filter(([label]) => label !== 'Total')
      .map(([label, value], index) => ({
        displayOrder: INVOICE_SECTION_DEFINITIONS.payment.startOrder + index,
        fieldKey: this.toFieldKey(label),
        label,
        rawValue: this.toNullableString(value),
        decimalValue: this.toNullableDecimalString(value),
      }))
      .filter((field) => field.decimalValue !== null && field.decimalValue !== '0');
  }

  private buildInvoiceTaxRows(section: Record<string, unknown>): InvoiceSectionRow[] {
    return Object.entries(section)
      .filter(([label]) => label !== 'Total')
      .map(([label, value], index) => ({
        displayOrder: INVOICE_SECTION_DEFINITIONS.tax.startOrder + index,
        fieldKey: this.toFieldKey(label),
        label,
        rawValue: this.toNullableString(value),
        decimalValue: this.toNullableDecimalString(value),
      }))
      .filter((field) => field.decimalValue !== null && field.decimalValue !== '0');
  }

  private getNestedSection(payload: Record<string, unknown>, sectionKey: string): Record<string, unknown> {
    const section = payload[sectionKey];
    return section && typeof section === 'object' && !Array.isArray(section)
      ? (section as Record<string, unknown>)
      : {};
  }

  private findNestedValue(value: unknown, targetKey: string): unknown {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findNestedValue(item, targetKey);
        if (found !== undefined) {
          return found;
        }
      }

      return undefined;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (targetKey in record) {
        return record[targetKey];
      }

      for (const item of Object.values(record)) {
        const found = this.findNestedValue(item, targetKey);
        if (found !== undefined) {
          return found;
        }
      }
    }

    return undefined;
  }

  private parseTreatmentLabel(label: string): ParsedTreatmentLabel | null {
    const externalId = label.trim();
    if (!externalId) {
      return null;
    }

    const match = externalId.match(/^(.*?)\s*\((.*?)\)$/);
    if (!match) {
      return {
        externalId,
        treatment: externalId,
        brand: null,
        unit: null,
      };
    }

    const treatment = match[1]?.trim();
    const inner = match[2]?.trim();
    if (!treatment) {
      return null;
    }

    const parts = inner.split(';').map((part) => part.trim()).filter(Boolean);
    return {
      externalId,
      treatment,
      brand: parts.length > 1 ? parts[0] ?? null : null,
      unit: parts.length > 0 ? parts[parts.length - 1] ?? null : null,
    };
  }

  private buildTreatmentExternalId(
    treatment: string | null,
    brand: string | null,
    unit: string | null,
  ): string | null {
    if (!treatment) {
      return null;
    }

    const details = [brand, unit].filter((value): value is string => Boolean(value && value.trim()));
    return details.length > 0 ? `${treatment} (${details.join('; ')})` : treatment;
  }

  private getConfiguredTreatmentLocationId(): number {
    const entityConfig = this.syncConfigService.getEntity('cmMaterialTreatment');
    const configuredLocationId = this.toNullableInt(entityConfig?.staticParams?.location_id);
    if (configuredLocationId === null) {
      throw new Error('Configured location_id is required for treatment staging.');
    }

    return configuredLocationId;
  }

  private async ensureTreatmentRecord(
    tx: Prisma.TransactionClient,
    input: {
      externalId: string;
      treatment: string;
      brand: string | null;
      unit: string | null;
      materialStock: boolean;
      locationId: number;
      payload: Prisma.InputJsonValue;
    },
  ) {
    return tx.cmTreatment.upsert({
      where: {
        externalId_materialStock: {
          externalId: input.externalId,
          materialStock: input.materialStock,
        },
      },
      update: {
        entityKey: input.materialStock ? 'cmMaterialTreatment' : 'cmServiceTreatment',
        locationId: input.locationId,
        treatment: input.treatment,
        brand: input.brand,
        unit: input.unit,
        materialStock: input.materialStock,
        payload: input.payload,
      },
      create: {
        entityKey: input.materialStock ? 'cmMaterialTreatment' : 'cmServiceTreatment',
        externalId: input.externalId,
        locationId: input.locationId,
        treatment: input.treatment,
        brand: input.brand,
        unit: input.unit,
        materialStock: input.materialStock,
        payload: input.payload,
      },
    });
  }

  private toFieldKey(label: string): string {
    return label
      .normalize('NFKD')
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .map((part, index) => {
        const lower = part.toLowerCase();
        return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join('');
  }

  private ensureStageEnabled() {
    const execution = this.configService.get<AppExecutionConfig>('execution');
    if (execution?.enableStageSync === false) {
      throw new ServiceUnavailableException('Stage layer is disabled in this instance.');
    }
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private toNullableString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return String(value);
  }

  private toNullableDecimalString(value: unknown): string | null {
    const text = this.toNullableString(value);
    if (!text) {
      return null;
    }

    const normalized = text.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  }

  private toNullableInt(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private serializeForResponse<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)),
    ) as T;
  }
}
