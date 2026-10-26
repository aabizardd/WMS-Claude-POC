import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { activeTab, findModule, visibleTabs } from './moduleTabs';

/** Lucide icons, as WMS dev puts on each sub tab. */
const ICONS: Record<string, ReactNode> = {
  // lucide layout-grid
  '/admin/warehouses': (
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </>
  ),
  '/admin/area-types': (
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </>
  ),
  // lucide layers
  '/admin/aisles': (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </>
  ),
  // lucide archive
  '/admin/shelves': (
    <>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  // lucide map-pin
  '/admin/bins': (
    <>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  // lucide folder-closed
  '/admin/material-categories': (
    <>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M2 10h20" />
    </>
  ),
  // lucide tags
  '/admin/material-types': (
    <>
      <path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z" />
      <path d="M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193" />
      <circle cx="10.5" cy="6.5" r=".5" fill="currentColor" />
    </>
  ),
  // lucide info
  '/admin/materials': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  // POC-only (Other Master) — lucide list, building-2, landmark, ruler
  '/admin/classes': (
    <>
      <path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13" />
    </>
  ),
  '/admin/departments': (
    <>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
    </>
  ),
  '/admin/subsidiaries': (
    <>
      <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7" />
      <path d="M12 2 20 7H4z" />
    </>
  ),
  '/admin/uoms': (
    <>
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2" />
    </>
  ),
};

/**
 * The card a Master Data list sits in, as on WMS dev: the group's title and
 * description, its sub tabs as icon pills (when it has any), then the list
 * itself — all inside one white card. Only a tab's own list pages get the
 * card; their add / edit pages render as they are.
 */
export default function ModuleFrame({ children }: { children: ReactNode }) {
  const { has } = useAuth();
  const { pathname } = useLocation();
  const module = findModule(pathname);
  const tabs = module ? visibleTabs(module.tabs, has) : [];
  const parent = module ? activeTab({ ...module, tabs }, pathname) : null;
  const subtabs = parent?.subtabs ?? [];
  const listPaths = subtabs.length > 0 ? subtabs.map((t) => t.to) : parent ? [parent.to] : [];
  if (!parent?.description || !listPaths.includes(pathname)) return <>{children}</>;
  const current = module ? activeTab({ ...module, tabs: subtabs }, pathname) : null;

  return (
    <div className="mt-2 space-y-5 rounded-xl bg-white p-5 shadow-md dark:bg-slate-800">
      <div className="print-hide mb-6 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div>
              <h1 className="text-[22px] font-semibold text-neutral-900 dark:text-white">{parent.label}</h1>
              <p className="mt-1 text-[13px] text-neutral-600 dark:text-slate-400">{parent.description}</p>
            </div>
          </div>
        </div>
      </div>
      {subtabs.length > 0 && (
        <div className="print-hide -mt-3">
          <nav className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-white p-1.5 ring-1 ring-neutral-200 dark:bg-slate-800 dark:ring-slate-700">
            {subtabs.map((t) => {
              const active = current?.to === t.to;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'border border-[#5166AE] bg-[#E1E4F8] text-[#5166AE] dark:border-[#8b9ad6] dark:bg-[#5166AE]/25 dark:text-[#c7cff0]'
                      : 'text-neutral-700 hover:bg-neutral-50 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {ICONS[t.to] && (
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {ICONS[t.to]}
                    </svg>
                  )}
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
      <div className="pt-1">{children}</div>
    </div>
  );
}
