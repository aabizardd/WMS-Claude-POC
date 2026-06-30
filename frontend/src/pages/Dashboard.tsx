import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { Role, User } from '../types';

export default function Dashboard() {
  const { user, has } = useAuth();
  const [userCount, setUserCount] = useState<number | null>(null);
  const [roleCount, setRoleCount] = useState<number | null>(null);

  // Only query what the user is allowed to read.
  useEffect(() => {
    if (has('users:read')) {
      api.get<User[]>('/users').then((r) => setUserCount(r.data.length));
    }
    if (has('roles:read')) {
      api.get<Role[]>('/roles').then((r) => setRoleCount(r.data.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = [
    has('users:read') && {
      label: 'Total Users',
      value: userCount,
      accent: 'bg-brand-600',
    },
    has('roles:read') && {
      label: 'Total Roles',
      value: roleCount,
      accent: 'bg-emerald-600',
    },
  ].filter(Boolean) as { label: string; value: number | null; accent: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">
          Welcome back, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Here is an overview of your WMS administration.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="card flex items-center gap-4 p-5">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl ${c.accent} text-white`}
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z"
                />
              </svg>
            </div>
            <div>
              <div className="text-sm text-slate-500">{c.label}</div>
              <div className="text-2xl font-semibold text-slate-800">
                {c.value ?? '—'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
