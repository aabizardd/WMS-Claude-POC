import { Module } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { PutawayController } from './putaway.controller';

@Module({
  controllers: [PutawayController],
  providers: [PutawayService],
})
export class PutawayModule {}
