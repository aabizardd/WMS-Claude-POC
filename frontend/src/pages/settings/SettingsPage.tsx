import { type ReactNode } from 'react';
import { useTheme, type ThemeMode } from '../../context/ThemeContext';
import { useI18n } from '../../context/I18nContext';
import { LANGUAGES, type Lang } from '../../i18n/resources';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { t, lang, setLang } = useI18n();

  const themeOptions: { value: ThemeMode; label: string; icon: ReactNode }[] = [
    {
      value: 'light',
      label: t('settings.light'),
      icon: <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.95 6.95l-1.41-1.41M7.46 7.46L6.05 6.05m11.9 0l-1.41 1.41M7.46 16.54l-1.41 1.41M16 12a4 4 0 11-8 0 4 4 0 018 0z" />,
    },
    {
      value: 'dark',
      label: t('settings.dark'),
      icon: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
    },
    {
      value: 'system',
      label: t('settings.system'),
      icon: <path d="M4 5h16v10H4zM2 19h20M9 19v-4m6 4v-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t('settings.title')}</h1>
        <p className="page-subtitle">{t('settings.subtitle')}</p>
      </div>

      {/* Appearance / Theme */}
      <Section title={t('settings.appearance')}>
        <div className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('settings.theme')}
        </div>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {t('settings.themeHint')}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {themeOptions.map((o) => {
            const active = theme === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setTheme(o.value)}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/10'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    {o.icon}
                  </svg>
                </span>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {o.label}
                </span>
                {active && (
                  <svg className="ml-auto h-5 w-5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Language */}
      <Section title={t('settings.language')}>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {t('settings.languageHint')}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {LANGUAGES.map((l) => {
            const active = lang === l.value;
            return (
              <button
                key={l.value}
                onClick={() => setLang(l.value as Lang)}
                className={`flex items-center justify-between rounded-xl border p-4 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/10'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40'
                }`}
              >
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {l.label}
                </span>
                {active && (
                  <svg className="h-5 w-5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </div>
  );
}
