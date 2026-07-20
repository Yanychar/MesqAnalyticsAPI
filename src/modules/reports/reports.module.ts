import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { InvoiceAmountsReport } from './reports/invoice-amounts.report';
import { QuotesReport } from './reports/quotes-report.report';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, InvoiceAmountsReport, QuotesReport],
  exports: [ReportsService],
})
export class ReportsModule {}
