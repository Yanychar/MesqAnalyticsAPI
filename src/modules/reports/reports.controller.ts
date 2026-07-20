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
    response.setHeader(
      'Content-Disposition',
      this.buildDownloadDisposition(file.filename),
    );
    response.send(file.body);
  }

  private buildDownloadDisposition(filename: string): string {
    const extensionMatch = filename.match(/(\.[A-Za-z0-9]+)$/);
    const extension = extensionMatch?.[1] ?? '';
    const baseName = extension ? filename.slice(0, -extension.length) : filename;

    const asciiBaseName = baseName
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[\r\n"]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_\.]+|[_\.]+$/g, '');

    const safeFallback = `${asciiBaseName || 'report'}${extension}`;
    const encodedFilename = encodeURIComponent(filename);

    return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodedFilename}`;
  }
}
