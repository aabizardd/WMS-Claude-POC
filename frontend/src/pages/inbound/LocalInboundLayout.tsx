import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface Tab {
  to: string;
  label: string;
  permission?: string;
}

// Same structure as Inbound from PIB, but the first tab is PO (Purchase Order)
// instead of MRN.
const TABS: Tab[] = [
  { to: '/admin/inbound/local/po', label: 'PO', permission: 'purchase-orders:read' },
  {
    to: '/admin/inbound/local/goods-receive',
    label: 'Goods Receive',
    permission: 'goods-receive:read',
  },
  { to: '/admin/inbound/local/putaway', label: 'Putaway', permission: 'putaway:read' },
  { to: '/admin/inbound/local/history', label: 'History' },
];

export default function LocalInboundLayout() {
  const { has } = useAuth();
  const tabs = TABS.filter((t) => !t.permission || has(t.permission));

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/admin/inbound"
          className="mb-1 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Inbound
        </Link>
        <h1 className="page-title">Inbound from Local Vendor</h1>
        <p className="page-subtitle">
          PO → Goods Receive → Putaway → History.
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
