import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggingThrottlerGuard } from "./common/logging-throttler.guard";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RolesModule } from "./roles/roles.module";
import { UomsModule } from "./uoms/uoms.module";
import { MaterialCategoriesModule } from "./material-categories/material-categories.module";
import { MaterialTypesModule } from "./material-types/material-types.module";
import { MaterialsModule } from "./materials/materials.module";
import { WarehousesModule } from "./warehouses/warehouses.module";
import { AreaTypesModule } from "./area-types/area-types.module";
import { AislesModule } from "./aisles/aisles.module";
import { ShelvesModule } from "./shelves/shelves.module";
import { BinsModule } from "./bins/bins.module";
import { VendorsModule } from "./vendors/vendors.module";
import { ErpModule } from "./erp/erp.module";
import { CustomersModule } from "./customers/customers.module";
import { DepartmentsModule } from "./departments/departments.module";
import { ClassesModule } from "./classes/classes.module";
import { SubsidiariesModule } from "./subsidiaries/subsidiaries.module";
import { InventoryAdjustmentsModule } from "./inventory-adjustments/inventory-adjustments.module";
import { MrnModule } from "./mrn/mrn.module";
import { GoodsReceiveModule } from "./goods-receive/goods-receive.module";
import { InventoryModule } from "./inventory/inventory.module";
import { DiscrepancyModule } from "./discrepancy/discrepancy.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { PutawayModule } from "./putaway/putaway.module";
import { SalesOrdersModule } from "./sales-orders/sales-orders.module";
import { PickingModule } from "./picking/picking.module";
import { PackingModule } from "./packing/packing.module";
import { DeliveryModule } from "./delivery/delivery.module";
import { ComplaintsModule } from "./complaints/complaints.module";
import { OracleSyncModule } from "./sync/oracle-sync.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { PurchaseOrdersModule } from "./purchase-orders/purchase-orders.module";
import { TransferOrdersModule } from "./transfer-orders/transfer-orders.module";
import { HealthModule } from "./health/health.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "./auth/guards/permissions.guard";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limiting: default 100 requests / 60s per IP. Sensitive
    // endpoints (e.g. login) tighten this further with @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ErpModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    UomsModule,
    MaterialCategoriesModule,
    MaterialTypesModule,
    MaterialsModule,
    WarehousesModule,
    AreaTypesModule,
    AislesModule,
    ShelvesModule,
    BinsModule,
    VendorsModule,
    CustomersModule,
    DepartmentsModule,
    ClassesModule,
    SubsidiariesModule,
    MrnModule,
    GoodsReceiveModule,
    InventoryModule,
    InventoryAdjustmentsModule,
    DiscrepancyModule,
    PermissionsModule,
    PutawayModule,
    SalesOrdersModule,
    PickingModule,
    PackingModule,
    DeliveryModule,
    ComplaintsModule,
    PurchaseOrdersModule,
    TransferOrdersModule,
    OracleSyncModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // 0) Rate limit (runs first, before authentication) to blunt brute-force.
    //    Subclass logs 429s so abuse/spikes surface in the security logs.
    { provide: APP_GUARD, useClass: LoggingThrottlerGuard },
    // 1) Authenticate (JWT). Routes opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 2) Authorize (RBAC). Routes opt in with @RequirePermissions().
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
