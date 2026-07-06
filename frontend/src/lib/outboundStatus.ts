// Delivery status is stored as an enum (Open, ProgressPicking); shown spaced.
export function deliveryStatusLabel(status: string): string {
  const map: Record<string, string> = {
    Open: 'Open',
    ProgressPicking: 'Progress Picking',
  };
  return map[status] ?? status;
}

export function deliveryStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    Open: 'bg-slate-100 text-slate-600',
    ProgressPicking: 'bg-blue-50 text-blue-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-600';
}
