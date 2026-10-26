import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * A create form's unsaved input, kept in this browser so a refresh or a failed
 * submit does not lose it. One entry per user, form and (optionally) sub-key —
 * e.g. one Sales Return draft per source delivery. The form drops it once the
 * document is created (call `clear`).
 *
 * Storage can be unavailable (private window, blocked site data), so every
 * access is guarded and the form simply works without a draft then.
 */
export interface StoredDraft<T> {
  savedAt: string;
  data: T;
}

const PREFIX = 'wms.draft.';
const SAVE_DELAY_MS = 400;

export function useFormDraft<T>(form: string) {
  const { user } = useAuth();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keyFor = useCallback(
    (sub?: string) => `${PREFIX}${user?.id ?? 'anon'}.${form}${sub ? `.${sub}` : ''}`,
    [form, user?.id],
  );

  const load = useCallback(
    (sub?: string): StoredDraft<T> | null => {
      try {
        const raw = localStorage.getItem(keyFor(sub));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredDraft<T>;
        return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed : null;
      } catch {
        return null;
      }
    },
    [keyFor],
  );

  /** Debounced: typing does not write on every keystroke. */
  const save = useCallback(
    (data: T, sub?: string) => {
      if (timer.current) clearTimeout(timer.current);
      const key = keyFor(sub);
      timer.current = setTimeout(() => {
        try {
          const entry: StoredDraft<T> = { savedAt: new Date().toISOString(), data };
          localStorage.setItem(key, JSON.stringify(entry));
        } catch {
          // Quota or blocked storage: the form keeps working, just unsaved.
        }
      }, SAVE_DELAY_MS);
    },
    [keyFor],
  );

  const clear = useCallback(
    (sub?: string) => {
      if (timer.current) clearTimeout(timer.current);
      try {
        localStorage.removeItem(keyFor(sub));
      } catch {
        // Nothing to do.
      }
    },
    [keyFor],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { load, save, clear };
}

/** "Oct 23, 2026, 4:20 PM" for the restored-draft banner. */
export function formatDraftTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
