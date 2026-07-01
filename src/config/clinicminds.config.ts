import { registerAs } from '@nestjs/config';

export interface ClinicmindsConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  defaultFormat: 'json' | 'csv' | 'scsv';
}

export const clinicmindsConfig = registerAs(
  'clinicminds',
  (): ClinicmindsConfig => ({
    apiKey: process.env.CLINICMINDS_API_TOKEN ?? '',
    baseUrl: process.env.CLINICMINDS_BASE_URL ?? 'https://app.clinicminds.com',
    timeoutMs: Number(process.env.CLINICMINDS_TIMEOUT_MS ?? 30000),
    defaultFormat:
      (process.env.CLINICMINDS_DEFAULT_FORMAT as ClinicmindsConfig['defaultFormat']) ??
      'json',
  }),
);
