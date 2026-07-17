import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { AppExecutionConfig } from '../../config/app-execution.config';
import { ClinicmindsSyncConfigService } from './clinicminds-sync-config.service';
import { ClinicmindsSyncService } from './clinicminds-sync.service';
import { ClinicmindsEntitySyncConfig } from './types/clinicminds-sync.types';

@Injectable()
export class ClinicmindsCronService implements OnModuleInit {
  private readonly logger = new Logger(ClinicmindsCronService.name);
  private readonly runningEntityKeys = new Set<string>();
  private readonly timezone = process.env.TZ ?? 'Europe/Budapest';

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly syncConfigService: ClinicmindsSyncConfigService,
    private readonly syncService: ClinicmindsSyncService,
  ) {}

  onModuleInit() {
    const execution = this.configService.get<AppExecutionConfig>('execution');
    if (execution?.enableRawSync === false) {
      this.logger.log('Clinicminds raw cron runner is disabled by APP_ENABLE_RAW_SYNC=false.');
      return;
    }

    const cronEntities = this.syncConfigService
      .listEnabledEntities()
      .filter((entity) => entity.cron);

    if (cronEntities.length === 0) {
      this.logger.warn('No enabled Clinicminds entities with cron masks were found.');
      return;
    }

    for (const entity of cronEntities) {
      this.registerEntityCron(entity);
    }

    this.logger.log(
      `Registered ${cronEntities.length} Clinicminds cron job(s) in timezone ${this.timezone}.`,
    );
  }

  private registerEntityCron(entity: ClinicmindsEntitySyncConfig) {
    if (!entity.cron) {
      return;
    }

    const jobName = `clinicminds:${entity.key}`;
    const job = new CronJob(
      entity.cron,
      () => {
        void this.runScheduledEntity(entity);
      },
      null,
      false,
      this.timezone,
    );

    this.schedulerRegistry.addCronJob(jobName, job);
    job.start();

    this.logger.log(
      `Registered cron job ${jobName} with mask "${entity.cron}" for entity ${entity.key}.`,
    );
  }

  private async runScheduledEntity(entity: ClinicmindsEntitySyncConfig) {
    if (this.runningEntityKeys.has(entity.key)) {
      this.logger.warn(`Skipping scheduled sync for ${entity.key} because the previous run is still active.`);
      return;
    }

    this.runningEntityKeys.add(entity.key);

    try {
      this.logger.log(`Starting scheduled raw sync for ${entity.key}.`);
      const result = await this.syncService.runEntity(entity.key, {
        saveRequestLog: true,
      });

      this.logger.log(
        `Scheduled raw sync finished for ${entity.key}: fetched ${result.fetchedCount}, stored ${result.storedCount}, status ${result.status}.`,
      );

      if (result.stageTriggered) {
        this.logger.log(
          `Scheduled stage follow-up for ${entity.key}: ${result.stageStatus ?? 'unknown'}.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scheduled sync error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Scheduled raw sync failed for ${entity.key}: ${message}`, stack);
    } finally {
      this.runningEntityKeys.delete(entity.key);
    }
  }
}
