import { formatDraftTime } from '../../hooks/useFormDraft';

/** Tells the user their unsaved input came back, with a way to start over. */
export default function DraftBanner({
  savedAt,
  onDiscard,
}: {
  savedAt: string;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800">
      <span className="flex items-center gap-2">
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M5.6 15A8 8 0 104.6 9" />
        </svg>
        Draft restored from <b className="font-semibold">{formatDraftTime(savedAt)}</b> — your
        unsaved input was kept.
      </span>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
        onClick={onDiscard}
      >
        Discard draft
      </button>
    </div>
  );
}
