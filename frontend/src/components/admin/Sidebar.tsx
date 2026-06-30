import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

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
    label: 'Dashboard',
    end: true,
    icon: (
      <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" />
    ),
  },
  {
    to: '/admin/master-data',
    label: 'Master Data',
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
    ],
  },
  {
    to: '/admin/inbound',
    label: 'Inbound',
    anyPermission: ['mrn:read', 'goods-receive:read'],
    icon: (
      <path d="M3 10h18M3 10l2-5h14l2 5M3 10v9a1 1 0 001 1h16a1 1 0 001-1v-9M9 14h6" />
    ),
  },
  {
    to: '/admin/inventory',
    label: 'Inventory',
    permission: 'inventory:read',
    icon: (
      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10" />
    ),
  },
  {
    to: '/admin/discrepancy',
    label: 'Discrepancy',
    permission: 'discrepancy:read',
    icon: (
      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    ),
  },
  {
    label: 'User Management',
    icon: (
      <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" />
    ),
    children: [
      { to: '/admin/users', label: 'Users', permission: 'users:read' },
      { to: '/admin/roles', label: 'Roles', permission: 'roles:read' },
    ],
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
}: {
  open: boolean;
  onClose: () => void;
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
        className={`fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
            W
          </div>
          <span className="text-lg font-semibold text-slate-800">WMS</span>
        </div>

        <SidebarNav onClose={onClose} />
      </aside>
    </>
  );
}

function SidebarNav({ onClose }: { onClose: () => void }) {
  const { has } = useAuth();
  const visible = nav
    .map((e) => filterEntry(e, has))
    .filter((e): e is NavEntry => e !== null);

  return (
    <nav className="space-y-1 p-4">
      {visible.map((entry) => (
        <NavNode
          key={isGroup(entry) ? entry.label : entry.to}
          entry={entry}
          level={0}
          onClose={onClose}
        />
      ))}
    </nav>
  );
}

function NavNode({
  entry,
  level,
  onClose,
}: {
  entry: NavEntry;
  level: number;
  onClose: () => void;
}) {
  if (isGroup(entry)) {
    return <NavGroupNode group={entry} level={level} onClose={onClose} />;
  }
  return <NavLeafNode leaf={entry} level={level} onClose={onClose} />;
}

function NavGroupNode({
  group,
  level,
  onClose,
}: {
  group: NavGroup;
  level: number;
  onClose: () => void;
}) {
  const location = useLocation();
  const active = groupHasPath(group, location.pathname);
  const [open, setOpen] = useState(active);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition ${
          level === 0 ? 'px-3' : 'px-3'
        } ${
          active
            ? 'text-brand-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
        style={level > 0 ? { paddingLeft: `${0.75 + level * 0.75}rem` } : undefined}
      >
        {level === 0 && group.icon && <Icon>{group.icon}</Icon>}
        <span className="flex-1 text-left">{group.label}</span>
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
}: {
  leaf: NavLeaf;
  level: number;
  onClose: () => void;
}) {
  return (
    <NavLink
      to={leaf.to}
      end={leaf.end}
      onClick={onClose}
      style={level > 0 ? { paddingLeft: `${0.75 + level * 0.75}rem` } : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg py-2 pr-3 text-sm transition ${
          level === 0 ? 'px-3 font-medium' : ''
        } ${
          isActive
            ? 'bg-brand-50 font-medium text-brand-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      {level === 0 && leaf.icon ? (
        <Icon>{leaf.icon}</Icon>
      ) : (
        <svg className="h-2 w-2 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
      {leaf.label}
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
