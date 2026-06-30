import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface Tab {
  to: string;
  label: string;
  permission?: string;
}

const TABS: Tab[] = [
  { to: '/admin/inbound/mrn', label: 'MRN', permission: 'mrn:read' },
  {
    to: '/admin/inbound/goods-receive',
    label: 'Goods Receive',
    permission: 'goods-receive:read',
  },
  { to: '/admin/inbound/putaway', label: 'Putaway', permission: 'putaway:read' },
  { to: '/admin/inbound/history', label: 'History' },
];

export default function InboundLayout() {
  const { has } = useAuth();
  const tabs = TABS.filter((t) => !t.permission || has(t.permission));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Inbound</h1>
        <p className="mt-1 text-sm text-slate-500">
          MRN → Goods Receive → Putaway → History.
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

export function InboundPlaceholder({ title }: { title: string }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-lg font-medium text-slate-700">{title}</div>
      <p className="mt-1 text-sm text-slate-400">
        This step is coming soon.
      </p>
    </div>
  );
}
