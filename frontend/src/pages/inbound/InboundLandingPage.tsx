import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface InboundType {
  key: string;
  title: string;
  description: string;
  accent: string;
  icon: ReactNode;
  to?: string; // set when the module is implemented
  enabled: boolean;
}

// Inbound types shown on the landing page. Add a type here (with `to` + a route
// in App.tsx) to enable it — no refactor of the existing modules required.
const INBOUND_TYPES: InboundType[] = [
  {
    key: 'pib',
    title: 'Inbound from PIB',
    description: 'Oracle PIB inbound shipments: MRN → Goods Receive → Putaway.',
    accent: 'bg-brand-600',
    icon: (
      <path d="M3 10h18M3 10l2-5h14l2 5M3 10v9a1 1 0 001 1h16a1 1 0 001-1v-9M9 14h6" />
    ),
    to: '/admin/inbound/pib',
    enabled: true,
  },
  {
    key: 'local-vendor',
    title: 'Inbound from Local Vendor',
    description: 'Purchase Orders from local vendors: PO → Goods Receive → Putaway.',
    accent: 'bg-emerald-600',
    icon: (
      <path d="M3 7h18M3 7l2-3h14l2 3M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7M9 11h6" />
    ),
    to: '/admin/inbound/local',
    enabled: true,
  },
  {
    key: 'customer-return',
    title: 'Inbound from Customer Return',
    description: 'Handle returns coming back from customers.',
    accent: 'bg-amber-500',
    icon: (
      <path d="M9 14l-4-4 4-4M5 10h10a4 4 0 014 4v3" />
    ),
    enabled: false,
  },
  {
    key: 'stock-transfer',
    title: 'Inbound from Stock Transfer',
    description: 'Receive stock transferred from another warehouse.',
    accent: 'bg-violet-600',
    icon: (
      <path d="M4 7h13l-3-3m3 3l-3 3M20 17H7l3 3m-3-3l3-3" />
    ),
    enabled: false,
  },
];

export default function InboundLandingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Inbound</h1>
        <p className="page-subtitle">
          Choose an inbound type to start. More types are coming soon.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INBOUND_TYPES.map((t) => (
          <InboundCard key={t.key} type={t} />
        ))}
      </div>
    </div>
  );
}

function InboundCard({ type }: { type: InboundType }) {
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
