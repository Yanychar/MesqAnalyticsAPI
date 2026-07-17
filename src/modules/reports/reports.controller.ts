import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';

import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  listReports() {
    return this.reportsService.listDefinitions();
  }

  @Get(':reportKey')
  getReport(@Param('reportKey') reportKey: string) {
    return this.reportsService.getDefinition(reportKey);
  }

  @Post(':reportKey/run')
  runReport(
    @Param('reportKey') reportKey: string,
    @Body() filters: Record<string, string>,
  ) {
    return this.reportsService.runReport(reportKey, filters ?? {});
  }

  @Get(':reportKey/download')
  @Header('Cache-Control', 'no-store')
  async downloadReport(
    @Param('reportKey') reportKey: string,
    @Query('format') format: string | undefined,
    @Query() query: Record<string, string | undefined>,
    @Res() response: any,
  ) {
    const { format: _format, ...filters } = query;
    const file = await this.reportsService.downloadReport(
      reportKey,
      format ?? 'xlsx',
      Object.fromEntries(
        Object.entries(filters).flatMap(([key, value]) => value === undefined ? [] : [[key, value]]),
      ),
    );

    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.send(file.body);
  }
}
