import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import RequirePermission from './components/RequirePermission';
import AdminLayout from './components/admin/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MasterDataPage from './pages/MasterDataPage';
import SettingsPage from './pages/settings/SettingsPage';
import SyncLogsPage from './pages/sync/SyncLogsPage';
import UsersPage from './pages/users/UsersPage';
import UserFormPage from './pages/users/UserFormPage';
import RolesPage from './pages/roles/RolesPage';
import RoleFormPage from './pages/roles/RoleFormPage';
import MaterialCategoriesPage from './pages/material/MaterialCategoriesPage';
import MaterialTypesPage from './pages/material/MaterialTypesPage';
import UomsPage from './pages/material/UomsPage';
import MaterialsPage from './pages/material/MaterialsPage';
import MaterialEditPage from './pages/material/MaterialEditPage';
import WarehousesPage from './pages/warehouse/WarehousesPage';
import AreaTypesPage from './pages/warehouse/AreaTypesPage';
import AislesPage from './pages/warehouse/AislesPage';
import ShelvesPage from './pages/warehouse/ShelvesPage';
import BinsPage from './pages/warehouse/BinsPage';
import BinFormPage from './pages/warehouse/BinFormPage';
import VendorsPage from './pages/vendor/VendorsPage';
import CustomersPage from './pages/customer/CustomersPage';
import DepartmentsPage from './pages/department/DepartmentsPage';
import ClassesPage from './pages/class/ClassesPage';
import SubsidiariesPage from './pages/subsidiary/SubsidiariesPage';
import OwnershipsPage from './pages/ownership/OwnershipsPage';
import ProfilePage from './pages/profile/ProfilePage';
import InboundLayout from './pages/inbound/InboundLayout';
import InboundLandingPage from './pages/inbound/InboundLandingPage';
import MrnDetailPage from './pages/inbound/MrnDetailPage';
import PibGrListPage from './pages/inbound/pib/PibGrListPage';
import PibGrDetailPage from './pages/inbound/pib/PibGrDetailPage';
import PibPutawayListPage from './pages/inbound/pib/PibPutawayListPage';
import PibPutawayDetailPage from './pages/inbound/pib/PibPutawayDetailPage';
import PibHistoryPage from './pages/inbound/pib/PibHistoryPage';
import LocalInboundLayout from './pages/inbound/LocalInboundLayout';
import PoRequestListPage from './pages/inbound/local/PoRequestListPage';
import PoDetailPage from './pages/inbound/local/PoDetailPage';
import { LOCAL_VENDOR } from './pages/inbound/transfer/inboundSource';
import TransferInboundLayout from './pages/inbound/TransferInboundLayout';
import TransferInDetailPage from './pages/inbound/TransferInDetailPage';
import TransferGrListPage from './pages/inbound/transfer/TransferGrListPage';
import TransferGrDetailPage from './pages/inbound/transfer/TransferGrDetailPage';
import TransferPutawayListPage from './pages/inbound/transfer/TransferPutawayListPage';
import TransferPutawayDetailPage from './pages/inbound/transfer/TransferPutawayDetailPage';
import TransferHistoryPage from './pages/inbound/transfer/TransferHistoryPage';
import InventoryLandingPage from './pages/inventory/InventoryLandingPage';
import InventoryPage from './pages/inventory/InventoryPage';
import InventoryQtySourcePage from './pages/inventory/InventoryQtySourcePage';
import InventoryQtyDocumentsPage from './pages/inventory/InventoryQtyDocumentsPage';
import InventoryDetailPage from './pages/inventory/InventoryDetailPage';
import SalesDeliveryListPage from './pages/sales-delivery/SalesDeliveryListPage';
import SalesDeliveryCreatePage from './pages/sales-delivery/SalesDeliveryCreatePage';
import SalesDeliveryDetailPage from './pages/sales-delivery/SalesDeliveryDetailPage';
import SalesDeliveryPrintPage from './pages/sales-delivery/SalesDeliveryPrintPage';
import SalesReturnCreatePage from './pages/sales-delivery/SalesReturnCreatePage';
import InventoryAdjustmentsPage from './pages/inventory-adjustment/InventoryAdjustmentsPage';
import InventoryAdjustmentCreatePage from './pages/inventory-adjustment/InventoryAdjustmentCreatePage';
import InventoryAdjustmentDetailPage from './pages/inventory-adjustment/InventoryAdjustmentDetailPage';
import DiscrepancyPage from './pages/discrepancy/DiscrepancyPage';
import DiscrepancyDetailPage from './pages/discrepancy/DiscrepancyDetailPage';
import OutboundLandingPage from './pages/outbound/OutboundLandingPage';
import OutboundLayout from './pages/outbound/OutboundLayout';
import SalesOrderList from './pages/outbound/SalesOrderList';
import PickingList from './pages/outbound/PickingList';
import PickingDetailPage from './pages/outbound/PickingDetailPage';
import PackingList from './pages/outbound/PackingList';
import PackingDetailPage from './pages/outbound/PackingDetailPage';
import DeliveryList from './pages/outbound/DeliveryList';
import DeliveryPrintPage from './pages/outbound/DeliveryPrintPage';
import DeliveryDetailPage from './pages/outbound/DeliveryDetailPage';
import HistoryList from './pages/outbound/HistoryList';
import SalesOrderDetailPage from './pages/outbound/SalesOrderDetailPage';
import SoTrackingRedirect from './pages/outbound/SoTrackingRedirect';
import TransferStockLayout from './pages/outbound/TransferStockLayout';
import TransferOrderTab from './pages/outbound/TransferOrderTab';
import TransferOrderDetailPage from './pages/outbound/TransferOrderDetailPage';
import ComplaintsPage from './pages/complaint/ComplaintsPage';
import ComplaintDetailPage from './pages/complaint/ComplaintDetailPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="master-data" element={<MasterDataPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* The signed-in user's own profile (no permission needed). */}
          <Route path="profile" element={<ProfilePage />} />
          <Route
            path="sync-logs"
            element={
              <RequirePermission permission="sync-logs:read">
                <SyncLogsPage />
              </RequirePermission>
            }
          />

          {/* User Management */}
          <Route
            path="users"
            element={
              <RequirePermission permission="users:read">
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route
            path="users/new"
            element={
              <RequirePermission permission="users:create">
                <UserFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="users/:id"
            element={
              <RequirePermission permission="users:read">
                <UserFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission permission="roles:read">
                <RolesPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles/new"
            element={
              <RequirePermission permission="roles:create">
                <RoleFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles/:id"
            element={
              <RequirePermission permission="roles:read">
                <RoleFormPage />
              </RequirePermission>
            }
          />

          {/* Material Management */}
          <Route
            path="materials"
            element={
              <RequirePermission permission="materials:read">
                <MaterialsPage />
              </RequirePermission>
            }
          />
          <Route
            path="materials/:id/edit"
            element={
              <RequirePermission permission="materials:read">
                <MaterialEditPage />
              </RequirePermission>
            }
          />
          <Route
            path="material-categories"
            element={
              <RequirePermission permission="material-categories:read">
                <MaterialCategoriesPage />
              </RequirePermission>
            }
          />
          <Route
            path="material-types"
            element={
              <RequirePermission permission="material-types:read">
                <MaterialTypesPage />
              </RequirePermission>
            }
          />
          <Route
            path="uoms"
            element={
              <RequirePermission permission="uoms:read">
                <UomsPage />
              </RequirePermission>
            }
          />

          {/* Warehouse Management */}
          <Route
            path="warehouses"
            element={
              <RequirePermission permission="warehouses:read">
                <WarehousesPage />
              </RequirePermission>
            }
          />
          <Route
            path="area-types"
            element={
              <RequirePermission permission="area-types:read">
                <AreaTypesPage />
              </RequirePermission>
            }
          />
          <Route
            path="aisles"
            element={
              <RequirePermission permission="aisles:read">
                <AislesPage />
              </RequirePermission>
            }
          />
          <Route
            path="shelves"
            element={
              <RequirePermission permission="shelves:read">
                <ShelvesPage />
              </RequirePermission>
            }
          />
          <Route
            path="bins"
            element={
              <RequirePermission permission="bins:read">
                <BinsPage />
              </RequirePermission>
            }
          />
          <Route
            path="bins/new"
            element={
              <RequirePermission permission="bins:create">
                <BinFormPage />
              </RequirePermission>
            }
          />
          <Route
            path="bins/:id"
            element={
              <RequirePermission permission="bins:read">
                <BinFormPage />
              </RequirePermission>
            }
          />

          {/* Ownership Setting: vendors and customers in one list */}
          <Route
            path="ownerships"
            element={
              <RequirePermission permission={['vendors:read', 'customers:read']}>
                <OwnershipsPage />
              </RequirePermission>
            }
          />

          {/* Vendor Management */}
          <Route
            path="vendors"
            element={
              <RequirePermission permission="vendors:read">
                <VendorsPage />
              </RequirePermission>
            }
          />

          {/* Customer Management */}
          <Route
            path="customers"
            element={
              <RequirePermission permission="customers:read">
                <CustomersPage />
              </RequirePermission>
            }
          />

          {/* Department Management */}
          <Route
            path="departments"
            element={
              <RequirePermission permission="departments:read">
                <DepartmentsPage />
              </RequirePermission>
            }
          />

          {/* Class Management */}
          <Route
            path="classes"
            element={
              <RequirePermission permission="classes:read">
                <ClassesPage />
              </RequirePermission>
            }
          />

          {/* Subsidiary Management */}
          <Route
            path="subsidiaries"
            element={
              <RequirePermission permission="subsidiaries:read">
                <SubsidiariesPage />
              </RequirePermission>
            }
          />

          {/* Inbound — landing page (type selection) */}
          <Route path="inbound" element={<InboundLandingPage />} />

          {/* Inbound from PIB (tabbed) */}
          {/* Inbound from PIB, as WMS dev lays it out: Goods Receive, Putaway, History. */}
          <Route path="inbound/pib" element={<InboundLayout />}>
            <Route index element={<Navigate to="goods-receive" replace />} />
            {/* The MRN tab is gone (WMS dev has none); old links land on Goods Receive. */}
            <Route path="mrn" element={<Navigate to="/admin/inbound/pib/goods-receive" replace />} />
            <Route
              path="goods-receive"
              element={
                <RequirePermission permission="goods-receive:read">
                  <PibGrListPage />
                </RequirePermission>
              }
            />
            <Route
              path="putaway"
              element={
                <RequirePermission permission="putaway:read">
                  <PibPutawayListPage />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="putaway:read">
                  <PibHistoryPage />
                </RequirePermission>
              }
            />
          </Route>
          <Route
            path="inbound/pib/mrn/:id"
            element={
              <RequirePermission permission="mrn:read">
                <MrnDetailPage />
              </RequirePermission>
            }
          />
            <Route
              path="inbound/pib/goods-receive/:id"
              element={
                <RequirePermission permission="goods-receive:read">
                  <PibGrDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="inbound/pib/putaway/:id"
              element={
                <RequirePermission permission="putaway:read">
                  <PibPutawayDetailPage />
                </RequirePermission>
              }
            />

          {/* Inbound from Local Vendor (tabbed) — as on WMS dev: Request (PO),
              Goods Receive, Putaway, History; the GR/Putaway/History pages
              are Transfer IN's, fed with the PO source. */}
          <Route path="inbound/local" element={<LocalInboundLayout />}>
            <Route index element={<Navigate to="po" replace />} />
            <Route
              path="po"
              element={
                <RequirePermission permission="purchase-orders:read">
                  <PoRequestListPage />
                </RequirePermission>
              }
            />
            <Route
              path="goods-receive"
              element={
                <RequirePermission permission="goods-receive:read">
                  <TransferGrListPage source={LOCAL_VENDOR} />
                </RequirePermission>
              }
            />
            <Route
              path="putaway"
              element={
                <RequirePermission permission="putaway:read">
                  <TransferPutawayListPage source={LOCAL_VENDOR} />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="putaway:read">
                  <TransferHistoryPage source={LOCAL_VENDOR} />
                </RequirePermission>
              }
            />
          </Route>
          <Route
            path="inbound/local/goods-receive/:id"
            element={
              <RequirePermission permission="goods-receive:read">
                <TransferGrDetailPage source={LOCAL_VENDOR} />
              </RequirePermission>
            }
          />
          <Route
            path="inbound/local/putaway/:id"
            element={
              <RequirePermission permission="putaway:read">
                <TransferPutawayDetailPage source={LOCAL_VENDOR} />
              </RequirePermission>
            }
          />
          {/* Inbound from Transfer Stock (tabbed) — source is a Transfer Order coming in. */}
          <Route path="inbound/transfer" element={<TransferInboundLayout />}>
            <Route index element={<Navigate to="to" replace />} />
            <Route
              path="to"
              element={
                <RequirePermission permission="transfer-orders:read">
                  <TransferOrderTab direction="in" />
                </RequirePermission>
              }
            />
            <Route
              path="goods-receive"
              element={
                <RequirePermission permission="goods-receive:read">
                  <TransferGrListPage />
                </RequirePermission>
              }
            />
            <Route
              path="putaway"
              element={
                <RequirePermission permission="putaway:read">
                  <TransferPutawayListPage />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="putaway:read">
                  <TransferHistoryPage />
                </RequirePermission>
              }
            />
          </Route>
          <Route
            path="inbound/transfer/to/:id"
            element={
              <RequirePermission permission="transfer-orders:read">
                <TransferInDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="inbound/transfer/goods-receive/:id"
            element={
              <RequirePermission permission="goods-receive:read">
                <TransferGrDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="inbound/transfer/putaway/:id"
            element={
              <RequirePermission permission="putaway:read">
                <TransferPutawayDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="inbound/local/po/:id"
            element={
              <RequirePermission permission="purchase-orders:read">
                <PoDetailPage />
              </RequirePermission>
            }
          />

          {/* Inventory — landing page (module selection) */}
          <Route path="inventory" element={<InventoryLandingPage />} />
          <Route
            path="inventory/list"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/list/:id"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryDetailPage />
              </RequirePermission>
            }
          />
          {/* Every SO / TO behind the list's total Reserved / In Transit cards. */}
          <Route
            path="inventory/reserved"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryQtyDocumentsPage key="reserved" type="reserved" />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/in-transit"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryQtyDocumentsPage key="in-transit" type="in-transit" />
              </RequirePermission>
            }
          />
          {/* The SO / TO documents behind a Reserved or In Transit quantity. */}
          <Route
            path="inventory/list/:id/:type"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryQtySourcePage />
              </RequirePermission>
            }
          />

          {/* Inventory Sales Delivery — MSO/VHS stock transfer */}
          <Route
            path="inventory/sales-delivery"
            element={
              <RequirePermission permission="sales-delivery:read">
                <SalesDeliveryListPage />
              </RequirePermission>
            }
          />
          {/* Tracking now lives on the list itself; keep old links working. */}
          <Route
            path="inventory/sales-delivery/tracking"
            element={<Navigate to="/admin/inventory/sales-delivery" replace />}
          />
          <Route
            path="inventory/sales-delivery/new"
            element={
              <RequirePermission permission="sales-delivery:create">
                <SalesDeliveryCreatePage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/sales-delivery/return/new"
            element={
              <RequirePermission permission="sales-delivery:create">
                <SalesReturnCreatePage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/sales-delivery/:id"
            element={
              <RequirePermission permission="sales-delivery:read">
                <SalesDeliveryDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/sales-delivery/:id/print"
            element={
              <RequirePermission permission="sales-delivery:read">
                <SalesDeliveryPrintPage />
              </RequirePermission>
            }
          />

          {/* Inventory Adjustment */}
          <Route
            path="inventory-adjustments"
            element={
              <RequirePermission permission="inventory-adjustments:read">
                <InventoryAdjustmentsPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory-adjustments/new"
            element={
              <RequirePermission permission="inventory-adjustments:create">
                <InventoryAdjustmentCreatePage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory-adjustments/:id"
            element={
              <RequirePermission permission="inventory-adjustments:read">
                <InventoryAdjustmentDetailPage />
              </RequirePermission>
            }
          />

          {/* Outbound — landing page (type selection) */}
          <Route path="outbound" element={<OutboundLandingPage />} />

          {/* SO Tracking now lives on the Sales Order list; keep old links working. */}
          <Route path="outbound/sales-order/tracking" element={<SoTrackingRedirect />} />
          {/* SD Tracking — opened in its own tab from the Delivery Plan list. */}
          <Route
            path="outbound/sales-order/delivery/tracking"
            // SD Tracking now lives on the Delivery Plan list; keep old links working.
            element={<Navigate to="/admin/outbound/sales-order/delivery" replace />}
          />

          {/* Outbound from Sales Order (tabbed) */}
          <Route path="outbound/sales-order" element={<OutboundLayout />}>
            <Route index element={<Navigate to="list" replace />} />
            <Route
              path="list"
              element={
                <RequirePermission permission="sales-orders:read">
                  <SalesOrderList />
                </RequirePermission>
              }
            />
            <Route
              path="picking"
              element={
                <RequirePermission permission="picking:read">
                  <PickingList source="SALES_ORDER" />
                </RequirePermission>
              }
            />
            <Route
              path="packing"
              element={
                <RequirePermission permission="packing:read">
                  <PackingList source="SALES_ORDER" />
                </RequirePermission>
              }
            />
            <Route
              path="delivery"
              element={
                <RequirePermission permission="delivery:read">
                  <DeliveryList source="SALES_ORDER" />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="delivery:read">
                  <HistoryList source="SALES_ORDER" />
                </RequirePermission>
              }
            />
          </Route>
          <Route
            path="outbound/sales-order/list/:id"
            element={
              <RequirePermission permission="sales-orders:read">
                <SalesOrderDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/sales-order/picking/:id"
            element={
              <RequirePermission permission="picking:read">
                <PickingDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/sales-order/packing/:id"
            element={
              <RequirePermission permission="packing:read">
                <PackingDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/sales-order/delivery/:id"
            element={
              <RequirePermission permission="delivery:read">
                <DeliveryDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/sales-order/delivery/:id/print"
            element={
              <RequirePermission permission="delivery:read">
                <DeliveryPrintPage basePath="/admin/outbound/sales-order" />
              </RequirePermission>
            }
          />

          {/* Outbound from Transfer Stock (tabbed) — source is Transfer Order */}
          <Route path="outbound/transfer-stock" element={<TransferStockLayout />}>
            <Route index element={<Navigate to="list" replace />} />
            <Route
              path="list"
              element={
                <RequirePermission permission="transfer-orders:read">
                  <TransferOrderTab />
                </RequirePermission>
              }
            />
            <Route
              path="picking"
              element={
                <RequirePermission permission="picking:read">
                  <PickingList
                    source="TRANSFER_ORDER"
                    basePath="/admin/outbound/transfer-stock"
                  />
                </RequirePermission>
              }
            />
            <Route
              path="packing"
              element={
                <RequirePermission permission="packing:read">
                  <PackingList
                    source="TRANSFER_ORDER"
                    basePath="/admin/outbound/transfer-stock"
                  />
                </RequirePermission>
              }
            />
            <Route
              path="delivery"
              element={
                <RequirePermission permission="delivery:read">
                  <DeliveryList
                    source="TRANSFER_ORDER"
                    basePath="/admin/outbound/transfer-stock"
                  />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="delivery:read">
                  <HistoryList
                    source="TRANSFER_ORDER"
                    basePath="/admin/outbound/transfer-stock"
                  />
                </RequirePermission>
              }
            />
          </Route>
          <Route
            path="outbound/transfer-stock/list/:id"
            element={
              <RequirePermission permission="transfer-orders:read">
                <TransferOrderDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/transfer-stock/picking/:id"
            element={
              <RequirePermission permission="picking:read">
                <PickingDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/transfer-stock/packing/:id"
            element={
              <RequirePermission permission="packing:read">
                <PackingDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/transfer-stock/delivery/:id"
            element={
              <RequirePermission permission="delivery:read">
                <DeliveryDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="outbound/transfer-stock/delivery/:id/print"
            element={
              <RequirePermission permission="delivery:read">
                <DeliveryPrintPage basePath="/admin/outbound/transfer-stock" />
              </RequirePermission>
            }
          />

          {/* Complaint */}
          <Route
            path="complaints"
            element={
              <RequirePermission permission="complaints:read">
                <ComplaintsPage />
              </RequirePermission>
            }
          />
          <Route
            path="complaints/:id"
            element={
              <RequirePermission permission="complaints:read">
                <ComplaintDetailPage />
              </RequirePermission>
            }
          />

          {/* Discrepancy */}
          <Route
            path="discrepancy"
            element={
              <RequirePermission permission="discrepancy:read">
                <DiscrepancyPage />
              </RequirePermission>
            }
          />
          <Route
            path="discrepancy/:id"
            element={
              <RequirePermission permission="discrepancy:read">
                <DiscrepancyDetailPage />
              </RequirePermission>
            }
          />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
