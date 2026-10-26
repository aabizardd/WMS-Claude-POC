import { useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal';

export interface DocRef {
  id: string;
  code: string;
}

/**
 * Picking / Packing / SD ids of one row. A single id links straight to its
 * document; several show the first plus a "+N" badge that opens a list of all
 * of them, each linking to its own document.
 */
export default function DocRefsCell({
  refs,
  path,
  label,
  context,
}: {
  refs: DocRef[] | undefined;
  /** Detail route the ids live under, e.g. /admin/outbound/sales-order/picking. */
  path: string;
  /** What the ids are, e.g. "Picking ID" — the dialog's title. */
  label: string;
  /** The row they belong to (e.g. its Transaction ID), shown in the dialog. */
  context?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!refs?.length) return <>-</>;

  const first = refs[0];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Link to={`${path}/${first.id}`} className="font-medium text-brand-700 hover:underline">
        {first.code}
      </Link>
      {refs.length > 1 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
          title={`Show all ${refs.length} ${label}s`}
        >
          +{refs.length - 1}
        </button>
      )}
      <Modal open={open} title={`${label}s${context ? ` — ${context}` : ''}`} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {refs.length} {label}s. Click one to open its document.
          </p>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {refs.map((d, i) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                <span className="w-6 text-slate-400">{i + 1}</span>
                <Link
                  to={`${path}/${d.id}`}
                  className="font-medium text-brand-700 hover:underline"
                  onClick={() => setOpen(false)}
                >
                  {d.code}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    </span>
  );
}
