import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';

import { ClinicmindsConfig } from 'src/config/clinicminds.config';

import {
  ClinicmindsFormat,
  ClinicmindsRequestResult,
  ClinicmindsReportDefinition,
} from './types/clinicminds-report.types';
import { ClinicmindsSpecService } from './clinicminds-spec.service';

@Injectable()
export class ClinicmindsClient {
  private readonly httpClient: AxiosInstance;
  private readonly config: ClinicmindsConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly clinicmindsSpecService: ClinicmindsSpecService,
  ) {
    this.config =
      this.configService.get<ClinicmindsConfig>('clinicminds') ??
      ({
        apiKey: '',
        baseUrl: 'https://app.clinicminds.com',
        timeoutMs: 30000,
        defaultFormat: 'json',
        userAgent: 'AppointmentsHandler/1.0 (+serge.sevastianov@medfin.fi)',
        locationId: null,
      } satisfies ClinicmindsConfig);

    this.httpClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeoutMs,
      headers: {
        'X-Api-Key': this.config.apiKey,
        'user-agent': this.getUserAgent(),
      },
    });
  }

  getSpecInfo() {
    return this.clinicmindsSpecService.getInfo();
  }

  private getUserAgent(): string {
    return this.config.userAgent;
  }

  listEndpoints(): ClinicmindsReportDefinition[] {
    return this.clinicmindsSpecService.listEndpoints();
  }

  getReportDefinition(operationId: string): ClinicmindsReportDefinition {
    const report = this.clinicmindsSpecService.getEndpoint(operationId);
    if (!report) {
      throw new HttpException(
        `Unsupported Clinicminds operation "${operationId}".`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return report;
  }


  private translateParamsForClinicminds(
    params: Record<string, string | number | boolean | undefined>,
  ): Record<string, string | number | boolean> {
    const translated = { ...params };

    // Keep readable internal filter names while still calling Clinicminds with its original query names.
    if (translated.booking_from !== undefined && translated.date2_from === undefined) {
      translated.date2_from = translated.booking_from;
    }

    if (translated.booking_to !== undefined && translated.date2_to === undefined) {
      translated.date2_to = translated.booking_to;
    }

    delete translated.booking_from;
    delete translated.booking_to;

    return Object.fromEntries(
      Object.entries(translated).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number | boolean>;
  }

  async fetchOperation(
    operationId: string,
    params: Record<string, string | number | boolean | undefined>,
    format: ClinicmindsFormat = this.config.defaultFormat,
  ): Promise<ClinicmindsRequestResult> {
    if (!this.config.apiKey) {
      throw new HttpException(
        'CLINICMINDS_API_TOKEN is required before testing Clinicminds operations.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const report = this.getReportDefinition(operationId);
    const cleanParams = this.translateParamsForClinicminds({
      format,
      ...params,
    });

    try {
      const response = await this.httpClient.get(report.path, {
        params: cleanParams,
      });

      return {
        operationId,
        requestPath: report.path,
        data: response.data,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      throw new HttpException(
        {
          message: 'Clinicminds request failed.',
          operationId,
          requestPath: report.path,
          clinicmindsStatus: axiosError.response?.status,
          clinicmindsBody: axiosError.response?.data,
        },
        axiosError.response?.status ?? HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
