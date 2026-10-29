import { Module } from '@nestjs/common';
import { PutawayModule } from '../putaway/putaway.module';
import { PibInboundController } from './pib-inbound.controller';
import { PibInboundService } from './pib-inbound.service';

@Module({
  imports: [PutawayModule],
  controllers: [PibInboundController],
  providers: [PibInboundService],
})
export class PibInboundModule {}
