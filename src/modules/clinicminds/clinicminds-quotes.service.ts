import { Injectable, Logger } from '@nestjs/common';

import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsFormat, ClinicmindsRequestResult } from './types/clinicminds-report.types';

@Injectable()
export class ClinicmindsQuotesService {
  private readonly logger = new Logger(ClinicmindsQuotesService.name);

  constructor(
    private readonly clinicmindsClient: ClinicmindsClient,
    private readonly clinicmindsRequestLogService: ClinicmindsRequestLogService,
  ) {}

  async fetchQuotes(
    params: Record<string, string | number | boolean | undefined>,
    format?: ClinicmindsFormat,
    saveLog = true,
  ): Promise<ClinicmindsRequestResult> {
    const operationId = 'getQuotes';
    const endpoint = this.clinicmindsClient.getReportDefinition(operationId);
    const requestPath = `${endpoint.path}?${new URLSearchParams(
      Object.entries({
        format,
        ...params,
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ).toString()}`;

    const log = saveLog
      ? await this.clinicmindsRequestLogService.start(operationId, requestPath, {
          format,
          ...params,
        })
      : null;

    try {
      const result = await this.clinicmindsClient.fetchOperation(operationId, params, format);
      const items = this.extractItems(result.data);
      const quoteCount = items.length;

      this.logger.log(
        `Clinicminds quotes request returned ${quoteCount} rows (filters: ${JSON.stringify(
          params,
        )})`,
      );

      if (log) {
        await this.clinicmindsRequestLogService.succeed(
          log.id,
          JSON.stringify(result.data).length,
        );
      }

      return {
        ...result,
        data: {
          quoteCount,
          items,
        },
      };
    } catch (error) {
      if (log) {
        await this.clinicmindsRequestLogService.fail(log.id, error);
      }

      throw error;
    }
  }

  private extractItems(data: unknown): unknown[] {
    if (Array.isArray(data)) {
      return data;
    }

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.items)) {
        return record.items;
      }

      return [record];
    }

    return data === undefined ? [] : [data];
  }
}
