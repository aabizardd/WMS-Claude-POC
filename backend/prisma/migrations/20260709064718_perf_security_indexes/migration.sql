-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "bins_warehouse_id_idx" ON "bins"("warehouse_id");

-- CreateIndex
CREATE INDEX "bins_aisle_id_idx" ON "bins"("aisle_id");

-- CreateIndex
CREATE INDEX "bins_shelf_id_idx" ON "bins"("shelf_id");

-- CreateIndex
CREATE INDEX "bins_area_type_id_idx" ON "bins"("area_type_id");

-- CreateIndex
CREATE INDEX "bins_bin_label_idx" ON "bins" USING GIN ("bin_label" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "classes_subsidiary_id_idx" ON "classes"("subsidiary_id");

-- CreateIndex
CREATE INDEX "classes_name_idx" ON "classes" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "complaints_user_id_idx" ON "complaints"("user_id");

-- CreateIndex
CREATE INDEX "complaints_warehouse_id_idx" ON "complaints"("warehouse_id");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "customers_company_name_idx" ON "customers" USING GIN ("company_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_entity_id_idx" ON "customers" USING GIN ("entity_id" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "deliveries_warehouse_id_idx" ON "deliveries"("warehouse_id");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE INDEX "delivery_items_delivery_id_idx" ON "delivery_items"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_items_material_id_idx" ON "delivery_items"("material_id");

-- CreateIndex
CREATE INDEX "delivery_items_bin_id_idx" ON "delivery_items"("bin_id");

-- CreateIndex
CREATE INDEX "departments_subsidiary_id_idx" ON "departments"("subsidiary_id");

-- CreateIndex
CREATE INDEX "departments_name_idx" ON "departments" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "discrepancies_warehouse_id_idx" ON "discrepancies"("warehouse_id");

-- CreateIndex
CREATE INDEX "discrepancies_picking_id_idx" ON "discrepancies"("picking_id");

-- CreateIndex
CREATE INDEX "discrepancies_gr_id_idx" ON "discrepancies"("gr_id");

-- CreateIndex
CREATE INDEX "goods_receives_warehouse_id_idx" ON "goods_receives"("warehouse_id");

-- CreateIndex
CREATE INDEX "goods_receives_status_idx" ON "goods_receives"("status");

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_adjustment_id_idx" ON "inventory_adjustment_items"("adjustment_id");

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_material_id_idx" ON "inventory_adjustment_items"("material_id");

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_bin_id_idx" ON "inventory_adjustment_items"("bin_id");

-- CreateIndex
CREATE INDEX "inventory_adjustments_warehouse_id_idx" ON "inventory_adjustments"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_adjustments_status_idx" ON "inventory_adjustments"("status");

-- CreateIndex
CREATE INDEX "inventory_adjustments_class_id_idx" ON "inventory_adjustments"("class_id");

-- CreateIndex
CREATE INDEX "inventory_bin_stocks_bin_id_idx" ON "inventory_bin_stocks"("bin_id");

-- CreateIndex
CREATE INDEX "inventory_management_warehouse_id_idx" ON "inventory_management"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_management_material_id_idx" ON "inventory_management"("material_id");

-- CreateIndex
CREATE INDEX "materials_material_category_id_idx" ON "materials"("material_category_id");

-- CreateIndex
CREATE INDEX "materials_material_type_id_idx" ON "materials"("material_type_id");

-- CreateIndex
CREATE INDEX "materials_primary_uom_id_idx" ON "materials"("primary_uom_id");

-- CreateIndex
CREATE INDEX "materials_material_name_idx" ON "materials" USING GIN ("material_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "materials_material_code_idx" ON "materials" USING GIN ("material_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "mrn_items_mrn_id_idx" ON "mrn_items"("mrn_id");

-- CreateIndex
CREATE INDEX "mrn_items_bin_id_idx" ON "mrn_items"("bin_id");

-- CreateIndex
CREATE INDEX "mrns_warehouse_id_idx" ON "mrns"("warehouse_id");

-- CreateIndex
CREATE INDEX "mrns_status_idx" ON "mrns"("status");

-- CreateIndex
CREATE INDEX "packing_items_packing_id_idx" ON "packing_items"("packing_id");

-- CreateIndex
CREATE INDEX "packing_items_material_id_idx" ON "packing_items"("material_id");

-- CreateIndex
CREATE INDEX "packing_items_bin_id_idx" ON "packing_items"("bin_id");

-- CreateIndex
CREATE INDEX "packings_warehouse_id_idx" ON "packings"("warehouse_id");

-- CreateIndex
CREATE INDEX "packings_status_idx" ON "packings"("status");

-- CreateIndex
CREATE INDEX "picking_items_picking_id_idx" ON "picking_items"("picking_id");

-- CreateIndex
CREATE INDEX "picking_items_material_id_idx" ON "picking_items"("material_id");

-- CreateIndex
CREATE INDEX "picking_items_bin_id_idx" ON "picking_items"("bin_id");

-- CreateIndex
CREATE INDEX "pickings_sales_order_id_idx" ON "pickings"("sales_order_id");

-- CreateIndex
CREATE INDEX "pickings_warehouse_id_idx" ON "pickings"("warehouse_id");

-- CreateIndex
CREATE INDEX "pickings_status_idx" ON "pickings"("status");

-- CreateIndex
CREATE INDEX "putaway_items_putaway_id_idx" ON "putaway_items"("putaway_id");

-- CreateIndex
CREATE INDEX "putaway_items_bin_id_idx" ON "putaway_items"("bin_id");

-- CreateIndex
CREATE INDEX "putaways_warehouse_id_idx" ON "putaways"("warehouse_id");

-- CreateIndex
CREATE INDEX "putaways_status_idx" ON "putaways"("status");

-- CreateIndex
CREATE INDEX "putaways_gr_id_idx" ON "putaways"("gr_id");

-- CreateIndex
CREATE INDEX "r_discrepancy_detail_discrepancy_id_idx" ON "r_discrepancy_detail"("discrepancy_id");

-- CreateIndex
CREATE INDEX "sales_order_items_material_id_idx" ON "sales_order_items"("material_id");

-- CreateIndex
CREATE INDEX "sales_orders_warehouse_id_idx" ON "sales_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "sales_orders_subsidiary_id_idx" ON "sales_orders"("subsidiary_id");

-- CreateIndex
CREATE INDEX "users_warehouse_id_idx" ON "users"("warehouse_id");

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE INDEX "vendors_subsidiary_id_idx" ON "vendors"("subsidiary_id");

-- CreateIndex
CREATE INDEX "vendors_company_name_idx" ON "vendors" USING GIN ("company_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vendors_entity_id_idx" ON "vendors" USING GIN ("entity_id" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "warehouses_subsidiary_id_idx" ON "warehouses"("subsidiary_id");

-- CreateIndex
CREATE INDEX "warehouses_parent_id_idx" ON "warehouses"("parent_id");
