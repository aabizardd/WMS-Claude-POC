import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface InventoryCard {
  key: string;
  title: string;
  description: string;
  to: string;
  permission: string;
  accent: string;
  icon: ReactNode;
}

const CARDS: InventoryCard[] = [
  {
    key: 'management',
    title: 'Inventory Management',
    description: 'Stock on hand per material and bin.',
    to: '/admin/inventory/list',
    permission: 'inventory:read',
    accent: 'bg-brand-600',
    icon: (
      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10" />
    ),
  },
  {
    key: 'discrepancy',
    title: 'Inventory Discrepancy',
    description: 'Quantity & quality discrepancies.',
    to: '/admin/discrepancy',
    permission: 'discrepancy:read',
    accent: 'bg-amber-500',
    icon: (
      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    ),
  },
  {
    key: 'adjustment',
    title: 'Inventory Adjustment',
    description: 'Manual qty / quality issue adjustments.',
    to: '/admin/inventory-adjustments',
    permission: 'inventory-adjustments:read',
    accent: 'bg-teal-600',
    icon: (
      <path d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    ),
  },
];

export default function InventoryLandingPage() {
  const { has } = useAuth();
  const cards = CARDS.filter((c) => has(c.permission));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Inventory</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose an inventory module.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          You don't have access to any inventory module.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <InvCard key={c.key} card={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function InvCard({ card }: { card: InventoryCard }) {
  const navigate = useNavigate();
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => navigate(card.to)}
        className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-slate-50"
      >
        <div
          className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${card.accent} text-white`}
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
            {card.icon}
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800">{card.title}</div>
          <div className="truncate text-xs text-slate-500">{card.description}</div>
          <div className="mt-1 text-xs font-medium text-slate-400">Open</div>
        </div>
        <svg
          className="h-5 w-5 flex-shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
