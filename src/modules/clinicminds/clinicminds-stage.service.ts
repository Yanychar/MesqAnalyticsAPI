import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppEventLevel, ClinicmindsStageRunStatus, ClinicmindsStagingStatus, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

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

interface InvoicePackageRow {
  label: string;
  externalId: string;
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
        entityKey: 'cmRecord',
        label: 'CM Record',
        targetTable: 'cm_record',
      },
      {
        entityKey: 'cmQuote',
        label: 'CM Quote',
        targetTable: 'cm_quote',
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

    if (entityKey === 'cmRecord') {
      return this.stageRecords(limit);
    }

    if (entityKey === 'cmQuote') {
      return this.stageQuotes(limit);
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
        packageRows: { orderBy: { id: 'asc' } },
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

  async listRecords(limit = 50) {
    this.ensureStageEnabled();

    const rows = await this.prisma.cmRecord.findMany({
      orderBy: [
        { recordDate: 'desc' },
        { id: 'desc' },
      ],
      take: Math.min(Math.max(limit, 1), 200),
    });

    return this.serializeForResponse(rows);
  }

  async listQuotes(limit = 50) {
    this.ensureStageEnabled();

    const rows = await this.prisma.cmQuote.findMany({
      orderBy: [
        { quoteDate: 'desc' },
        { quoteNumber: 'desc' },
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
        const packagesExclTaxes = this.getNestedSection(payload, 'Packages (excl. taxes)');
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
              totalTreatments: this.toNullableDecimalString(treatmentsExclTaxes.Total),
              totalPackages: this.toNullableDecimalString(packagesExclTaxes.Total),
              totalProducts: this.toNullableDecimalString(productsExclTaxes.Total),
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
              totalTreatments: this.toNullableDecimalString(treatmentsExclTaxes.Total),
              totalPackages: this.toNullableDecimalString(packagesExclTaxes.Total),
              totalProducts: this.toNullableDecimalString(productsExclTaxes.Total),
              totalGiftcard: this.toNullableDecimalString(giftCards.Total),
              totalPaid: this.toNullableDecimalString(paymentMethods.Total),
              outstanding: this.toNullableDecimalString(invoiceData.Outstanding),
              payload: payload as Prisma.InputJsonValue,
            },
          });

          await tx.cmInvoiceTax.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoicePayment.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoiceTreatment.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoicePackage.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoiceProduct.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.cmInvoiceMaterial.deleteMany({ where: { invoiceId: invoice.id } });

          const taxRows = this.buildInvoiceTaxRows(taxes);
          await this.validateInvoiceSectionTotal(
            tx,
            invoiceNumber,
            'Taxes',
            taxes.Total,
            taxRows.map((item) => item.decimalValue),
          );
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
          await this.validateInvoiceSectionTotal(
            tx,
            invoiceNumber,
            'Payment methods',
            paymentMethods.Total,
            paymentRows.map((item) => item.decimalValue),
          );
          const paymentRowsToStore = this.buildStoredInvoicePaymentRows(paymentRows, paymentMethods.Total);
          if (paymentRowsToStore.length > 0) {
            await tx.cmInvoicePayment.createMany({
              data: paymentRowsToStore.map((item) => ({
                invoiceId: invoice.id,
                paymentMethod: item.paymentMethod,
                amount: item.amount,
              })),
            });
          }

          const treatmentRows = this.buildInvoiceTreatmentRows(treatmentsExclTaxes);
          await this.validateInvoiceSectionTotal(
            tx,
            invoiceNumber,
            'Treatments (excl. taxes)',
            treatmentsExclTaxes.Total,
            treatmentRows.map((item) => item.amount),
          );
          const packageRows = this.buildInvoicePackageRows(packagesExclTaxes);
          await this.validateInvoiceSectionTotal(
            tx,
            invoiceNumber,
            'Packages (excl. taxes)',
            packagesExclTaxes.Total,
            packageRows.map((item) => item.amount),
          );
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

          for (const item of packageRows) {
            const invoicePackage = await this.ensurePackageRecord(tx, {
              externalId: item.externalId,
              packageName: item.label,
              payload: {
                source: 'cmInvoice',
                sourceBlock: 'Packages (excl. taxes)',
                label: item.label,
              },
            });

            await tx.cmInvoicePackage.create({
              data: {
                invoiceId: invoice.id,
                packageId: invoicePackage.id,
                amount: item.amount,
              },
            });
          }

          const productRows = this.buildInvoiceSectionRows(
            productsExclTaxes,
            INVOICE_SECTION_DEFINITIONS.productAmount,
          ).filter((item) => item.decimalValue !== null && item.decimalValue !== '0');
          await this.validateInvoiceSectionTotal(
            tx,
            invoiceNumber,
            'Products (excl. taxes)',
            productsExclTaxes.Total,
            productRows.map((item) => item.decimalValue),
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

          await this.validateInvoiceSectionTotal(
            tx,
            invoiceNumber,
            'Gift cards',
            giftCards.Total,
            this.buildInvoiceSectionRows(giftCards, {
              startOrder: 0,
              endOrder: 0,
              groupKey: 'giftCards',
              groupLabel: 'Gift cards',
            }).map((item) => item.decimalValue),
          );

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
              source: 'invoice',
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

  private async stageRecords(limit?: number) {
    const stageRun = await this.prisma.clinicmindsStageRun.create({
      data: {
        entityKey: 'cmRecord',
        targetTable: 'cm_record',
      },
    });

    const rows = await this.prisma.clinicmindsRawRecord.findMany({
      where: {
        entityKey: 'cmRecord',
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
        const normalized = this.syncConfigService.normalizePayload('cmRecord', payload);
        const patientNumber = this.toNullableString(normalized.patientNumber);
        const recordDate = this.toNullableString(
          normalized.recordDate ?? this.findFirstNestedValue(payload, ['Date', 'Record date']),
        );
        const recordType = this.toNullableString(
          normalized.recordType ?? this.findFirstNestedValue(payload, ['Type', 'Record type']),
        );
        const treatmentCategory = this.toNullableString(
          normalized.treatmentCategory
            ?? this.findFirstNestedValue(payload, ['Treatment categories', 'Treatment category']),
        );
        const location = this.toNullableString(
          normalized.location ?? this.findFirstNestedValue(payload, ['Location']),
        );
        const user = this.toNullableString(
          normalized.user ?? this.findFirstNestedValue(payload, ['User']),
        );
        const recordKey = this.buildRecordKey({
          payload,
          patientNumber,
          recordDate,
          recordType,
          treatmentCategory,
          location,
          user,
        });

        await this.prisma.cmRecord.upsert({
          where: { recordKey },
          update: {
            lastRawRecordId: row.id,
            externalId: row.externalId,
            patientNumber,
            recordDate,
            recordType,
            treatmentCategory,
            location,
            user,
            diagnoses: this.toNullableString(
              normalized.diagnoses ?? this.findFirstNestedValue(payload, ['Diagnoses']),
            ),
            asaClassification: this.toNullableString(
              normalized.asaClassification ?? this.findFirstNestedValue(payload, ['ASA classification']),
            ),
            payload: payload as Prisma.InputJsonValue,
          },
          create: {
            lastRawRecordId: row.id,
            externalId: row.externalId,
            recordKey,
            patientNumber,
            recordDate,
            recordType,
            treatmentCategory,
            location,
            user,
            diagnoses: this.toNullableString(
              normalized.diagnoses ?? this.findFirstNestedValue(payload, ['Diagnoses']),
            ),
            asaClassification: this.toNullableString(
              normalized.asaClassification ?? this.findFirstNestedValue(payload, ['ASA classification']),
            ),
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
          `Failed to stage cmRecord raw row ${String(row.id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      entityKey: 'cmRecord',
      scanned: rows.length,
      staged,
      failed,
      status: runStatus,
    };
  }

  private async stageQuotes(limit?: number) {
    const stageRun = await this.prisma.clinicmindsStageRun.create({
      data: {
        entityKey: 'cmQuote',
        targetTable: 'cm_quote',
      },
    });

    const rows = await this.prisma.clinicmindsRawRecord.findMany({
      where: {
        entityKey: 'cmQuote',
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
        const quoteNumber = this.toNullableString(
          row.externalId
            ?? this.findFirstNestedValue(payload, ['Quote number', 'Quote', 'Quote no.', 'Quote ID']),
        );

        if (!quoteNumber) {
          throw new Error('Quote number is required for staging.');
        }

        const quoteDate = this.toNullableString(
          this.findFirstNestedValue(payload, ['Quote date', 'Date', 'Created at']),
        );

        await this.prisma.cmQuote.upsert({
          where: { quoteNumber },
          update: {
            lastRawRecordId: row.id,
            externalId: row.externalId,
            patientNumber: this.toNullableString(this.findFirstNestedValue(payload, ['Patient number'])),
            quoteDate,
            validUntil: this.toNullableString(this.findFirstNestedValue(payload, ['Valid until', 'Expiration date', 'Expiry date'])),
            location: this.toNullableString(this.findFirstNestedValue(payload, ['Location'])),
            user: this.toNullableString(this.findFirstNestedValue(payload, ['User'])),
            treatmentCategory: this.toNullableString(this.findFirstNestedValue(payload, ['Treatment category', 'Treatment type'])),
            upcomingTreatmentDate: this.toNullableString(this.findFirstNestedValue(payload, ['Upcoming treatment date', 'Treatment date', 'First treatment date'])),
            quoteStatus: this.toNullableString(this.findFirstNestedValue(payload, ['Status', 'Quote status'])),
            totalInclTaxes: this.toNullableDecimalString(this.findFirstNestedValue(payload, ['Total (incl. taxes)', 'Total incl. taxes', 'Total including taxes'])),
            totalExclTaxes: this.toNullableDecimalString(this.findFirstNestedValue(payload, ['Total (excl. taxes)', 'Total excl. taxes', 'Total excluding taxes'])),
            outstanding: this.toNullableDecimalString(this.findFirstNestedValue(payload, ['Outstanding', 'Amount outstanding'])),
            payload: payload as Prisma.InputJsonValue,
          },
          create: {
            lastRawRecordId: row.id,
            externalId: row.externalId,
            quoteNumber,
            patientNumber: this.toNullableString(this.findFirstNestedValue(payload, ['Patient number'])),
            quoteDate,
            validUntil: this.toNullableString(this.findFirstNestedValue(payload, ['Valid until', 'Expiration date', 'Expiry date'])),
            location: this.toNullableString(this.findFirstNestedValue(payload, ['Location'])),
            user: this.toNullableString(this.findFirstNestedValue(payload, ['User'])),
            treatmentCategory: this.toNullableString(this.findFirstNestedValue(payload, ['Treatment category', 'Treatment type'])),
            upcomingTreatmentDate: this.toNullableString(this.findFirstNestedValue(payload, ['Upcoming treatment date', 'Treatment date', 'First treatment date'])),
            quoteStatus: this.toNullableString(this.findFirstNestedValue(payload, ['Status', 'Quote status'])),
            totalInclTaxes: this.toNullableDecimalString(this.findFirstNestedValue(payload, ['Total (incl. taxes)', 'Total incl. taxes', 'Total including taxes'])),
            totalExclTaxes: this.toNullableDecimalString(this.findFirstNestedValue(payload, ['Total (excl. taxes)', 'Total excl. taxes', 'Total excluding taxes'])),
            outstanding: this.toNullableDecimalString(this.findFirstNestedValue(payload, ['Outstanding', 'Amount outstanding'])),
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
          `Failed to stage cmQuote raw row ${String(row.id)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      entityKey: 'cmQuote',
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
            inventoryConfirmed: true,
            manualReviewNeeded: false,
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
            inventoryConfirmed: true,
            manualReviewNeeded: false,
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

  private async validateInvoiceSectionTotal(
    tx: Prisma.TransactionClient,
    invoiceNumber: string,
    sectionName: string,
    totalValue: unknown,
    itemValues: Array<string | null>,
  ) {
    const declaredTotal = this.toNullableDecimalString(totalValue);
    const normalizedItemValues = itemValues.filter((value): value is string => value !== null);

    if (declaredTotal === null || normalizedItemValues.length === 0) {
      return;
    }

    const summedItems = normalizedItemValues.reduce((sum, value) => sum + Number(value), 0);
    const declaredTotalNumber = Number(declaredTotal);
    const difference = Number((declaredTotalNumber - summedItems).toFixed(2));

    if (Math.abs(difference) < 0.01) {
      return;
    }

    const title = 'Invoice section total mismatch';
    const message = `Invoice ${invoiceNumber}, block "${sectionName}" total ${declaredTotal} does not match item sum ${summedItems.toFixed(2)}.`;
    const existing = await tx.appEvent.findFirst({
      where: {
        source: 'ClinicmindsStageService',
        entityKey: 'cmInvoice',
        title,
        message,
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    this.logger.error(message);
    await tx.appEvent.create({
      data: {
        level: AppEventLevel.ERROR,
        source: 'ClinicmindsStageService',
        entityKey: 'cmInvoice',
        title,
        message,
        payload: {
          invoiceNumber,
          sectionName,
          declaredTotal,
          summedItems: summedItems.toFixed(2),
          difference: difference.toFixed(2),
        },
      },
    });
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

  private buildInvoicePackageRows(section: Record<string, unknown>): InvoicePackageRow[] {
    return Object.entries(section)
      .filter(([label]) => label !== 'Total')
      .map(([label, value]) => ({
        label,
        amount: this.toNullableDecimalString(value),
      }))
      .filter((item): item is { label: string; amount: string } => item.amount !== null && item.amount !== '0')
      .map((item) => ({
        label: item.label,
        externalId: item.label.trim(),
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

  private buildStoredInvoicePaymentRows(
    paymentRows: InvoiceSectionRow[],
    totalValue: unknown,
  ): Array<{ paymentMethod: string; amount: string }> {
    const totalPaid = this.toNullableDecimalString(totalValue);
    const rows = paymentRows
      .filter((row): row is InvoiceSectionRow & { decimalValue: string } => row.decimalValue !== null)
      .map((row) => ({
        paymentMethod: row.label,
        amount: row.decimalValue,
      }));

    if (totalPaid === null) {
      return rows;
    }

    const stagedSum = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    const totalPaidNumber = Number(totalPaid);
    const difference = Number((totalPaidNumber - stagedSum).toFixed(2));

    if (rows.length === 0 && totalPaidNumber > 0) {
      return [
        {
          paymentMethod: 'Unallocated payment methods',
          amount: totalPaid,
        },
      ];
    }

    if (difference > 0) {
      rows.push({
        paymentMethod: 'Unallocated payment methods',
        amount: difference.toFixed(2),
      });
    }

    return rows;
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

  private findFirstNestedValue(value: unknown, targetKeys: string[]): unknown {
    for (const key of targetKeys) {
      const found = this.findNestedValue(value, key);
      if (found !== undefined) {
        return found;
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

  private buildRecordKey(input: {
    payload: Record<string, unknown>;
    patientNumber: string | null;
    recordDate: string | null;
    recordType: string | null;
    treatmentCategory: string | null;
    location: string | null;
    user: string | null;
  }): string {
    const descriptive = [
      input.patientNumber,
      input.recordDate,
      input.recordType,
      input.treatmentCategory,
      input.location,
      input.user,
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join('|');
    const payloadHash = createHash('sha1')
      .update(JSON.stringify(input.payload))
      .digest('hex')
      .slice(0, 16);

    return descriptive ? `${descriptive}|${payloadHash}` : payloadHash;
  }

  private getConfiguredTreatmentLocationId(): number {
    const entityConfig = this.syncConfigService.getEntity('cmMaterialTreatment');
    const configuredLocationId = this.toNullableInt(entityConfig?.staticParams?.location_id);
    if (configuredLocationId === null) {
      throw new Error('Configured location_id is required for treatment staging.');
    }

    return configuredLocationId;
  }

  private async ensurePackageRecord(
    tx: Prisma.TransactionClient,
    input: {
      externalId: string;
      packageName: string;
      payload: Prisma.InputJsonValue;
    },
  ) {
    // Package catalog rows are preserved across invoice restaging. We upsert
    // the reusable package definition here, while CmInvoicePackage rows are
    // still rebuilt per invoice together with the other invoice child tables.
    return tx.cmPackage.upsert({
      where: {
        externalId: input.externalId,
      },
      update: {
        packageName: input.packageName,
        payload: input.payload,
      },
      create: {
        externalId: input.externalId,
        packageName: input.packageName,
        payload: input.payload,
      },
    });
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
      source?: 'invoice' | 'inventory';
    },
  ) {
    const existing = await tx.cmTreatment.findUnique({
      where: {
        externalId_materialStock: {
          externalId: input.externalId,
          materialStock: input.materialStock,
        },
      },
    });

    if (input.materialStock && input.source === 'invoice' && (!existing || existing.inventoryConfirmed === false)) {
      const message = `Material treatment requires manual review because it exists in invoice usage but not in stock inventory: ${input.externalId}`;
      this.logger.error(message);
      await tx.appEvent.create({
        data: {
          level: AppEventLevel.ERROR,
          source: 'ClinicmindsStageService',
          entityKey: 'cmMaterialTreatment',
          title: 'Invoice-only material treatment detected',
          message,
          payload: input.payload,
        },
      });
    }

    const inventoryConfirmed = input.materialStock
      ? input.source === 'inventory' || existing?.inventoryConfirmed === true
      : false;
    const manualReviewNeeded = input.materialStock
      ? inventoryConfirmed ? false : true
      : false;

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
        inventoryConfirmed,
        manualReviewNeeded,
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
        inventoryConfirmed,
        manualReviewNeeded,
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
