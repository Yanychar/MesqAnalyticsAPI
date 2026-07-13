import { IsInt, IsOptional, Min } from 'class-validator';

export class ClinicmindsStageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
