import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * Text input that collects several values as chips. Enter (or comma) commits
 * what is typed; Backspace on an empty box removes the last chip.
 *
 * Pasting a list turns it into chips: a column copied from a spreadsheet or a
 * text file arrives separated by line breaks (or commas/tabs), and each entry
 * becomes its own value.
 *
 * Values inside one field are OR-ed by the server, so "A" + "B" means A or B.
 */
/** Line breaks, commas and tabs all separate one pasted value from the next. */
const SEPARATORS = /[\r\n,\t]+/;
export default function MultiValueInput({
  values,
  onChange,
  placeholder,
  max = 10,
  className = '',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const full = values.length >= max;

  function commit(raw: string) {
    // "a, b, c" or a pasted column of lines becomes one chip per entry.
    const parts = raw
      .split(SEPARATORS)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft('');
  }

  /**
   * Handled here rather than left to the browser: a single-line input mangles
   * pasted line breaks (joining or dropping them), so the list would arrive as
   * one run-on value.
   */
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!SEPARATORS.test(text)) return; // a plain word: let the user keep typing
    e.preventDefault();
    // Whatever was already half-typed stays in front of the pasted list.
    commit(`${draft}${draft ? ',' : ''}${text}`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter must not submit the surrounding filter form mid-typing.
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div
      // The focus ring on .input follows the container, but focus actually sits
      // on the inner box — focus-within puts the ring back where it belongs.
      className={`input flex min-h-[2.5rem] flex-wrap items-center gap-1.5 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200 ${className}`}
    >
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700"
        >
          {v}
          <button
            type="button"
            className="text-brand-400 hover:text-brand-700"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-slate-400 focus:ring-0"
        placeholder={full ? `Max ${max} values` : (placeholder ?? 'Type and press Enter…')}
        value={draft}
        disabled={full}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        // A value left in the box still counts when the form is submitted.
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
