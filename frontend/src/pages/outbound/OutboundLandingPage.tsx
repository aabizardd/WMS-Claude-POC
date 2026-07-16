import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface OutboundType {
  key: string;
  title: string;
  description: string;
  accent: string;
  icon: ReactNode;
  to?: string; // set when the module is implemented
  enabled: boolean;
}

// Outbound types shown on the landing page. Add a type here (with `to` + a route
// in App.tsx) to enable it — no refactor of the existing modules required.
const OUTBOUND_TYPES: OutboundType[] = [
  {
    key: 'sales-order',
    title: 'Outbound from Sales Order',
    description: 'Fulfil sales orders: List → Picking → Packing → Delivery.',
    accent: 'bg-brand-600',
    icon: (
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    ),
    to: '/admin/outbound/sales-order',
    enabled: true,
  },
  {
    key: 'transfer-stock',
    title: 'Outbound from Transfer Stock',
    description: 'Transfer Order → Picking → Packing → Delivery to another warehouse.',
    accent: 'bg-violet-600',
    icon: (
      <path d="M4 7h13l-3-3m3 3l-3 3M20 17H7l3 3m-3-3l3-3" />
    ),
    to: '/admin/outbound/transfer-stock',
    enabled: true,
  },
];

export default function OutboundLandingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Outbound</h1>
        <p className="page-subtitle">
          Choose an outbound type to start. More types are coming soon.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OUTBOUND_TYPES.map((t) => (
          <OutboundCard key={t.key} type={t} />
        ))}
      </div>
    </div>
  );
}

function OutboundCard({ type }: { type: OutboundType }) {
  const navigate = useNavigate();
  const clickable = type.enabled && type.to;

  return (
    <button
      onClick={() => clickable && navigate(type.to!)}
      disabled={!clickable}
      className={`card flex w-full items-center gap-4 p-5 text-left transition ${
        clickable ? 'hover:-translate-y-0.5 hover:shadow-md' : 'cursor-not-allowed opacity-70'
      }`}
    >
      <div
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${type.accent} text-white`}
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
          {type.icon}
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">{type.title}</span>
          {!type.enabled && (
            <span className="badge bg-amber-100 text-amber-700">Coming Soon</span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{type.description}</div>
      </div>
      {clickable && (
        <svg
          className="h-5 w-5 flex-shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}
