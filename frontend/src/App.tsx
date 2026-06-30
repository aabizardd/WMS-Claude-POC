import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import RequirePermission from './components/RequirePermission';
import AdminLayout from './components/admin/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MasterDataPage from './pages/MasterDataPage';
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
import InboundLayout, { InboundPlaceholder } from './pages/inbound/InboundLayout';
import MrnTab from './pages/inbound/MrnTab';
import MrnDetailPage from './pages/inbound/MrnDetailPage';
import GoodsReceiveTab from './pages/inbound/GoodsReceiveTab';
import GoodsReceiveDetailPage from './pages/inbound/GoodsReceiveDetailPage';
import InventoryPage from './pages/inventory/InventoryPage';
import InventoryDetailPage from './pages/inventory/InventoryDetailPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="master-data" element={<MasterDataPage />} />

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

          {/* Inbound (tabbed) */}
          <Route path="inbound" element={<InboundLayout />}>
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
              element={<InboundPlaceholder title="Putaway" />}
            />
            <Route
              path="history"
              element={<InboundPlaceholder title="History" />}
            />
          </Route>
          <Route
            path="inbound/mrn/:id"
            element={
              <RequirePermission permission="mrn:read">
                <MrnDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="inbound/goods-receive/:id"
            element={
              <RequirePermission permission="goods-receive:read">
                <GoodsReceiveDetailPage />
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
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
