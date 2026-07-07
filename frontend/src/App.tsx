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
import InboundLayout from './pages/inbound/InboundLayout';
import InboundLandingPage from './pages/inbound/InboundLandingPage';
import MrnTab from './pages/inbound/MrnTab';
import MrnDetailPage from './pages/inbound/MrnDetailPage';
import GoodsReceiveTab from './pages/inbound/GoodsReceiveTab';
import GoodsReceiveDetailPage from './pages/inbound/GoodsReceiveDetailPage';
import PutawayTab from './pages/inbound/PutawayTab';
import PutawayDetailPage from './pages/inbound/PutawayDetailPage';
import InventoryPage from './pages/inventory/InventoryPage';
import InventoryDetailPage from './pages/inventory/InventoryDetailPage';
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
import DeliveryDetailPage from './pages/outbound/DeliveryDetailPage';
import HistoryList from './pages/outbound/HistoryList';
import HistoryDetailPage from './pages/outbound/HistoryDetailPage';
import SalesOrderDetailPage from './pages/outbound/SalesOrderDetailPage';
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
          <Route path="inbound/pib" element={<InboundLayout />}>
            <Route index element={<Navigate to="mrn" replace />} />
            <Route
              path="mrn"
              element={
                <RequirePermission permission="mrn:read">
                  <MrnTab />
                </RequirePermission>
              }
            />
            <Route
              path="goods-receive"
              element={
                <RequirePermission permission="goods-receive:read">
                  <GoodsReceiveTab />
                </RequirePermission>
              }
            />
            <Route
              path="putaway"
              element={
                <RequirePermission permission="putaway:read">
                  <PutawayTab />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="putaway:read">
                  <PutawayTab history />
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
                  <GoodsReceiveDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="inbound/pib/putaway/:id"
              element={
                <RequirePermission permission="putaway:read">
                  <PutawayDetailPage />
                </RequirePermission>
              }
            />

          {/* Inventory Management */}
          <Route
            path="inventory"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/:id"
            element={
              <RequirePermission permission="inventory:read">
                <InventoryDetailPage />
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
                  <PickingList />
                </RequirePermission>
              }
            />
            <Route
              path="packing"
              element={
                <RequirePermission permission="packing:read">
                  <PackingList />
                </RequirePermission>
              }
            />
            <Route
              path="delivery"
              element={
                <RequirePermission permission="delivery:read">
                  <DeliveryList />
                </RequirePermission>
              }
            />
            <Route
              path="history"
              element={
                <RequirePermission permission="delivery:read">
                  <HistoryList />
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
            path="outbound/sales-order/history/:id"
            element={
              <RequirePermission permission="delivery:read">
                <HistoryDetailPage />
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
