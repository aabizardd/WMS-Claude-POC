import { type ReactNode } from 'react';

// Reusable collapsible section: a header (with optional right-side content) that
// toggles the visibility of its children. Open state is controlled by the parent.
export default function Collapsible({
  title,
  subtitle,
  open,
  onToggle,
  right,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <svg
            className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-slate-700">{title}</span>
          {subtitle && (
            <span className="text-xs font-normal text-slate-400">{subtitle}</span>
          )}
        </button>
        {right}
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}
