import { Module } from '@nestjs/common';
import { MaterialsModule } from '../materials/materials.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CustomersModule } from '../customers/customers.module';
import { MrnModule } from '../mrn/mrn.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { OracleSyncScheduler } from './oracle-sync.scheduler';
import { SyncRunnerService } from './sync-runner.service';
import { SyncLogController } from './sync-log.controller';

// Background scheduler + sync log (failed/partial runs) with retry.
// Reuses each module's existing SyncService.
@Module({
  imports: [
    MaterialsModule,
    WarehousesModule,
    VendorsModule,
    CustomersModule,
    MrnModule,
    SalesOrdersModule,
  ],
  controllers: [SyncLogController],
  providers: [OracleSyncScheduler, SyncRunnerService],
})
export class OracleSyncModule {}
