import { Module } from '@nestjs/common';
import { MaterialsModule } from '../materials/materials.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CustomersModule } from '../customers/customers.module';
import { MrnModule } from '../mrn/mrn.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { OracleSyncScheduler } from './oracle-sync.scheduler';

// Background scheduler that periodically triggers an incremental Oracle sync
// for every mirrored module. Reuses each module's existing SyncService.
@Module({
  imports: [
    MaterialsModule,
    WarehousesModule,
    VendorsModule,
    CustomersModule,
    MrnModule,
    SalesOrdersModule,
  ],
  providers: [OracleSyncScheduler],
})
export class OracleSyncModule {}
