import { Injectable, Logger } from '@nestjs/common';

import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsFormat, ClinicmindsRequestResult } from './types/clinicminds-report.types';

@Injectable()
export class ClinicmindsPatientsService {
  private readonly logger = new Logger(ClinicmindsPatientsService.name);

  constructor(
    private readonly clinicmindsClient: ClinicmindsClient,
    private readonly clinicmindsRequestLogService: ClinicmindsRequestLogService,
  ) {}

  async fetchPatients(
    params: Record<string, string | number | boolean | undefined>,
    format?: ClinicmindsFormat,
    saveLog = true,
  ): Promise<ClinicmindsRequestResult> {
    const operationId = 'getPatients';
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
      const patientCount = Array.isArray(result.data) ? result.data.length : 0;

      this.logger.log(
        `Clinicminds patients request returned ${patientCount} patients (filters: ${JSON.stringify(
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
          patientCount,
          items: result.data,
        },
      };
    } catch (error) {
      if (log) {
        await this.clinicmindsRequestLogService.fail(log.id, error);
      }

      throw error;
    }
  }
}
