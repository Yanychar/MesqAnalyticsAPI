import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClinicmindsConfig } from 'src/config/clinicminds.config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ClinicmindsEntitySyncConfig } from './types/clinicminds-sync.types';

interface ClinicmindsImportedFieldConfig {
  key: string;
  sourceColumn?: string;
}

interface ClinicmindsImportedEntityConfig {
  targetTable: string;
  fields?: ClinicmindsImportedFieldConfig[];
}

interface ClinicmindsExtractedFieldValue {
  order: number;
  key: string;
  sourceColumn?: string;
  value: unknown;
}

@Injectable()
export class ClinicmindsSyncConfigService {
  private readonly configPath = resolve(process.cwd(), 'config', 'entities.config.json');
  private readonly importedFieldsPath = resolve(process.cwd(), 'config', 'imported-fields.config.json');
  private readonly entities: ClinicmindsEntitySyncConfig[];
  private readonly entityMap: Map<string, ClinicmindsEntitySyncConfig>;
  private readonly importedConfig: Record<string, ClinicmindsImportedEntityConfig>;
  private readonly sourceColumnMap: Map<string, Map<string, string>>;

  constructor(private readonly configService: ConfigService) {
    this.entities = JSON.parse(
      readFileSync(this.configPath, 'utf-8'),
    ) as ClinicmindsEntitySyncConfig[];
    this.entityMap = new Map(this.entities.map((entity) => [entity.key, entity]));
    this.importedConfig = JSON.parse(
      readFileSync(this.importedFieldsPath, 'utf-8'),
    ) as Record<string, ClinicmindsImportedEntityConfig>;
    this.applyEnvironmentOverrides();
    this.sourceColumnMap = this.buildSourceColumnMap();
  }

  listEntities(): ClinicmindsEntitySyncConfig[] {
    return this.entities;
  }

  listEnabledEntities(): ClinicmindsEntitySyncConfig[] {
    return this.entities.filter((entity) => entity.enabled !== false);
  }

  getEntity(key: string): ClinicmindsEntitySyncConfig | undefined {
    return this.entityMap.get(key);
  }

  getSourceColumn(entityKey: string, fieldKey: string): string | undefined {
    return this.sourceColumnMap.get(entityKey)?.get(fieldKey);
  }

  getImportedFields(entityKey: string): ClinicmindsImportedFieldConfig[] {
    return this.importedConfig[entityKey]?.fields ?? [];
  }

  extractImportedFieldValues(
    entityKey: string,
    payload: Record<string, unknown>,
  ): ClinicmindsExtractedFieldValue[] {
    return this.getImportedFields(entityKey).map((field, index) => ({
      order: index + 1,
      key: field.key,
      sourceColumn: field.sourceColumn,
      value: field.sourceColumn ? payload[field.sourceColumn] : undefined,
    }));
  }

  normalizePayload(entityKey: string, payload: Record<string, unknown>): Record<string, unknown> {
    const fieldMap = this.sourceColumnMap.get(entityKey);
    if (!fieldMap) {
      return payload;
    }

    return Object.fromEntries(
      Array.from(fieldMap.entries()).map(([fieldKey, sourceColumn]) => [
        fieldKey,
        payload[sourceColumn],
      ]),
    );
  }

  private applyEnvironmentOverrides() {
    const clinicmindsConfig = this.configService.get<ClinicmindsConfig>('clinicminds');
    const configuredLocationId = clinicmindsConfig?.locationId;

    if (configuredLocationId === null || configuredLocationId === undefined || Number.isNaN(configuredLocationId)) {
      return;
    }

    for (const entity of this.entities) {
      if (!entity.filtersFromSpec?.includes('location_id')) {
        continue;
      }

      entity.staticParams = {
        ...(entity.staticParams ?? {}),
        location_id: configuredLocationId,
      };
    }
  }

  private buildSourceColumnMap(): Map<string, Map<string, string>> {
    return new Map(
      Object.entries(this.importedConfig).map(([entityKey, entityConfig]) => [
        entityKey,
        new Map(
          (entityConfig.fields ?? [])
            .filter((field) => field.sourceColumn)
            .map((field) => [field.key, field.sourceColumn as string]),
        ),
      ]),
    );
  }
}
