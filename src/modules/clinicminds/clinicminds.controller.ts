import { Body, Controller, Get, Param, Post, Query, ServiceUnavailableException } from '@nestjs/common';

import { ClinicmindsAppointmentsService } from './clinicminds-appointments.service';
import { ClinicmindsInvoicesService } from './clinicminds-invoices.service';
import { ClinicmindsStageService } from './clinicminds-stage.service';
import { ClinicmindsProductSalesService } from './clinicminds-product-sales.service';
import { ClinicmindsTreatmentMaterialStockService } from './clinicminds-treatment-material-stock.service';
import { ClinicmindsOnlineBookingsService } from './clinicminds-online-bookings.service';
import { ClinicmindsClient } from './clinicminds.client';
import { ConfigService } from '@nestjs/config';
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
import { ClinicmindsStageDto } from './dto/clinicminds-stage.dto';

@Controller('clinicminds')
export class ClinicmindsController {
  constructor(
    private readonly clinicmindsClient: ClinicmindsClient,
    private readonly clinicmindsAppointmentsService: ClinicmindsAppointmentsService,
    private readonly clinicmindsInvoicesService: ClinicmindsInvoicesService,
    private readonly clinicmindsStageService: ClinicmindsStageService,
    private readonly clinicmindsProductSalesService: ClinicmindsProductSalesService,
    private readonly clinicmindsTreatmentMaterialStockService: ClinicmindsTreatmentMaterialStockService,
    private readonly clinicmindsOnlineBookingsService: ClinicmindsOnlineBookingsService,
    private readonly clinicmindsRequestLogService: ClinicmindsRequestLogService,
    private readonly clinicmindsPatientsService: ClinicmindsPatientsService,
    private readonly clinicmindsSyncService: ClinicmindsSyncService,
    private readonly configService: ConfigService,
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
    this.ensureRawEnabled();
    return this.clinicmindsSyncService.listSyncEntities();
  }

  @Get('stage/entities')
  listStageEntities() {
    return this.clinicmindsStageService.listStageEntities();
  }

  @Get('stage/runs')
  listStageRuns(
    @Query('entityKey') entityKey?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clinicmindsStageService.listRecentRuns(
      entityKey,
      limit ? Number(limit) : undefined,
    );
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
    @Query('stagingStatus') stagingStatus?: string,
    @Query('updateNeeded') updateNeeded?: string,
    @Query('limit') limit?: string,
  ) {
    const resolvedStatus = stagingStatus
      ?? (updateNeeded === undefined
        ? undefined
        : updateNeeded === 'true'
          ? 'STAGING_NEEDED'
          : 'STAGING_DONE');

    return this.clinicmindsSyncService.listRawRecords(
      entityKey,
      resolvedStatus as never,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('sync')
  syncBatch(@Body() body: ClinicmindsSyncBatchDto) {
    this.ensureRawEnabled();
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
    this.ensureRawEnabled();
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

  @Get('invoices')
  async getInvoices(@Query() query: Record<string, string | undefined>) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.clinicmindsInvoicesService.fetchInvoices(params, format, saveLog);
  }

  @Get('product-sales')
  async getProductSales(@Query() query: Record<string, string | undefined>) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.clinicmindsProductSalesService.fetchProductSales(params, format, saveLog);
  }

  @Get('treatment-material-stock')
  async getTreatmentMaterialStock(@Query() query: Record<string, string | undefined>) {
    const control = query as Record<string, string | undefined>;
    const format = control.format as ClinicmindsRequestQueryDto['format'];
    const saveLog = control.saveLog !== 'false';
    const params = Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'format' && key !== 'saveLog'),
    );

    return this.clinicmindsTreatmentMaterialStockService.fetchTreatmentMaterialStock(
      params,
      format,
      saveLog,
    );
  }

  @Get('stage/patients')
  listStagedPatients(@Query('limit') limit?: string) {
    return this.clinicmindsStageService.listPatients(limit ? Number(limit) : undefined);
  }

  @Get('stage/invoices')
  listStagedInvoices(@Query('limit') limit?: string) {
    return this.clinicmindsStageService.listInvoices(limit ? Number(limit) : undefined);
  }

  @Get('stage/treatments')
  listStagedTreatments(@Query('limit') limit?: string) {
    return this.clinicmindsStageService.listTreatments(limit ? Number(limit) : undefined);
  }

  @Post('stage/:entityKey')
  runStageEntity(@Param('entityKey') entityKey: string, @Body() body: ClinicmindsStageDto) {
    return this.clinicmindsStageService.runEntity(entityKey, body.limit);
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

  private ensureRawEnabled() {
    const execution = this.configService.get<{ enableRawSync: boolean }>('execution');
    if (execution?.enableRawSync === false) {
      throw new ServiceUnavailableException('Raw sync layer is disabled in this instance.');
    }
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
        await this.clinicmindsRequestLogService.fail(
          log.id,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }

      throw error;
    }
  }
}
