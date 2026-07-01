import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class ClinicmindsRequestDto {
  @IsString()
  operationId!: string;

  @IsOptional()
  @IsIn(['json', 'csv', 'scsv'])
  format?: 'json' | 'csv' | 'scsv';

  @IsOptional()
  @IsObject()
  params?: Record<string, string | number | boolean>;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  saveLog?: boolean;
}

export class ClinicmindsRequestQueryDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['json', 'csv', 'scsv'])
  format?: 'json' | 'csv' | 'scsv';

  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Boolean)
  @IsBoolean()
  saveLog?: boolean;
}

