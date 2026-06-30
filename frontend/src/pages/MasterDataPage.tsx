import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface MasterItem {
  to: string;
  label: string;
  description: string;
  permission: string;
}

interface MasterDomain {
  key: string;
  title: string;
  description: string;
  accent: string; // tailwind bg color for the icon tile
  icon: ReactNode;
  items: MasterItem[];
}

const DOMAINS: MasterDomain[] = [
  {
    key: 'material',
    title: 'Material',
    description: 'Materials and their classification masters.',
    accent: 'bg-brand-600',
    icon: (
      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    ),
    items: [
      {
        to: '/admin/materials',
        label: 'Material Info',
        description: 'Material catalog (ERP-synced).',
        permission: 'materials:read',
      },
      {
        to: '/admin/material-categories',
        label: 'Categories',
        description: 'Material categories.',
        permission: 'material-categories:read',
      },
      {
        to: '/admin/material-types',
        label: 'Types',
        description: 'Material types.',
        permission: 'material-types:read',
      },
      {
        to: '/admin/uoms',
        label: 'UOM',
        description: 'Units of measure.',
        permission: 'uoms:read',
      },
    ],
  },
  {
    key: 'warehouse',
    title: 'Warehouse',
    description: 'Warehouse structure and storage bins.',
    accent: 'bg-emerald-600',
    icon: (
      <path d="M3 21V8l9-5 9 5v13M3 21h18M9 21v-6h6v6M7 11h.01M12 11h.01M17 11h.01" />
    ),
    items: [
      {
        to: '/admin/warehouses',
        label: 'Warehouses',
        description: 'Warehouses (Oracle-synced).',
        permission: 'warehouses:read',
      },
      {
        to: '/admin/area-types',
        label: 'Area Types',
        description: 'Warehouse area types.',
        permission: 'area-types:read',
      },
      {
        to: '/admin/aisles',
        label: 'Aisles',
        description: 'Warehouse aisles.',
        permission: 'aisles:read',
      },
      {
        to: '/admin/shelves',
        label: 'Shelves',
        description: 'Warehouse shelves.',
        permission: 'shelves:read',
      },
      {
        to: '/admin/bins',
        label: 'Bins',
        description: 'Storage bins.',
        permission: 'bins:read',
      },
    ],
  },
  {
    key: 'vendor',
    title: 'Vendors',
    description: 'Vendors synced from Oracle.',
    accent: 'bg-amber-500',
    icon: (
      <path d="M3 7h18M3 7l2-3h14l2 3M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7M9 11h6" />
    ),
    items: [
      {
        to: '/admin/vendors',
        label: 'Vendors',
        description: 'Vendor master (read-only).',
        permission: 'vendors:read',
      },
    ],
  },
  {
    key: 'customer',
    title: 'Customers',
    description: 'Customers synced from Oracle.',
    accent: 'bg-violet-600',
    icon: (
      <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    ),
    items: [
      {
        to: '/admin/customers',
        label: 'Customers',
        description: 'Customer master (read-only).',
        permission: 'customers:read',
      },
    ],
  },
];

export default function MasterDataPage() {
  const { has } = useAuth();

  // Only show domains/items the user can access.
  const domains = DOMAINS.map((d) => ({
    ...d,
    items: d.items.filter((it) => has(it.permission)),
  })).filter((d) => d.items.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Master Data</h1>
        <p className="mt-1 text-sm text-slate-500">
          All master data collections. Cards with multiple items expand to show
          their sub-modules.
        </p>
      </div>

      {domains.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          You don't have access to any master data.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d) => (
            <MasterCard key={d.key} domain={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function MasterCard({ domain }: { domain: MasterDomain }) {
  const navigate = useNavigate();
  const single = domain.items.length === 1;
  const [open, setOpen] = useState(false);

  function handleHeaderClick() {
    if (single) navigate(domain.items[0].to);
    else setOpen((o) => !o);
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={handleHeaderClick}
        className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-slate-50"
      >
        <div
          className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${domain.accent} text-white`}
        >
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            {domain.icon}
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800">{domain.title}</div>
          <div className="truncate text-xs text-slate-500">
            {domain.description}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-400">
            {single ? 'Open' : `${domain.items.length} items`}
          </div>
        </div>
        {single ? (
          <svg
            className="h-5 w-5 flex-shrink-0 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <svg
            className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {!single && open && (
        <div className="border-t border-slate-100 p-2">
          {domain.items.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-slate-50"
            >
              <span className="flex h-2 w-2 flex-shrink-0 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-700">
                  {it.label}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {it.description}
                </span>
              </span>
              <svg
                className="h-4 w-4 flex-shrink-0 text-slate-300"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
