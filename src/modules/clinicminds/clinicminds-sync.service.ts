import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ClinicmindsSyncStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ClinicmindsClient } from './clinicminds.client';
import { ClinicmindsRequestLogService } from './clinicminds-request-log.service';
import { ClinicmindsSyncConfigService } from './clinicminds-sync-config.service';
import { ClinicmindsReportDefinition } from './types/clinicminds-report.types';
import {
  ClinicmindsEntitySyncConfig,
  ClinicmindsSyncBatchInput,
  ClinicmindsSyncEntityInput,
  ClinicmindsSyncEntityResult,
  ClinicmindsSyncPrimitive,
} from './types/clinicminds-sync.types';

@Injectable()
export class ClinicmindsSyncService {
  private readonly logger = new Logger(ClinicmindsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicmindsClient: ClinicmindsClient,
    private readonly requestLogService: ClinicmindsRequestLogService,
    private readonly syncConfigService: ClinicmindsSyncConfigService,
  ) {}

  listSyncEntities() {
    return this.syncConfigService.listEntities().map((entity) => ({
      ...entity,
      operationId: this.resolveOperation(entity).operationId,
    }));
  }

  async runEntity(
    entityKey: string,
    input: ClinicmindsSyncEntityInput = {},
  ): Promise<ClinicmindsSyncEntityResult> {
    const entity = this.syncConfigService.getEntity(entityKey);
    if (!entity) {
      throw new BadRequestException(`Unknown Clinicminds sync entity "${entityKey}".`);
    }

    return this.runEntityConfig(entity, input);
  }

  async runBatch(input: ClinicmindsSyncBatchInput = {}) {
    const entityKeys = input.entityKeys?.length
      ? input.entityKeys
      : this.syncConfigService.listEnabledEntities().map((entity) => entity.key);

    const results: ClinicmindsSyncEntityResult[] = [];
    for (const entityKey of entityKeys) {
      try {
        results.push(
          await this.runEntity(entityKey, {
            format: input.format,
            params: input.params,
            saveRequestLog: input.saveRequestLog,
          }),
        );
      } catch (error) {
        if (!input.continueOnError) {
          throw error;
        }

        results.push({
          entityKey,
          operationId: 'unknown',
          requestPath: '',
          fetchedCount: 0,
          storedCount: 0,
          syncRunId: '',
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown sync error',
        });
      }
    }

    return {
      entityCount: entityKeys.length,
      succeeded: results.filter((result) => result.status === 'SUCCEEDED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
      results,
    };
  }

  async listRecentRuns(entityKey?: string, limit = 20) {
    const runs = await this.prisma.clinicmindsSyncRun.findMany({
      where: entityKey ? { entityKey } : undefined,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    // Prisma returns MySQL BIGINT ids as JavaScript bigint values.
    return runs.map((run) => this.serializeBigIntValues(run));
  }

  async listRawRecords(entityKey?: string, updateNeeded?: boolean, limit = 20) {
    const rows = await this.prisma.clinicmindsRawRecord.findMany({
      where: {
        ...(entityKey ? { entityKey } : {}),
        ...(updateNeeded === undefined ? {} : { updateNeeded }),
      },
      orderBy: { fetchedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return rows.map((row) => this.serializeBigIntValues(row));
  }

  private async runEntityConfig(
    entity: ClinicmindsEntitySyncConfig,
    input: ClinicmindsSyncEntityInput,
  ): Promise<ClinicmindsSyncEntityResult> {
    const operation = this.resolveOperation(entity);
    const format = input.format ?? 'json';
    const syncPlan = await this.buildSyncPlan(entity, input.params ?? {});

    if (syncPlan.skipReason) {
      this.logger.log(syncPlan.skipReason);

      return {
        entityKey: entity.key,
        operationId: operation.operationId,
        requestPath: operation.path,
        fetchedCount: 0,
        storedCount: 0,
        syncRunId: '',
        status: 'SUCCEEDED',
      };
    }

    const params = syncPlan.params;
    const requestPath = this.buildRequestPath(operation.path, params, format);

    const syncRun = await this.prisma.clinicmindsSyncRun.create({
      data: {
        entityKey: entity.key,
        operationId: operation.operationId,
        requestPath,
        requestParams: params as Prisma.InputJsonValue,
      },
    });

    const requestLog = input.saveRequestLog === false
      ? null
      : await this.requestLogService.start(operation.operationId, requestPath, {
          format,
          ...params,
        });

    try {
      const result = await this.clinicmindsClient.fetchOperation(
        operation.operationId,
        params,
        format,
      );
      const items = this.extractItems(result.data);
      // Raw rows stay source-shaped on purpose. Normalization will be added later.
      const rawRows = items.map((item, index) => this.toRawRecord(entity, item, index));

      if (rawRows.length > 0) {
        await this.prisma.clinicmindsRawRecord.createMany({
          data: rawRows.map((row) => ({
            syncRunId: syncRun.id,
            entityKey: entity.key,
            externalId: row.externalId,
            updateNeeded: false,
            rowIndex: row.rowIndex,
            payload: row.payload,
          })),
        });
      }

      await this.prisma.clinicmindsSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: ClinicmindsSyncStatus.SUCCEEDED,
          completedAt: new Date(),
          fetchedCount: items.length,
          storedCount: rawRows.length,
        },
      });

      if (requestLog) {
        await this.requestLogService.succeed(requestLog.id, JSON.stringify(result.data).length);
      }

      this.logger.log(
        `Synced ${entity.key}: fetched ${items.length}, stored ${rawRows.length}, request ${requestPath}`,
      );

      return {
        entityKey: entity.key,
        operationId: operation.operationId,
        requestPath,
        fetchedCount: items.length,
        storedCount: rawRows.length,
        syncRunId: String(syncRun.id),
        status: 'SUCCEEDED',
      };
    } catch (error) {
      await this.prisma.clinicmindsSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: ClinicmindsSyncStatus.FAILED,
          completedAt: new Date(),
          error: error instanceof Error ? error.message : 'Unknown sync error',
        },
      });

      if (requestLog) {
        await this.requestLogService.fail(requestLog.id, error);
      }

      throw error;
    }
  }

  private resolveOperation(entity: ClinicmindsEntitySyncConfig): ClinicmindsReportDefinition {
    const operation = this.clinicmindsClient
      .listEndpoints()
      .find((candidate) => candidate.path === entity.endpoint);

    if (!operation) {
      throw new BadRequestException(
        `No Clinicminds operation from the OpenAPI spec matches endpoint "${entity.endpoint}" for entity "${entity.key}".`,
      );
    }

    return operation;
  }

  private async buildSyncPlan(
    entity: ClinicmindsEntitySyncConfig,
    overrides: Record<string, ClinicmindsSyncPrimitive | undefined>,
  ): Promise<{
    params: Record<string, ClinicmindsSyncPrimitive>;
    skipReason?: string;
  }> {
    const today = new Date();
    const defaultParams: Record<string, ClinicmindsSyncPrimitive | null | undefined> = {
      ...(entity.staticParams ?? {}),
    };

    if (
      entity.readStrategy === 'date_window' ||
      entity.readStrategy === 'dual_date_window'
    ) {
      const windowSize = Math.max(entity.rangeWindowSize ?? 1, 1);
      const to = this.formatDate(today);
      const from = this.formatDate(this.addDays(today, -(windowSize - 1)));

      if (entity.rangeFromParam && entity.rangeToParam) {
        defaultParams[entity.rangeFromParam] = from;
        defaultParams[entity.rangeToParam] = to;
      }

      if (
        entity.readStrategy === 'dual_date_window' &&
        entity.secondaryRangeFromParam &&
        entity.secondaryRangeToParam
      ) {
        defaultParams[entity.secondaryRangeFromParam] = from;
        defaultParams[entity.secondaryRangeToParam] = to;
      }
    }

    if (
      entity.readStrategy === 'booking_gap_window' &&
      entity.secondaryRangeFromParam &&
      entity.secondaryRangeToParam
    ) {
      const hasFromOverride = overrides[entity.secondaryRangeFromParam] !== undefined;
      const hasToOverride = overrides[entity.secondaryRangeToParam] !== undefined;

      if (hasFromOverride !== hasToOverride) {
        throw new BadRequestException(
          `Both ${entity.secondaryRangeFromParam} and ${entity.secondaryRangeToParam} must be provided together.`,
        );
      }

      if (!hasFromOverride && !hasToOverride) {
        const startDate = await this.resolveBookingGapStartDate(entity);
        const endDate = this.formatDate(this.addDays(today, -1));

        if (startDate > endDate) {
          return {
            params: {},
            skipReason: `Skipping ${entity.key} sync because there are no booking dates left before today.`,
          };
        }

        // Appointment sync follows booking date only. The last successful date2_to becomes the next cursor.
        defaultParams[entity.secondaryRangeFromParam] = startDate;
        defaultParams[entity.secondaryRangeToParam] = endDate;
      }
    }

    const allowedParams = entity.filtersFromSpec?.length
      ? new Set(entity.filtersFromSpec)
      : null;

    const params = Object.fromEntries(
      Object.entries({
        ...defaultParams,
        ...overrides,
      }).filter(
        ([key, value]) =>
          value !== undefined &&
          value !== null &&
          (!allowedParams || allowedParams.has(key)),
      ),
    ) as Record<string, ClinicmindsSyncPrimitive>;

    return { params };
  }

  private buildRequestPath(
    path: string,
    params: Record<string, ClinicmindsSyncPrimitive>,
    format: 'json' | 'csv' | 'scsv',
  ): string {
    const query = new URLSearchParams(
      Object.entries({ format, ...params }).map(([key, value]) => [key, String(value)]),
    ).toString();

    return query ? `${path}?${query}` : path;
  }

  private extractItems(data: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(data)) {
      return data.map((item) => this.asRecord(item));
    }

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.items)) {
        return record.items.map((item) => this.asRecord(item));
      }

      return [record];
    }

    return [{ value: data }];
  }

  private toRawRecord(
    entity: ClinicmindsEntitySyncConfig,
    item: Record<string, unknown>,
    rowIndex: number,
  ) {
    const externalId = entity.externalIdField
      ? this.toNullableString(item[entity.externalIdField])
      : null;

    return {
      entityKey: entity.key,
      externalId,
      rowIndex,
      payload: item as Prisma.InputJsonValue,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return { value };
  }

  private toNullableString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return String(value);
  }

  private async resolveBookingGapStartDate(
    entity: ClinicmindsEntitySyncConfig,
  ): Promise<string> {
    const startDate = entity.cursorStartDate ?? '2026-01-01';

    if (!entity.secondaryRangeToParam) {
      return startDate;
    }

    const lastRun = await this.prisma.clinicmindsSyncRun.findFirst({
      where: {
        entityKey: entity.key,
        status: ClinicmindsSyncStatus.SUCCEEDED,
      },
      orderBy: { startedAt: 'desc' },
      select: { requestParams: true },
    });

    const previousEndDate = this.extractStringParam(
      lastRun?.requestParams,
      entity.secondaryRangeToParam,
    );

    if (!previousEndDate) {
      return startDate;
    }

    return this.formatDate(this.addDays(previousEndDate, 1));
  }

  private extractStringParam(value: Prisma.JsonValue | undefined, key: string): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const candidate = (value as Record<string, unknown>)[key];
    return this.toNullableString(candidate);
  }

  private addDays(value: Date | string, days: number): Date {
    const date = typeof value === 'string'
      ? new Date(`${value}T00:00:00.000Z`)
      : new Date(value);

    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }

  private serializeBigIntValues<T>(value: T): T {
    if (typeof value === 'bigint') {
      return String(value) as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeBigIntValues(item)) as T;
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          this.serializeBigIntValues(item),
        ]),
      ) as T;
    }

    return value;
  }

  private formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
