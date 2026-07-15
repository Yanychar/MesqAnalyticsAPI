import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceAmountsReport } from './reports/invoice-amounts.report';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, InvoiceAmountsReport],
  exports: [ReportsService],
})
export class ReportsModule {}
