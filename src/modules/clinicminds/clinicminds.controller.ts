import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { ClinicmindsAppointmentsService } from './clinicminds-appointments.service';
import { ClinicmindsOnlineBookingsService } from './clinicminds-online-bookings.service';
import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsPatientsService } from './clinicminds-patients.service';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsSyncService } from './clinicminds-sync.service';
import {
  ClinicmindsRequestDto,
  ClinicmindsRequestQueryDto,
} from './dto/clinicminds-request.dto';
import {
  ClinicmindsSyncBatchDto,
  ClinicmindsSyncDto,
} from './dto/clinicminds-sync.dto';

@Controller('clinicminds')
export class ClinicmindsController {
  constructor(
    private readonly clinicmindsClient: ClinicmindsClient,
    private readonly clinicmindsAppointmentsService: ClinicmindsAppointmentsService,
    private readonly clinicmindsOnlineBookingsService: ClinicmindsOnlineBookingsService,
    private readonly clinicmindsRequestLogService: ClinicmindsRequestLogService,
    private readonly clinicmindsPatientsService: ClinicmindsPatientsService,
    private readonly clinicmindsSyncService: ClinicmindsSyncService,
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

  @Get('sync/entities')
  listSyncEntities() {
    return this.clinicmindsSyncService.listSyncEntities();
  }

  @Get('sync/runs')
  listSyncRuns(
    @Query('entityKey') entityKey?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clinicmindsSyncService.listRecentRuns(
      entityKey,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('raw')
  listRawRecords(
    @Query('entityKey') entityKey?: string,
    @Query('updateNeeded') updateNeeded?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clinicmindsSyncService.listRawRecords(
      entityKey,
      updateNeeded === undefined ? undefined : updateNeeded === 'true',
      limit ? Number(limit) : undefined,
    );
  }

  @Post('sync')
  syncBatch(@Body() body: ClinicmindsSyncBatchDto) {
    return this.clinicmindsSyncService.runBatch({
      entityKeys: body.entityKeys,
      format: body.format,
      params: body.params,
      saveRequestLog: body.saveRequestLog,
      continueOnError: body.continueOnError,
    });
  }

  @Post('sync/:entityKey')
  syncEntity(@Param('entityKey') entityKey: string, @Body() body: ClinicmindsSyncDto) {
    return this.clinicmindsSyncService.runEntity(entityKey, {
      format: body.format,
      params: body.params,
      saveRequestLog: body.saveRequestLog,
    });
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

  @Get('appointments')
  async getAppointments(@Query() query: Record<string, string | undefined>) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.clinicmindsAppointmentsService.fetchAppointments(params, format, saveLog);
  }

  @Get('online-bookings')
  async getOnlineBookings(@Query() query: Record<string, string | undefined>) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.clinicmindsOnlineBookingsService.fetchOnlineBookings(params, format, saveLog);
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
