import { Module } from '@nestjs/common';

import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsController } from './clinicminds.controller';
import { ClinicmindsPatientsService } from './clinicminds-patients.service';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsSpecService } from './clinicminds-spec.service';

@Module({
  controllers: [ClinicmindsController],
  providers: [ClinicmindsClient, ClinicmindsSpecService, ClinicmindsRequestLogService, ClinicmindsPatientsService],
  exports: [ClinicmindsClient, ClinicmindsSpecService, ClinicmindsRequestLogService, ClinicmindsPatientsService],
})
export class ClinicmindsModule {}
