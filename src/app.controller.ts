import { Controller, Get } from '@nestjs/common';

import { PrismaService } from './modules/prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('help')
  getHelp() {
    return {
      name: 'MESQ Clinicminds Test App',
      routes: [
        { method: 'GET', path: '/help', description: 'Application help and quick route listing.' },
        { method: 'GET', path: '/health/mysql', description: 'Checks the MySQL connection with SELECT 1.' },
        { method: 'GET', path: '/clinicminds/spec', description: 'Returns the loaded Clinicminds API spec summary.' },
        { method: 'GET', path: '/clinicminds/patients', description: 'Requests Clinicminds patients with query filters and logs patient count.' },
        { method: 'GET', path: '/clinicminds/endpoints', description: 'Lists supported Clinicminds operations from the local OpenAPI spec.' },
        { method: 'GET', path: '/clinicminds/endpoints/:operationId', description: 'Returns metadata for a single Clinicminds operation.' },
        { method: 'GET', path: '/clinicminds/sync/entities', description: 'Lists sync entities loaded from config/entities.config.json.' },
        { method: 'GET', path: '/clinicminds/sync/runs', description: 'Lists recent sync runs stored in MySQL.' },
        { method: 'GET', path: '/clinicminds/raw', description: 'Lists raw imported rows from the single raw storage table.' },
        { method: 'POST', path: '/clinicminds/sync/:entityKey', description: 'Runs config-driven sync for one entity and stores raw JSON rows.' },
        { method: 'POST', path: '/clinicminds/sync', description: 'Runs config-driven sync for all enabled entities or an explicit entity list.' },
        { method: 'GET', path: '/clinicminds/request/:operationId', description: 'Calls a Clinicminds operation with query-string params.' },
        { method: 'POST', path: '/clinicminds/request', description: 'Calls a Clinicminds operation with a JSON body.' },
      ],
    };
  }

  @Get('health/mysql')
  async getMysqlHealth() {
    const rows = (await this.prisma.$queryRawUnsafe('SELECT 1 AS ok')) as Array<{
      ok: bigint | number;
    }>;

    return {
      status: 'ok',
      database: 'mysql',
      result: rows.map((row) => ({
        ok: Number(row.ok),
      })),
    };
  }
}
