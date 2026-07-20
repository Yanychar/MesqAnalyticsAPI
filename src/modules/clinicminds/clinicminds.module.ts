import { Module } from '@nestjs/common';

import { ClinicmindsAppointmentsService } from './clinicminds-appointments.service';
import { ClinicmindsCronService } from './clinicminds-cron.service';
import { ClinicmindsInvoicesService } from './clinicminds-invoices.service';
import { ClinicmindsProductSalesService } from './clinicminds-product-sales.service';
import { ClinicmindsRecordsService } from './clinicminds-records.service';
import { ClinicmindsQuotesService } from './clinicminds-quotes.service';
import { ClinicmindsTreatmentMaterialStockService } from './clinicminds-treatment-material-stock.service';
import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsOnlineBookingsService } from './clinicminds-online-bookings.service';
import { ClinicmindsController } from './clinicminds.controller';
import { ClinicmindsPatientsService } from './clinicminds-patients.service';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsSpecService } from './clinicminds-spec.service';
import { ClinicmindsStageService } from './clinicminds-stage.service';
import { ClinicmindsSyncConfigService } from './clinicminds-sync-config.service';
import { ClinicmindsSyncService } from './clinicminds-sync.service';

@Module({
  controllers: [ClinicmindsController],
  providers: [
    ClinicmindsAppointmentsService,
    ClinicmindsCronService,
    ClinicmindsInvoicesService,
    ClinicmindsProductSalesService,
    ClinicmindsRecordsService,
    ClinicmindsQuotesService,
    ClinicmindsTreatmentMaterialStockService,
    ClinicmindsClient,
    ClinicmindsOnlineBookingsService,
    ClinicmindsSpecService,
    ClinicmindsStageService,
    ClinicmindsRequestLogService,
    ClinicmindsPatientsService,
    ClinicmindsSyncConfigService,
    ClinicmindsSyncService,
  ],
  exports: [
    ClinicmindsAppointmentsService,
    ClinicmindsInvoicesService,
    ClinicmindsProductSalesService,
    ClinicmindsRecordsService,
    ClinicmindsQuotesService,
    ClinicmindsClient,
    ClinicmindsOnlineBookingsService,
    ClinicmindsSpecService,
    ClinicmindsStageService,
    ClinicmindsRequestLogService,
    ClinicmindsPatientsService,
    ClinicmindsSyncConfigService,
    ClinicmindsSyncService,
  ],
})
export class ClinicmindsModule {}
