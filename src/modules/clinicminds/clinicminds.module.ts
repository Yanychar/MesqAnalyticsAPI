import { Module } from '@nestjs/common';

import { ClinicmindsAppointmentsService } from './clinicminds-appointments.service';
import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsOnlineBookingsService } from './clinicminds-online-bookings.service';
import { ClinicmindsController } from './clinicminds.controller';
import { ClinicmindsPatientsService } from './clinicminds-patients.service';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsSpecService } from './clinicminds-spec.service';
import { ClinicmindsSyncConfigService } from './clinicminds-sync-config.service';
import { ClinicmindsSyncService } from './clinicminds-sync.service';

@Module({
  controllers: [ClinicmindsController],
  providers: [
    ClinicmindsAppointmentsService,
    ClinicmindsClient,
    ClinicmindsOnlineBookingsService,
    ClinicmindsSpecService,
    ClinicmindsRequestLogService,
    ClinicmindsPatientsService,
    ClinicmindsSyncConfigService,
    ClinicmindsSyncService,
  ],
  exports: [
    ClinicmindsAppointmentsService,
    ClinicmindsClient,
    ClinicmindsOnlineBookingsService,
    ClinicmindsSpecService,
    ClinicmindsRequestLogService,
    ClinicmindsPatientsService,
    ClinicmindsSyncConfigService,
    ClinicmindsSyncService,
  ],
})
export class ClinicmindsModule {}
