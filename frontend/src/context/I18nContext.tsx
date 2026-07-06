import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { RESOURCES, type Lang } from '../i18n/resources';

const LANG_KEY = 'wms_lang';

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  // Translate a dotted key, e.g. t('nav.dashboard'). Falls back to the key.
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function lookup(lang: Lang, key: string): string | undefined {
  const [section, k] = key.split('.');
  return RESOURCES[lang]?.[section]?.[k];
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(LANG_KEY) as Lang | null;
    return stored === 'en' || stored === 'id' || stored === 'zh' ? stored : 'en';
  });

  const value = useMemo<I18nContextValue>(() => {
    function t(key: string, vars?: Record<string, string | number>) {
      let str = lookup(lang, key) ?? lookup('en', key) ?? key;
      if (vars) {
        for (const [n, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`{${n}}`, 'g'), String(v));
        }
      }
      return str;
    }
    function setLang(l: Lang) {
      localStorage.setItem(LANG_KEY, l);
      setLangState(l);
    }
    return { lang, setLang, t };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
