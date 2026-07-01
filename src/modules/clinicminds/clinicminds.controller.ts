import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsPatientsService } from './clinicminds-patients.service';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import {
  ClinicmindsRequestDto,
  ClinicmindsRequestQueryDto,
} from './dto/clinicminds-request.dto';

@Controller('clinicminds')
export class ClinicmindsController {
  constructor(
    private readonly clinicmindsClient: ClinicmindsClient,
    private readonly clinicmindsRequestLogService: ClinicmindsRequestLogService,
    private readonly clinicmindsPatientsService: ClinicmindsPatientsService,
  ) {}

  @Get('spec')
  getSpecInfo() {
    return this.clinicmindsClient.getSpecInfo();
  }

  @Get('endpoints')
  listEndpoints() {
    return this.clinicmindsClient.listEndpoints();
  }

  @Get('endpoints/:operationId')
  getEndpoint(@Param('operationId') operationId: string) {
    return this.clinicmindsClient.getReportDefinition(operationId);
  }

  @Get('patients')
  async getPatients(@Query() query: Record<string, string | undefined>) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.clinicmindsPatientsService.fetchPatients(params, format, saveLog);
  }

  @Post('request')
  async requestByBody(@Body() body: ClinicmindsRequestDto) {
    return this.executeRequest(
      body.operationId,
      body.params ?? {},
      body.format,
      body.saveLog ?? true,
    );
  }

  @Get('request/:operationId')
  async requestByQuery(
    @Param('operationId') operationId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.executeRequest(operationId, params, format, saveLog);
  }

  private async executeRequest(
    operationId: string,
    params: Record<string, string | number | boolean | undefined>,
    format?: 'json' | 'csv' | 'scsv',
    saveLog = true,
  ) {
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

      if (log) {
        await this.clinicmindsRequestLogService.succeed(
          log.id,
          JSON.stringify(result.data).length,
        );
      }

      return result;
    } catch (error) {
      if (log) {
        await this.clinicmindsRequestLogService.fail(log.id, error);
      }

      throw error;
    }
  }
}
