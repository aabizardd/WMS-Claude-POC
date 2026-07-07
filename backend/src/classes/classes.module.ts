import { Module } from '@nestjs/common';
import { ClassesService } from './classes.service';
import { ClassSyncService } from './class-sync.service';
import { ClassesController } from './classes.controller';

@Module({
  controllers: [ClassesController],
  providers: [ClassesService, ClassSyncService],
  exports: [ClassSyncService],
})
export class ClassesModule {}
