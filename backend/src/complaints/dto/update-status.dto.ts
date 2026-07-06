import { IsIn } from 'class-validator';

export class UpdateComplaintStatusDto {
  @IsIn(['Open', 'Solved'])
  status!: 'Open' | 'Solved';
}
