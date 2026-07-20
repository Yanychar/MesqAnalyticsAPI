import { Injectable } from '@nestjs/common';
import { AppEventLevel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReportDefinition,
  ReportDetailSection,
  ReportExecutionResult,
  ReportImplementation,
  ReportSummaryRow,
} from '../report.types';

type QuoteCreatorResolution =
  | { creator: string; uiMessage?: string; event?: PersistedEvent }
  | { creator: string; uiMessage: string; event: PersistedEvent };

interface PersistedEvent {
  level: AppEventLevel;
  title: string;
  message: string;
  payload: Record<string, string | number | boolean | null>;
}

interface QuoteReportRow extends Record<string, string | number | boolean | null> {
  creator: string;
  quoteNumber: string;
  quoteDate: string;
  patientName: string;
  patientNumber: string;
  treatmentCategory: string;
  upcomingTreatmentDate: string;
  status: string;
}

interface RecordCandidate {
  id: string;
  patientNumber: string | null;
  recordDate: string | null;
  recordType: string | null;
  user: string | null;
}

@Injectable()
export class QuotesReport implements ReportImplementation {
  constructor(private readonly prisma: PrismaService) {}

  getDefinition(): ReportDefinition {
    return {
      key: 'quotes-report',
      name: 'Отчет по квотам',
      description: 'Список всех созданных за период квот, сгруппированных по создателю, со статусом квоты на дату отчета.',
      supportedFormats: ['csv', 'xlsx'],
      filters: [
        {
          key: 'quoteDateFrom',
          label: 'Дата квоты с',
          type: 'date',
          required: true,
          defaultValue: '2026-01-01',
        },
        {
          key: 'quoteDateTo',
          label: 'Дата квоты по',
          type: 'date',
          required: true,
          defaultValue: new Date().toISOString().slice(0, 10),
        },
      ],
    };
  }

  async run(filters: Record<string, string>): Promise<ReportExecutionResult> {
    const definition = this.getDefinition();
    const quoteDateFrom = filters.quoteDateFrom || definition.filters[0].defaultValue || '';
    const quoteDateTo = filters.quoteDateTo || definition.filters[1].defaultValue || '';

    const quotes = await this.prisma.cmQuote.findMany({
      where: {
        quoteDate: {
          gte: quoteDateFrom,
          lte: quoteDateTo,
        },
      },
      orderBy: [
        { quoteDate: 'asc' },
        { quoteNumber: 'asc' },
      ],
      select: {
        id: true,
        quoteNumber: true,
        quoteDate: true,
        patientNumber: true,
        treatmentCategory: true,
        upcomingTreatmentDate: true,
        quoteStatus: true,
        totalExclTaxes: true,
      },
    });

    const patientNumbers = Array.from(
      new Set(
        quotes
          .map((quote) => quote.patientNumber)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const recordsDateFrom = this.shiftDate(quoteDateFrom, -5);

    const [candidateRecords, patients] = patientNumbers.length === 0
      ? [[], []]
      : await Promise.all([
          this.prisma.cmRecord.findMany({
            where: {
              patientNumber: { in: patientNumbers },
              recordDate: {
                gte: recordsDateFrom,
                lte: quoteDateTo,
              },
            },
            orderBy: [
              { patientNumber: 'asc' },
              { recordDate: 'asc' },
              { user: 'asc' },
              { recordType: 'asc' },
            ],
            select: {
              id: true,
              patientNumber: true,
              recordDate: true,
              recordType: true,
              user: true,
            },
          }),
          this.prisma.cmPatient.findMany({
            where: {
              patientNumber: { in: patientNumbers },
            },
            select: {
              patientNumber: true,
              firstName: true,
              lastName: true,
            },
          }),
        ]);

    const recordsByPatientDate = new Map<string, RecordCandidate[]>();
    for (const row of candidateRecords) {
      const key = this.buildPatientDateKey(row.patientNumber, row.recordDate);
      const items = recordsByPatientDate.get(key) ?? [];
      items.push({
        id: String(row.id),
        patientNumber: row.patientNumber,
        recordDate: row.recordDate,
        recordType: row.recordType,
        user: row.user,
      });
      recordsByPatientDate.set(key, items);
    }

    const patientNames = new Map<string, string>();
    for (const patient of patients) {
      const fullName = [patient.firstName, patient.lastName]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(' ')
        .trim();
      patientNames.set(patient.patientNumber, fullName || patient.patientNumber);
    }

    const events = new Map<string, PersistedEvent>();
    const errors = new Map<string, string>();
    const rows: QuoteReportRow[] = [];
    const detailSectionsByRowKey: Record<string, ReportDetailSection[]> = {};

    for (const quote of quotes) {
      const resolution = this.resolveCreator(
        quote.quoteNumber,
        quote.patientNumber,
        quote.quoteDate,
        this.collectCandidateRecords(
          recordsByPatientDate,
          quote.patientNumber,
          quote.quoteDate,
        ),
      );

      if (resolution.uiMessage) {
        errors.set(resolution.uiMessage, resolution.uiMessage);
      }

      if (resolution.event) {
        events.set(resolution.event.message, resolution.event);
      }

      const patientNumber = quote.patientNumber ?? '';
      const patientName = patientNames.get(patientNumber) ?? patientNumber;
      const status = this.mapQuoteStatus(quote.quoteStatus);

      rows.push({
        creator: resolution.creator,
        quoteNumber: quote.quoteNumber,
        quoteDate: quote.quoteDate ?? '',
        patientName,
        patientNumber,
        totalExclTaxes: quote.totalExclTaxes ? Number(quote.totalExclTaxes) : 0,
        treatmentCategory: quote.treatmentCategory ?? '',
        upcomingTreatmentDate: quote.upcomingTreatmentDate ?? '',
        status,
      });

      detailSectionsByRowKey[quote.quoteNumber] = [
        {
          title: 'Квота',
          columns: ['Поле', 'Значение'],
          rows: [
            { columns: ['№ квоты', quote.quoteNumber] },
            { columns: ['Дата квоты', quote.quoteDate ?? ''] },
            { columns: ['Сумма квоты (без ALV)', quote.totalExclTaxes ? Number(quote.totalExclTaxes) : 0] },
            { columns: ['Пациент', patientName] },
            { columns: ['Создатель', resolution.creator] },
            { columns: ['Статус на дату отчета', status] },
            { columns: ['Категория лечения', quote.treatmentCategory ?? ''] },
            { columns: ['Дата ближайшего визита', quote.upcomingTreatmentDate ?? ''] },
          ],
        },
      ];
    }

    rows.sort((left, right) => {
      return left.creator.localeCompare(right.creator, 'ru')
        || left.quoteDate.localeCompare(right.quoteDate)
        || left.quoteNumber.localeCompare(right.quoteNumber);
    });

    await this.persistEvents(Array.from(events.values()));

    const totalCount = rows.length;
    const waitingCount = rows.filter((row) => row.status === 'ждет выполнения').length;
    const completedCount = rows.filter((row) => row.status === 'выполнена (оплачена)').length;
    const cancelledCount = rows.filter((row) => row.status === 'отменена').length;
    const unknownCreatorCount = rows.filter((row) => row.creator === 'Создатель квоты неизвестен').length;

    const creatorSummary = new Map<string, { count: number; amount: number }>();
    for (const row of rows) {
      const current = creatorSummary.get(row.creator) ?? { count: 0, amount: 0 };
      creatorSummary.set(row.creator, {
        count: current.count + 1,
        amount: current.amount + Number(row.totalExclTaxes ?? 0),
      });
    }

    const totalAmount = rows.reduce((sum, row) => sum + Number(row.totalExclTaxes ?? 0), 0);
    const waitingAmount = rows
      .filter((row) => row.status === 'ждет выполнения')
      .reduce((sum, row) => sum + Number(row.totalExclTaxes ?? 0), 0);
    const completedAmount = rows
      .filter((row) => row.status === 'выполнена (оплачена)')
      .reduce((sum, row) => sum + Number(row.totalExclTaxes ?? 0), 0);
    const cancelledAmount = rows
      .filter((row) => row.status === 'отменена')
      .reduce((sum, row) => sum + Number(row.totalExclTaxes ?? 0), 0);
    const unknownCreatorAmount = rows
      .filter((row) => row.creator === 'Создатель квоты неизвестен')
      .reduce((sum, row) => sum + Number(row.totalExclTaxes ?? 0), 0);

    const summaryRows: ReportSummaryRow[] = [
      { label: 'Всего квот', number: totalCount, amount: totalAmount },
      { label: 'Ждут выполнения', number: waitingCount, amount: waitingAmount },
      { label: 'Выполнены (оплачены)', number: completedCount, amount: completedAmount },
      { label: 'Отменены', number: cancelledCount, amount: cancelledAmount },
      { label: 'Создатель не определен', number: unknownCreatorCount, amount: unknownCreatorAmount },
      { label: '__separator__', number: null, amount: null },
      ...Array.from(creatorSummary.entries())
        .sort(([left], [right]) => left.localeCompare(right, 'ru'))
        .map(([creator, stats]) => ({
          label: creator,
          number: stats.count,
          amount: stats.amount,
        })),
    ];

    return {
      reportKey: definition.key,
      reportName: definition.name,
      generatedAt: new Date().toISOString(),
      filters: {
        quoteDateFrom,
        quoteDateTo,
      },
      columns: [
        { key: 'quoteNumber', label: '№ квоты' },
        { key: 'quoteDate', label: 'Дата квоты' },
        { key: 'patientName', label: 'Пациент' },
        { key: 'totalExclTaxes', label: 'Сумма (без ALV)', format: 'currency' },
        { key: 'treatmentCategory', label: 'Категория лечения' },
        { key: 'upcomingTreatmentDate', label: 'Дата ближайшего визита' },
        { key: 'status', label: 'Статус на дату отчета' },
      ],
      rows,
      detailSectionsByRowKey,
      summary: [
        { label: 'Всего квот', value: totalCount, format: 'number' },
        { label: 'Ждут выполнения', value: waitingCount, format: 'number' },
        { label: 'Выполнены (оплачены)', value: completedCount, format: 'number' },
        { label: 'Отменены', value: cancelledCount, format: 'number' },
        { label: 'Создатель не определен', value: unknownCreatorCount, format: 'number' },
        { label: 'Сумма квот', value: totalAmount, format: 'currency' },
      ],
      summaryRows,
      errors: Array.from(errors.values()),
    };
  }

  private resolveCreator(
    quoteNumber: string,
    patientNumber: string | null,
    quoteDate: string | null,
    records: RecordCandidate[],
  ): QuoteCreatorResolution {
    const consultationRecords = records
      .filter((row) => this.isConsultation(row.recordType) && row.user)
      .sort((left, right) => this.compareRecordsDescending(left, right));
    const preferred = consultationRecords[0];

    if (preferred?.user) {
      if (preferred.recordDate && quoteDate && preferred.recordDate !== quoteDate) {
        const message = `В квоте № ${quoteNumber} создатель квоты выбран по Консультации, сделанной ранее создания квоты.`;
        return {
          creator: preferred.user,
          uiMessage: message,
          event: {
            level: AppEventLevel.WARN,
            title: 'Создатель квоты определен по более ранней консультации',
            message,
            payload: {
              quoteNumber,
              patientNumber,
              quoteDate,
              recordId: preferred.id,
              recordDate: preferred.recordDate,
              recordType: preferred.recordType,
              user: preferred.user,
            },
          },
        };
      }

      return { creator: preferred.user };
    }

    const fallback = records
      .filter((row) => row.user)
      .sort((left, right) => this.compareRecordsDescending(left, right))[0];
    if (fallback?.user) {
      const message = `В квоте № ${quoteNumber} создатель квоты выбран по типу записи, отличной от "Консультация".`;
      return {
        creator: fallback.user,
        uiMessage: message,
        event: {
          level: AppEventLevel.WARN,
          title: 'Создатель квоты определен по записи не типа "Консультация"',
          message,
          payload: {
            quoteNumber,
            patientNumber,
            quoteDate,
            recordId: fallback.id,
            recordDate: fallback.recordDate,
            recordType: fallback.recordType,
            user: fallback.user,
          },
        },
      };
    }

    const message = `Создатель квоты № ${quoteNumber} не может быть определен так как нет записи в медицинской истории на эту дату.`;
    return {
      creator: 'Создатель квоты неизвестен',
      uiMessage: message,
      event: {
        level: AppEventLevel.ERROR,
        title: 'Создатель квоты не определен',
        message,
        payload: {
          quoteNumber,
          patientNumber,
          quoteDate,
        },
      },
    };
  }

  private collectCandidateRecords(
    recordsByPatientDate: Map<string, RecordCandidate[]>,
    patientNumber: string | null,
    quoteDate: string | null,
  ): RecordCandidate[] {
    if (!quoteDate) {
      return [];
    }

    const items: RecordCandidate[] = [];
    for (let offset = 0; offset <= 5; offset += 1) {
      const candidateDate = this.shiftDate(quoteDate, -offset);
      const candidateRows = recordsByPatientDate.get(this.buildPatientDateKey(patientNumber, candidateDate)) ?? [];
      items.push(...candidateRows);
    }

    return items;
  }

  private compareRecordsDescending(left: RecordCandidate, right: RecordCandidate): number {
    const leftDate = left.recordDate ?? '';
    const rightDate = right.recordDate ?? '';

    if (leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate);
    }

    return right.id.localeCompare(left.id, 'en', { numeric: true });
  }

  private shiftDate(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private async persistEvents(events: PersistedEvent[]) {
    for (const event of events) {
      await this.prisma.appEvent.create({
        data: {
          level: event.level,
          source: 'Отчет по квотам',
          entityKey: 'quotes-report',
          title: event.title,
          message: event.message,
          payload: event.payload,
        },
      });
    }
  }

  private buildPatientDateKey(patientNumber: string | null, date: string | null): string {
    return `${patientNumber ?? ''}|${date ?? ''}`;
  }

  private isConsultation(recordType: string | null): boolean {
    const normalized = (recordType ?? '').trim().toLowerCase();
    return normalized === 'consultation' || normalized === 'консультация';
  }

  private mapQuoteStatus(status: string | null): string {
    const normalized = (status ?? '').trim().toLowerCase();

    if (normalized.includes('invoice')) {
      return 'выполнена (оплачена)';
    }

    if (
      normalized.includes('reject')
      || normalized.includes('expire')
      || normalized.includes('cancel')
      || normalized.includes('отмен')
    ) {
      return 'отменена';
    }

    return 'ждет выполнения';
  }
}
