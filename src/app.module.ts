import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { appExecutionConfig } from './config/app-execution.config';
import { clinicmindsConfig } from './config/clinicminds.config';
import { ClinicmindsModule } from './modules/clinicminds/clinicminds.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appExecutionConfig, clinicmindsConfig],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ClinicmindsModule,
    ReportsModule,
  ],
})
export class AppModule {}
