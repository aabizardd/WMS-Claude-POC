import { Outlet } from 'react-router-dom';

/**
 * Outbound from Sales Order. The module's tabs live in the header bar (see
 * components/admin/moduleTabs.ts), as on WMS dev; this only renders the page.
 */
export default function OutboundLayout() {
  return <Outlet />;
}

export function OutboundPlaceholder({ title }: { title: string }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-lg font-medium text-slate-700">{title}</div>
      <p className="mt-1 text-sm text-slate-400">This step is coming soon.</p>
    </div>
  );
}
