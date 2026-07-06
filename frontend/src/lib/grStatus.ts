// Goods Receive status helpers. The backend stores the status as an enum
// (Open, Syncing, OnProgress, SyncFailed, Closed); the UI shows spaced labels.

export function grStatusLabel(status: string): string {
  const map: Record<string, string> = {
    OnProgress: 'On Progress',
    SyncFailed: 'Sync Failed',
  };
  return map[status] ?? status;
}

export function grStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    Open: 'bg-amber-50 text-amber-700',
    Syncing: 'bg-indigo-50 text-indigo-700',
    SyncFailed: 'bg-rose-50 text-rose-700',
    OnProgress: 'bg-blue-50 text-blue-700',
    Closed: 'bg-emerald-50 text-emerald-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}
