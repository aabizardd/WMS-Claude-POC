import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const STYLES: Record<ToastType, { ring: string; icon: ReactNode }> = {
  success: {
    ring: 'border-emerald-200 bg-white',
    icon: (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    ),
  },
  error: {
    ring: 'border-rose-200 bg-white',
    icon: (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    ),
  },
  warning: {
    ring: 'border-amber-200 bg-white',
    icon: (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </span>
    ),
  },
  info: {
    ring: 'border-brand-200 bg-white',
    icon: (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </span>
    ),
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, type, message }]);
      setTimeout(() => remove(id), type === 'error' ? 7000 : 4000);
    },
    [remove],
  );

  const value: ToastContextValue = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    warning: (m) => show(m, 'warning'),
    info: (m) => show(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ring-1 ring-black/5 animate-[fadeIn_0.25s_ease-out] dark:bg-slate-800 dark:ring-white/10 ${STYLES[t.type].ring}`}
          >
            {STYLES[t.type].icon}
            <p className="flex-1 pt-0.5 text-sm text-slate-700 dark:text-slate-200">{t.message}</p>
            <button
              onClick={() => remove(t.id)}
              className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600"
              aria-label="Dismiss"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
