import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ConfirmType = 'danger' | 'warning' | 'info' | 'success';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  type?: ConfirmType;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

const ICONS: Record<ConfirmType, { wrap: string; btn: string; svg: ReactNode }> = {
  danger: {
    wrap: 'bg-rose-100 text-rose-600',
    btn: 'bg-rose-600 hover:bg-rose-700',
    svg: <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />,
  },
  warning: {
    wrap: 'bg-amber-100 text-amber-600',
    btn: 'bg-amber-600 hover:bg-amber-700',
    svg: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />,
  },
  info: {
    wrap: 'bg-brand-100 text-brand-600',
    btn: 'bg-brand-600 hover:bg-brand-700',
    svg: <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  success: {
    wrap: 'bg-emerald-100 text-emerald-600',
    btn: 'bg-emerald-600 hover:bg-emerald-700',
    svg: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function close(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }

  const type = opts?.type ?? 'warning';
  const icon = ICONS[type];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => close(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800">
            <div className="flex gap-4">
              <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${icon.wrap}`}>
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  {icon.svg}
                </svg>
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  {opts.title}
                </h3>
                {opts.description && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{opts.description}</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => close(false)}>
                {opts.cancelText ?? 'Cancel'}
              </button>
              <button
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition ${icon.btn}`}
                onClick={() => close(true)}
              >
                {opts.confirmText ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
