import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';

import { clinicmindsConfig } from './config/clinicminds.config';
import { ClinicmindsModule } from './modules/clinicminds/clinicminds.module';
import { PrismaModule } from './modules/prisma/prisma.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [clinicmindsConfig],
    }),
    PrismaModule,
    ClinicmindsModule,
  ],
})
export class AppModule {}

