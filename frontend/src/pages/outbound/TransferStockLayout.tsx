import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface Tab {
  to: string;
  label: string;
  permission?: string;
}

// Same structure as Outbound from Sales Order, but the first tab is the
// Transfer Order list instead of the Sales Order list.
const TABS: Tab[] = [
  {
    to: '/admin/outbound/transfer-stock/list',
    label: 'Transfer Order',
    permission: 'transfer-orders:read',
  },
  { to: '/admin/outbound/transfer-stock/picking', label: 'Picking' },
  { to: '/admin/outbound/transfer-stock/packing', label: 'Packing' },
  { to: '/admin/outbound/transfer-stock/delivery', label: 'Delivery' },
  { to: '/admin/outbound/transfer-stock/history', label: 'History' },
];

export default function TransferStockLayout() {
  const { has } = useAuth();
  const tabs = TABS.filter((t) => !t.permission || has(t.permission));

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/outbound"
          className="mb-1 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Outbound
        </Link>
        <h1 className="page-title">Outbound from Transfer Stock</h1>
        <p className="page-subtitle">
          Transfer Order → Picking → Packing → Delivery → History.
        </p>
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
