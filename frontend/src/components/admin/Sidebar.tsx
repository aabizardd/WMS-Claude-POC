import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../context/I18nContext';
import { INVENTORY_MATCH, MASTER_MATCH, underAny } from './moduleTabs';
import logoInline from '../../assets/logo-inline.png';

/**
 * The side bar, laid out like WMS dev: MAIN / MENU / MASTER / OTHERS sections,
 * Inbound and Outbound Management opening into their sources, and the signed-in
 * user with a sign-out button at the bottom.
 */
interface NavLeaf {
  to: string;
  label: string;
  icon?: ReactNode;
  /** Path prefixes that make the item active (default: `to`). */
  match?: string[];
  exact?: boolean;
  permission?: string;
  anyPermission?: string[];
  /** Shown but not clickable yet ("Coming soon"). */
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  icon: ReactNode;
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

interface NavSection {
  title: string;
  entries: NavEntry[];
}

const isGroup = (e: NavEntry): e is NavGroup => (e as NavGroup).children !== undefined;

const ICONS = {
  dashboard: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  inbound: (
    <path d="M12 3l3 3-3 3-3-3zM6 9l3 3-3 3-3-3zM18 9l3 3-3 3-3-3zM12 15l3 3-3 3-3-3z" />
  ),
  outbound: <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7M7.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />,
  inventory: <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m-8-14l8 4m-8-4v10l8 4m0-10v10" />,
  master: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 9a2 2 0 100-4 2 2 0 000 4zM10 19a2 2 0 100-4 2 2 0 000 4z" />,
  complaint: <path d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.6 7.14L4 20l.86-5.4A8 8 0 1121 12z" />,
  sync: <path d="M4 4v5h5M20 20v-5h-5M5 19a9 9 0 0014.13-3M19 5A9 9 0 004.87 8" />,
  settings: (
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  ),
  language: <path d="M4 5h8M8 3v2M5.5 5c.8 3 3 5.5 6 7M10.5 5c-.8 3-3 5.5-6 7M13 21l4-9 4 9M14.5 18h5" />,
};

const SECTIONS: NavSection[] = [
  {
    title: 'MAIN',
    entries: [{ to: '/admin', label: 'Dashboard', exact: true, icon: ICONS.dashboard }],
  },
  {
    title: 'MENU',
    entries: [
      {
        label: 'Inbound Management',
        icon: ICONS.inbound,
        children: [
          { to: '/admin/inbound/transfer', label: 'Transfer Order', anyPermission: ['transfer-orders:read', 'goods-receive:read'] },
          { to: '/admin/inbound/pib', label: 'PIB', anyPermission: ['mrn:read', 'goods-receive:read'] },
          { to: '/admin/inbound/local', label: 'Local Vendor (PO)', anyPermission: ['purchase-orders:read', 'goods-receive:read'] },
          { to: '/admin/inbound/customer-return', label: 'Customer Return', disabled: true },
        ],
      },
      {
        label: 'Outbound Management',
        icon: ICONS.outbound,
        children: [
          { to: '/admin/outbound/sales-order', label: 'Sales Order', permission: 'sales-orders:read' },
          { to: '/admin/outbound/transfer-stock', label: 'Transfer Order', permission: 'transfer-orders:read' },
        ],
      },
      {
        to: '/admin/inventory/list',
        label: 'Inventory Management',
        icon: ICONS.inventory,
        match: INVENTORY_MATCH,
        anyPermission: ['inventory:read', 'discrepancy:read', 'inventory-adjustments:read', 'sales-delivery:read'],
      },
    ],
  },
  {
    title: 'MASTER',
    entries: [
      {
        to: '/admin/users',
        label: 'Master Data',
        icon: ICONS.master,
        match: MASTER_MATCH,
        anyPermission: [
          'users:read',
          'roles:read',
          'subsidiaries:read',
          'warehouses:read',
          'materials:read',
          'material-categories:read',
          'material-types:read',
          'uoms:read',
          'vendors:read',
          'customers:read',
        ],
      },
    ],
  },
  {
    title: 'OTHERS',
    entries: [
      { to: '/admin/complaints', label: 'nav.complaint', icon: ICONS.complaint, permission: 'complaints:read' },
      { to: '/admin/sync-logs', label: 'nav.syncLogs', icon: ICONS.sync, permission: 'sync-logs:read' },
      { to: '/admin/settings', label: 'nav.settings', icon: ICONS.settings },
    ],
  },
];

const LANGUAGES = [
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'id', label: 'Indonesia', flag: '🇮🇩' },
  { value: 'zh', label: '中文', flag: '🇨🇳' },
] as const;

function visibleLeaf(l: NavLeaf, has: (p: string) => boolean) {
  if (l.permission && !has(l.permission)) return false;
  if (l.anyPermission && !l.anyPermission.some(has)) return false;
  return true;
}

function leafActive(l: NavLeaf, pathname: string) {
  return underAny(pathname, l.match ?? [l.to], l.exact);
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
  const { has, user, logout } = useAuth();
  const navigate = useNavigate();

  const sections = SECTIONS.map((s) => ({
    ...s,
    entries: s.entries.flatMap((e): NavEntry[] => {
      if (!isGroup(e)) return visibleLeaf(e, has) ? [e] : [];
      const children = e.children.filter((c) => c.disabled || visibleLeaf(c, has));
      return children.some((c) => !c.disabled) ? [{ ...e, children }] : [];
    }),
  })).filter((s) => s.entries.length);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex transform flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-700 dark:bg-slate-800 lg:translate-x-0 ${
          collapsed ? 'w-16' : 'w-64'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Brand */}
        <div
          className={`flex h-14 flex-shrink-0 items-center border-b border-slate-200 dark:border-slate-700 ${
            collapsed ? 'justify-center px-2' : 'gap-2 px-4'
          }`}
        >
          {/* As on WMS dev: "WMS", a divider, then "Powered by" over Inline's logo. */}
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <div className="text-xl font-semibold leading-tight text-[#5166AE] dark:text-[#aab6e8]">WMS</div>
              <div className="h-[32px] w-[1px] bg-[#E5E5E5] dark:bg-slate-600" />
              <div className="mt-1 flex flex-col items-start">
                <p className="mt-1 text-[5px] font-medium leading-normal text-[#BDBCBC]">Powered by</p>
                <img
                  src={logoInline}
                  alt="Inline Technology"
                  width={76}
                  height={43}
                  className="-mt-2 h-[43px] w-[76px] rounded-lg dark:bg-white"
                />
              </div>
            </div>
          )}
          <button
            onClick={onToggle}
            className={`hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200 lg:block ${
              collapsed ? '' : 'ml-auto'
            }`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              {collapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              )}
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {sections.map((s) => (
            <div key={s.title}>
              {!collapsed && (
                <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {s.title}
                </div>
              )}
              <div className="space-y-0.5">
                {s.entries.map((e) =>
                  isGroup(e) ? (
                    <GroupItem key={e.label} group={e} collapsed={collapsed} onExpand={onToggle} onNavigate={onClose} />
                  ) : (
                    <LeafItem key={e.to} leaf={e} collapsed={collapsed} onNavigate={onClose} />
                  ),
                )}
                {s.title === 'OTHERS' && <LanguageItem collapsed={collapsed} />}
              </div>
            </div>
          ))}
        </nav>

        {/* Signed-in user */}
        <div className="flex-shrink-0 border-t border-slate-200 p-3 dark:border-slate-700">
          <div className={`flex items-center gap-3 ${collapsed ? 'flex-col' : ''}`}>
            {/* Name and avatar open the signed-in user's own profile. */}
            <Link
              to="/admin/profile"
              onClick={onClose}
              title="My profile"
              className={`-m-1 flex min-w-0 items-center gap-3 rounded-lg p-1 transition hover:bg-slate-100 dark:hover:bg-slate-700 ${
                collapsed ? 'flex-col' : 'flex-1'
              }`}
            >
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              title={collapsed ? user?.name : undefined}
            >
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{user?.name}</div>
                <div className="truncate text-xs text-slate-500">{user?.email ?? user?.role}</div>
              </div>
            )}
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-rose-500/10"
              aria-label="Sign out"
              title="Sign out"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a1 1 0 011 1v16a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

const itemClass = (active: boolean, collapsed: boolean) =>
  `flex w-full items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition ${
    collapsed ? 'justify-center px-2' : 'px-3'
  } ${
    active
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400'
      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
  }`;

function LeafItem({ leaf, collapsed, onNavigate }: { leaf: NavLeaf; collapsed: boolean; onNavigate: () => void }) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const label = t(leaf.label);
  return (
    <Link
      to={leaf.to}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={itemClass(leafActive(leaf, pathname), collapsed)}
    >
      {leaf.icon && <Icon>{leaf.icon}</Icon>}
      {!collapsed && label}
    </Link>
  );
}

function GroupItem({
  group,
  collapsed,
  onExpand,
  onNavigate,
}: {
  group: NavGroup;
  collapsed: boolean;
  onExpand: () => void;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const active = group.children.some((c) => !c.disabled && leafActive(c, pathname));
  const [open, setOpen] = useState(active);

  // Collapsed: the icon only; clicking widens the side bar with the group open.
  if (collapsed) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          onExpand();
        }}
        title={group.label}
        className={itemClass(active, true)}
      >
        <Icon>{group.icon}</Icon>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${itemClass(false, false)} ${active && !open ? '!text-brand-700' : ''} ${open ? 'bg-slate-50 dark:bg-slate-700/40' : ''}`}
        aria-expanded={open}
      >
        <Icon>{group.icon}</Icon>
        <span className="flex-1 text-left">{group.label}</span>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-slate-600">
          {group.children.map((c) =>
            c.disabled ? (
              <div
                key={c.to}
                className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400"
                title="Coming soon"
              >
                {c.label}
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">Soon</span>
              </div>
            ) : (
              <Link
                key={c.to}
                to={c.to}
                onClick={onNavigate}
                className={`block rounded-lg px-3 py-2 text-sm transition ${
                  leafActive(c, pathname)
                    ? 'bg-brand-600 font-medium text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                }`}
              >
                {c.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function LanguageItem({ collapsed }: { collapsed: boolean }) {
  const { lang, setLang } = useI18n();
  const current = LANGUAGES.find((l) => l.value === lang) ?? LANGUAGES[0];
  if (collapsed) {
    return (
      <div className={itemClass(false, true)} title={`Language: ${current.label}`}>
        <Icon>{ICONS.language}</Icon>
      </div>
    );
  }
  return (
    <label className={`${itemClass(false, false)} cursor-pointer`}>
      <Icon>{ICONS.language}</Icon>
      <span className="text-slate-600 dark:text-slate-300">Language:</span>
      <select
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent font-semibold text-slate-800 outline-none dark:text-slate-100"
        value={current.value}
        onChange={(e) => setLang(e.target.value as (typeof LANGUAGES)[number]['value'])}
      >
        {LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label} {l.flag}
          </option>
        ))}
      </select>
      <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </label>
  );
}

function Icon({ children }: { children: ReactNode }) {
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
