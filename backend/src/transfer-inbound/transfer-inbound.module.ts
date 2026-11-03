import { Module } from '@nestjs/common';
import { PutawayModule } from '../putaway/putaway.module';
import { CrInboundController, PoInboundController, TransferInboundController } from './transfer-inbound.controller';
import { TransferInboundService } from './transfer-inbound.service';

@Module({
  imports: [PutawayModule],
  controllers: [TransferInboundController, PoInboundController, CrInboundController],
  providers: [TransferInboundService],
})
export class TransferInboundModule {}
