import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class ClinicmindsSyncDto {
  @IsOptional()
  @IsIn(['json', 'csv', 'scsv'])
  format?: 'json' | 'csv' | 'scsv';

  @IsOptional()
  @IsObject()
  params?: Record<string, string | number | boolean>;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  saveRequestLog?: boolean;
}

export class ClinicmindsSyncBatchDto extends ClinicmindsSyncDto {
  @IsOptional()
  @IsString({ each: true })
  entityKeys?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  continueOnError?: boolean;
}
