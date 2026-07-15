import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWarehouse } from '../context/WarehouseContext';

function useCurrentDateTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  return `${formatted} • ${time} WIB`;
}

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
      {icon}
      {children}
    </span>
  );
}

function WelcomeCard() {
  const { user } = useAuth();
  const { activeWarehouseName } = useWarehouse();
  const dateTime = useCurrentDateTime();
  const firstName = user?.name?.split(' ')[0] ?? 'User';

  return (
    <div className="card relative overflow-hidden p-6 sm:p-8">
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl space-y-4">
          <h1 className="text-2xl font-bold text-slate-800 sm:text-3xl">
            Hello, {firstName}! 👋
          </h1>
          <p className="text-sm leading-relaxed text-slate-500">
            Welcome back to the Warehouse Management System. Manage, monitor,
            and optimize warehouse operations from a single platform.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              icon={
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              }
            >
              PT Indonesia Equipment Line
            </Badge>
            <Badge
              icon={
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4M3 7v10l9 4m-9-14l9 4m0 0l9-4m-9 4l9 4M3 17l9 4m-9-4v-2m9 2v2m0-6v6" />
                </svg>
              }
            >
              {activeWarehouseName ?? 'All Sites'}
            </Badge>
            <Badge
              icon={
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              }
            >
              {dateTime}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModuleCardProps {
  title: string;
  description: string;
  to: string;
  color: string;
  icon: React.ReactNode;
}

function ModuleCard({ title, description, to, color, icon }: ModuleCardProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="card group flex w-full flex-col gap-3 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${color} text-white`}
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
          {icon}
        </svg>
      </div>
      <div className="space-y-1">
        <div className="font-semibold text-slate-800">{title}</div>
        <div className="text-xs leading-relaxed text-slate-500">{description}</div>
      </div>
      <div className="mt-auto pt-1 text-xs font-medium text-brand-600 transition group-hover:text-brand-700">
        Open Module →
      </div>
    </button>
  );
}

const MODULES: ModuleCardProps[] = [
  {
    title: 'Inbound Management',
    description:
      'Manage incoming shipments, goods receiving, putaway activities, and inbound verification processes.',
    to: '/admin/inbound',
    color: 'bg-emerald-600',
    icon: (
      <>
        <path d="M3 10h18M3 10l2-5h14l2 5M3 10v9a1 1 0 001 1h16a1 1 0 001-1v-9M9 14h6" />
      </>
    ),
  },
  {
    title: 'Outbound Management',
    description:
      'Handle picking, packing, shipping, transfer orders, and outbound delivery activities.',
    to: '/admin/outbound',
    color: 'bg-brand-600',
    icon: (
      <>
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Inventory Management',
    description:
      'Monitor stock levels, warehouse bins, inventory movements, and inventory accuracy.',
    to: '/admin/inventory',
    color: 'bg-amber-500',
    icon: (
      <>
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10" />
      </>
    ),
  },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <WelcomeCard />

      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Quick Access</h2>
            <p className="text-xs text-slate-500">
              Access key warehouse management modules and frequently used functions.
            </p>
          </div>
        </div>

        <div className="h-px bg-slate-200" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <ModuleCard key={m.title} {...m} />
          ))}
        </div>
      </div>
    </div>
  );
}
