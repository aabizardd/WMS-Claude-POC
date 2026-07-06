import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useWarehouse } from '../../context/WarehouseContext';

const COLLAPSE_KEY = 'wms_sidebar_collapsed';

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const { activeWarehouseId } = useWarehouse();

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />

      <div className={collapsed ? 'lg:pl-16' : 'lg:pl-64'}>
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
          {/* Remount page content when the active warehouse changes so all
              warehouse-scoped data re-fetches. */}
          <div key={activeWarehouseId ?? 'none'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
