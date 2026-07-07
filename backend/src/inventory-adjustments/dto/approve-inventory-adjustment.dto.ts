import { IsIn, IsOptional, IsString } from 'class-validator';

export class ApproveInventoryAdjustmentDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  // Required for reject, optional for approve (validated in the service).
  @IsOptional()
  @IsString()
  reason?: string;
}
