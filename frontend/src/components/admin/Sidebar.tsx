import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../context/I18nContext';

interface NavLeaf {
  to: string;
  label: string;
  icon?: JSX.Element;
  end?: boolean;
  permission?: string; // required to see this item (omit = always visible)
  anyPermission?: string[]; // visible if the user holds ANY of these
}

interface NavGroup {
  label: string;
  icon?: JSX.Element;
  children: NavEntry[]; // children may themselves be groups (nested)
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(e: NavEntry): e is NavGroup {
  return (e as NavGroup).children !== undefined;
}

const nav: NavEntry[] = [
  {
    to: '/admin',
    label: 'nav.dashboard',
    end: true,
    icon: (
      <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
    ),
  },
  {
    to: '/admin/master-data',
    label: 'nav.masterData',
    icon: (
      <path d="M4 7c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3zM4 7v5c0 1.66 3.58 3 8 3s8-1.34 8-3V7M4 12v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5" />
    ),
    anyPermission: [
      'materials:read',
      'material-categories:read',
      'material-types:read',
      'uoms:read',
      'warehouses:read',
      'area-types:read',
      'aisles:read',
      'shelves:read',
      'bins:read',
      'vendors:read',
      'customers:read',
      'users:read',
      'roles:read',
    ],
  },
  {
    to: '/admin/inbound',
    label: 'nav.inbound',
    anyPermission: ['mrn:read', 'goods-receive:read'],
    icon: (
      <path d="M3 10h18M3 10l2-5h14l2 5M3 10v9a1 1 0 001 1h16a1 1 0 001-1v-9M9 14h6" />
    ),
  },
  {
    to: '/admin/outbound',
    label: 'nav.outbound',
    permission: 'sales-orders:read',
    icon: (
      <path d="M21 10h-18M21 10l-2-5H5L3 10m18 0v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-9M9 14h6" />
    ),
  },
  {
    // Landing page with Management / Discrepancy / Adjustment cards.
    to: '/admin/inventory',
    label: 'nav.inventory',
    anyPermission: [
      'inventory:read',
      'discrepancy:read',
      'inventory-adjustments:read',
    ],
    icon: (
      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10" />
    ),
  },
  {
    to: '/admin/complaints',
    label: 'nav.complaint',
    permission: 'complaints:read',
    icon: (
      <path d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.6 7.14L4 20l.86-5.4A8 8 0 1121 12z" />
    ),
  },
  {
    to: '/admin/sync-logs',
    label: 'nav.syncLogs',
    permission: 'sync-logs:read',
    icon: (
      <path d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />
    ),
  },
  {
    to: '/admin/settings',
    label: 'nav.settings',
    icon: (
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    ),
  },
];

// Remove entries the user can't see; drop groups that end up empty.
function filterEntry(entry: NavEntry, has: (p: string) => boolean): NavEntry | null {
  if (isGroup(entry)) {
    const children = entry.children
      .map((c) => filterEntry(c, has))
      .filter((c): c is NavEntry => c !== null);
    return children.length ? { ...entry, children } : null;
  }
  if (entry.permission && !has(entry.permission)) return null;
  if (entry.anyPermission && !entry.anyPermission.some(has)) return null;
  return entry;
}

function groupHasPath(group: NavGroup, pathname: string): boolean {
  return group.children.some((c) =>
    isGroup(c) ? groupHasPath(c, pathname) : pathname.startsWith(c.to),
  );
}

export default function Sidebar({
  open,
  onClose,
  collapsed,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 transform overflow-y-auto border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-700 dark:bg-slate-800 lg:translate-x-0 ${
          collapsed ? 'w-16' : 'w-64'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div
          className={`flex h-16 items-center border-b border-slate-200 dark:border-slate-700 ${
            collapsed ? 'justify-center px-2' : 'gap-2 px-4'
          }`}
        >
          {collapsed ? (
            // Collapsed: a single centered button to expand the sidebar again.
            <button
              onClick={onToggle}
              className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100 lg:block"
              aria-label="Expand sidebar"
              title="Expand"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11H3z" />
                  <rect x="8" y="13" width="8" height="7" rx="0.5" />
                </svg>
              </div>
              <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">WMS</span>
              <button
                onClick={onToggle}
                className="ml-auto hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200 lg:block"
                aria-label="Collapse sidebar"
                title="Collapse"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </>
          )}
        </div>

        <SidebarNav onClose={onClose} collapsed={collapsed} onExpand={onToggle} />
      </aside>
    </>
  );
}

function SidebarNav({
  onClose,
  collapsed,
  onExpand,
}: {
  onClose: () => void;
  collapsed: boolean;
  onExpand: () => void;
}) {
  const { has } = useAuth();
  const visible = nav
    .map((e) => filterEntry(e, has))
    .filter((e): e is NavEntry => e !== null);

  return (
    <nav className="space-y-1 p-3">
      {visible.map((entry) => (
        <NavNode
          key={isGroup(entry) ? entry.label : entry.to}
          entry={entry}
          level={0}
          onClose={onClose}
          collapsed={collapsed}
          onExpand={onExpand}
        />
      ))}
    </nav>
  );
}

interface NodeProps {
  entry: NavEntry;
  level: number;
  onClose: () => void;
  collapsed: boolean;
  onExpand: () => void;
}

function NavNode({ entry, ...rest }: NodeProps) {
  if (isGroup(entry)) {
    return <NavGroupNode group={entry} {...rest} />;
  }
  return <NavLeafNode leaf={entry} {...rest} />;
}

function NavGroupNode({
  group,
  level,
  onClose,
  collapsed,
  onExpand,
}: Omit<NodeProps, 'entry'> & { group: NavGroup }) {
  const location = useLocation();
  const { t } = useI18n();
  const active = groupHasPath(group, location.pathname);
  const [open, setOpen] = useState(active);

  // Collapsed: show the group icon only; clicking expands the sidebar.
  if (collapsed && level === 0) {
    return (
      <button
        onClick={onExpand}
        title={t(group.label)}
        className={`flex w-full items-center justify-center rounded-lg py-2.5 ${
          active ? 'text-brand-700' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
        }`}
      >
        {group.icon && <Icon>{group.icon}</Icon>}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          active ? 'text-brand-700 dark:text-brand-400' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
        }`}
        style={level > 0 ? { paddingLeft: `${0.75 + level * 0.75}rem` } : undefined}
      >
        {level === 0 && group.icon && <Icon>{group.icon}</Icon>}
        <span className="flex-1 text-left">{t(group.label)}</span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {group.children.map((c) => (
            <NavNode
              key={isGroup(c) ? c.label : c.to}
              entry={c}
              level={level + 1}
              onClose={onClose}
              collapsed={collapsed}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NavLeafNode({
  leaf,
  level,
  onClose,
  collapsed,
}: Omit<NodeProps, 'entry'> & { leaf: NavLeaf }) {
  const { t } = useI18n();
  return (
    <NavLink
      to={leaf.to}
      end={leaf.end}
      onClick={onClose}
      title={collapsed ? t(leaf.label) : undefined}
      style={!collapsed && level > 0 ? { paddingLeft: `${0.75 + level * 0.75}rem` } : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg py-2 text-sm transition ${
          collapsed ? 'justify-center px-2' : 'px-3 pr-3'
        } ${level === 0 ? 'font-medium' : ''} ${
          isActive
            ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-400'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
        }`
      }
    >
      {level === 0 && leaf.icon ? (
        <Icon>{leaf.icon}</Icon>
      ) : collapsed ? (
        <svg className="h-2 w-2" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg className="h-2 w-2 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
      {!collapsed && t(leaf.label)}
    </NavLink>
  );
}

function Icon({ children }: { children: JSX.Element }) {
  return (
    <svg
      className="h-5 w-5 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}
