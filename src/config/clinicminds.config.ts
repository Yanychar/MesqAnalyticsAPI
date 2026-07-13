import { registerAs } from '@nestjs/config';

export interface ClinicmindsConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  defaultFormat: 'json' | 'csv' | 'scsv';
  userAgent: string;
  locationId: number | null;
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
    userAgent:
      process.env.CLINICMINDS_USER_AGENT ??
      'AppointmentsHandler/1.0 (+serge.sevastianov@medfin.fi)',
    locationId: process.env.CLINICMINDS_LOCATION_ID
      ? Number(process.env.CLINICMINDS_LOCATION_ID)
      : null,
  }),
);
