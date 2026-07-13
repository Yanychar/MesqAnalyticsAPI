import { registerAs } from '@nestjs/config';

export interface AppExecutionConfig {
  enableRawSync: boolean;
  enableStageSync: boolean;
}

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
};

export const appExecutionConfig = registerAs(
  'execution',
  (): AppExecutionConfig => ({
    enableRawSync: toBoolean(process.env.APP_ENABLE_RAW_SYNC, true),
    enableStageSync: toBoolean(process.env.APP_ENABLE_STAGE_SYNC, true),
  }),
);
