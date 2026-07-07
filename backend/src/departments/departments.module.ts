import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentSyncService } from './department-sync.service';
import { DepartmentsController } from './departments.controller';

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService, DepartmentSyncService],
  exports: [DepartmentSyncService],
})
export class DepartmentsModule {}
