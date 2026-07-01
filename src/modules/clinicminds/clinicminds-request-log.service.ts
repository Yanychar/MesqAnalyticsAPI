import { Injectable } from '@nestjs/common';
import { ApiRequestStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClinicmindsRequestLogService {
  constructor(private readonly prisma: PrismaService) {}

  async start(operationId: string, requestPath: string, queryParams: Record<string, unknown>) {
    return this.prisma.apiRequestLog.create({
      data: {
        operationId,
        requestPath,
        queryParams: queryParams as Prisma.InputJsonValue,
      },
    });
  }

  async succeed(logId: string, responseSize: number) {
    await this.prisma.apiRequestLog.update({
      where: { id: logId },
      data: {
        status: ApiRequestStatus.SUCCEEDED,
        completedAt: new Date(),
        responseSize,
      },
    });
  }

  async fail(logId: string, error: unknown) {
    await this.prisma.apiRequestLog.update({
      where: { id: logId },
      data: {
        status: ApiRequestStatus.FAILED,
        completedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown Clinicminds request error',
      },
    });
  }
}
