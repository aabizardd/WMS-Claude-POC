import { Module } from '@nestjs/common';
import { PutawayModule } from '../putaway/putaway.module';
import { TransferInboundController } from './transfer-inbound.controller';
import { TransferInboundService } from './transfer-inbound.service';

@Module({
  imports: [PutawayModule],
  controllers: [TransferInboundController],
  providers: [TransferInboundService],
})
export class TransferInboundModule {}
