export type ClinicmindsSyncPrimitive = string | number | boolean;

export interface ClinicmindsEntitySyncConfig {
  key: string;
  label: string;
  endpoint: string;
  targetTable: string;
  cron?: string;
  mode?: string;
  externalIdField?: string;
  externalIdFields?: string[];
  readStrategy?: string;
  rangeFromParam?: string;
  rangeToParam?: string;
  rangeWindowUnit?: string;
  rangeWindowSize?: number;
  filtersFromSpec?: string[];
  notes?: string;
  enabled?: boolean;
  cursorStartDate?: string;
  staticParams?: Record<string, ClinicmindsSyncPrimitive | null | undefined>;
  rawTableIndexes?: string[][];
  normalizedIndexes?: string[][];
}

export interface ClinicmindsSyncEntityInput {
  format?: 'json' | 'csv' | 'scsv';
  params?: Record<string, ClinicmindsSyncPrimitive | undefined>;
  saveRequestLog?: boolean;
}

export interface ClinicmindsSyncBatchInput extends ClinicmindsSyncEntityInput {
  entityKeys?: string[];
  continueOnError?: boolean;
}

export interface ClinicmindsSyncEntityResult {
  entityKey: string;
  operationId: string;
  requestPath: string;
  fetchedCount: number;
  storedCount: number;
  syncRunId: string;
  status: 'SUCCEEDED' | 'FAILED';
  error?: string;
}
