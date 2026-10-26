import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker, getDefaultClassNames, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';

/**
 * Date-range picker (react-day-picker, styled with Tailwind), with an optional
 * time of day on each edge.
 *
 * The value is carried as one "from..to" string so it travels through the same
 * filter contract as every other column. Each side is "YYYY-MM-DD" or
 * "YYYY-MM-DDTHH:mm", and either side may be left empty for an open-ended
 * range ("2026-10-01.." or "..2026-10-20T17:00").
 */
export const RANGE_SEPARATOR = '..';

/** "YYYY-MM-DD" in local time — toISOString would shift the day in UTC+N. */
function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** One edge: the day, plus the time of day when the user set one. */
interface Edge {
  date?: Date;
  time: string;
}

function parseEdge(raw: string): Edge {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(raw.trim());
  if (!m) return { time: '' };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return { time: '' };
  return { date: d, time: m[4] !== undefined ? `${m[4]}:${m[5]}` : '' };
}

function edges(value: string): { from: Edge; to: Edge } {
  const [from = '', to = ''] = value.split(RANGE_SEPARATOR);
  return { from: parseEdge(from), to: parseEdge(to) };
}

/** The day-only view react-day-picker needs. */
export function parseRangeValue(value: string): DateRange | undefined {
  const { from, to } = edges(value);
  if (!from.date && !to.date) return undefined;
  return { from: from.date, to: to.date };
}

export function formatRangeValue(value: string): string {
  const { from, to } = edges(value);
  if (!from.date && !to.date) return value;
  const fmt = (e: Edge) =>
    e.date ? `${e.date.toLocaleDateString()}${e.time ? ` ${e.time}` : ''}` : '…';
  return `${fmt(from)} → ${fmt(to)}`;
}

/** Join one edge back into "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". */
function edgeToValue(e: Edge): string {
  if (!e.date) return '';
  return `${toISODate(e.date)}${e.time ? `T${e.time}` : ''}`;
}

/** Quick picks, counted back from today. */
const PRESETS: { label: string; days: number }[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export default function DateRangeInput({
  value,
  onChange,
  className = '',
}: {
  /** "from..to"; empty string means no range chosen. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const range = parseRangeValue(value);
  const { from: fromEdge, to: toEdge } = edges(value);

  function write(from: Edge, to: Edge) {
    const a = edgeToValue(from);
    const b = edgeToValue(to);
    onChange(a || b ? `${a}${RANGE_SEPARATOR}${b}` : '');
  }

  /** Picking days keeps whatever times were already set. */
  function commit(next: DateRange | undefined) {
    write(
      { date: next?.from, time: next?.from ? fromEdge.time : '' },
      { date: next?.to, time: next?.to ? toEdge.time : '' },
    );
  }

  /** A time is only meaningful once that side has a day. */
  function setTime(edge: 'from' | 'to', time: string) {
    if (edge === 'from') write({ ...fromEdge, time }, toEdge);
    else write(fromEdge, { ...toEdge, time });
  }

  function pickPreset(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    // A preset means whole days, so any time already set is dropped.
    write({ date: from, time: '' }, { date: to, time: '' });
    setOpen(false);
  }

  // Positioned in a portal with the same approach as SearchableSelect, so the
  // calendar is never clipped by the table's overflow.
  function reposition() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left });
  }

  useEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onMove() {
      reposition();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const dp = getDefaultClassNames();

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={range ? 'truncate text-slate-800' : 'truncate text-slate-400'}>
          {range ? formatRangeValue(value) : 'Select a date range…'}
        </span>
        <svg
          className="h-4 w-4 flex-shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', top: rect.top, left: rect.left, zIndex: 200 }}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
          >
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  onClick={() => pickPreset(p.days)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <DayPicker
              mode="range"
              numberOfMonths={2}
              defaultMonth={range?.from}
              selected={range}
              onSelect={commit}
              classNames={{
                // Only the accents are overridden; the library's own stylesheet
                // handles layout.
                root: `${dp.root} text-sm`,
                today: 'font-semibold text-brand-700',
                selected: 'bg-brand-600 text-white',
                range_start: 'rounded-l-md bg-brand-600 text-white',
                range_end: 'rounded-r-md bg-brand-600 text-white',
                range_middle: 'bg-brand-50 text-brand-800',
                chevron: `${dp.chevron} fill-brand-600`,
              }}
            />

            {/* Optional time of day on each edge. */}
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-slate-100 pt-2">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">
                  Start time (optional)
                </span>
                <input
                  type="time"
                  className="input py-1 text-sm disabled:bg-slate-50"
                  value={fromEdge.time}
                  disabled={!fromEdge.date}
                  title={fromEdge.date ? undefined : 'Pick a start day first'}
                  onChange={(e) => setTime('from', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">
                  End time (optional)
                </span>
                <input
                  type="time"
                  className="input py-1 text-sm disabled:bg-slate-50"
                  value={toEdge.time}
                  disabled={!toEdge.date}
                  title={toEdge.date ? undefined : 'Pick an end day first'}
                  onChange={(e) => setTime('to', e.target.value)}
                />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Leave a time empty to cover the whole day — the start begins at 00:00 and
              the end runs to 23:59.
            </p>

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <span className="text-xs text-slate-400">
                {range ? formatRangeValue(value) : 'Pick a start and an end day'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
