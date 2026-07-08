import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ClinicmindsEntitySyncConfig } from './types/clinicminds-sync.types';

@Injectable()
export class ClinicmindsSyncConfigService {
  private readonly configPath = resolve(process.cwd(), 'config', 'entities.config.json');
  private readonly entities: ClinicmindsEntitySyncConfig[];
  private readonly entityMap: Map<string, ClinicmindsEntitySyncConfig>;

  constructor() {
    this.entities = JSON.parse(
      readFileSync(this.configPath, 'utf-8'),
    ) as ClinicmindsEntitySyncConfig[];
    this.entityMap = new Map(this.entities.map((entity) => [entity.key, entity]));
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
}
