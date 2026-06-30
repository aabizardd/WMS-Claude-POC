import { Module } from '@nestjs/common';
import { GoodsReceiveService } from './goods-receive.service';
import { GoodsReceiveController } from './goods-receive.controller';

@Module({
  controllers: [GoodsReceiveController],
  providers: [GoodsReceiveService],
})
export class GoodsReceiveModule {}
