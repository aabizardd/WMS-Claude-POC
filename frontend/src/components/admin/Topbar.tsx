import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWarehouse } from '../../context/WarehouseContext';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../context/I18nContext';
import SearchableSelect from '../SearchableSelect';
import { activeTab, findModule, visibleTabs } from './moduleTabs';

export default function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { has } = useAuth();
  const { pathname } = useLocation();
  const module = findModule(pathname);
  const tabs = visibleTabs(module?.tabs ?? [], has);
  const current = module ? activeTab({ ...module, tabs }, pathname) : null;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-stretch gap-2 border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:px-6">
      <button
        onClick={onMenuClick}
        className="my-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 lg:hidden"
        aria-label="Open menu"
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* The module's tabs, as on WMS dev's header bar. */}
      <nav className="-mb-px flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = current?.to === t.to;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`flex items-center whitespace-nowrap border-b-2 px-3 text-[15px] font-medium transition ${
                active
                  ? 'border-brand-600 text-brand-700 dark:text-brand-400'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="my-auto flex flex-shrink-0 items-center gap-1">
        <WarehouseSelector />
        <ThemeToggle />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { effective, setTheme } = useTheme();
  const isDark = effective === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {isDark ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.95 6.95l-1.41-1.41M7.46 7.46L6.05 6.05m11.9 0l-1.41 1.41M7.46 16.54l-1.41 1.41M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

function WarehouseSelector() {
  const { warehouses, activeWarehouseId, activeWarehouseName, canSwitch, setActiveWarehouse } =
    useWarehouse();
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-2">
      <svg className="hidden h-5 w-5 text-slate-400 xl:block" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 10l2-5h14l2 5M3 10v9a1 1 0 001 1h16a1 1 0 001-1v-9" />
      </svg>
      {canSwitch ? (
        <SearchableSelect
          className="w-36 sm:w-44 xl:w-52"
          value={activeWarehouseId ?? ''}
          onChange={setActiveWarehouse}
          options={[
            { value: '', label: t('topbar.allSites') },
            ...warehouses.map((w) => ({ value: w.id, label: w.name })),
          ]}
          placeholder={t('topbar.allSites')}
          searchPlaceholder={t('common.search')}
        />
      ) : (
        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {activeWarehouseName ?? '—'}
        </span>
      )}
    </div>
  );
}
