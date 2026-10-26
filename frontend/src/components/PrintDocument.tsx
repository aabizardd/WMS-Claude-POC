import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The printable document template shared by the Inventory Sales (SD / SR) and
 * Delivery Plan (SO / TO) print-outs, laid out after the Oracle original: a
 * bilingual (English / Chinese) header, detail tables, the material list and
 * signature boxes. Printing is the browser's own — the page styles itself for
 * A4 landscape and hides everything that is not part of the document.
 *
 * Empty values print as blank cells, never as a dash.
 */

/** "YYYY-MM-DD HH:mm" in local time, matching the original; blank when unknown. */
export function stamp(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Label with its Chinese counterpart underneath, as on the original. */
export function PrintTh({ en, zh }: { en: string; zh: string }) {
  return (
    <th className="border border-slate-400 px-2 py-1 text-left align-top">
      <div className="text-[11px] font-semibold leading-tight text-slate-900">{en}</div>
      <div className="text-[9px] leading-tight text-slate-500">{zh}</div>
    </th>
  );
}

/** A bordered cell; null and undefined print as nothing. */
export function PrintTd({
  children,
  className = '',
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-slate-400 px-2 py-1 ${className}`}>
      {children ?? ''}
    </td>
  );
}

export function PrintSectionTitle({ en, zh }: { en: string; zh: string }) {
  return (
    <div className="mb-1 mt-4 flex items-baseline gap-2">
      <h2 className="text-[13px] font-bold text-slate-900">{en}</h2>
      <span className="text-[10px] text-slate-500">{zh}</span>
    </div>
  );
}

export function PrintSignature({ en, zh, name }: { en: string; zh: string; name?: string | null }) {
  return (
    <div className="text-center">
      <div className="text-[11px] font-semibold text-slate-900">{en},</div>
      <div className="text-[9px] text-slate-500">{zh}</div>
      {/*
        Room to sign by hand on the printed sheet. Repeated plain spaces collapse
        to one in HTML, which is why the brackets used to come out narrow — the
        gap is a fixed-width inline block instead, so every box is the same width
        whether or not a name is printed in it.
      */}
      <div className="mt-14 text-[11px] text-slate-800">
        (
        <span className="inline-block min-w-[18rem] text-center">{name ?? ''}</span>
        )
      </div>
    </div>
  );
}

/** The page around a document: on-screen controls, then title, print time and logo. */
/** Title, print time and logo — the top strip of a printed document. */
export function PrintTitleBlock({
  title,
  titleZh,
  logo,
  printedAt,
}: {
  title: string;
  titleZh: string;
  logo: string;
  printedAt: Date;
}) {
  return (
    <div className="flex items-start justify-between">
      <div className="w-44 font-mono text-[11px] text-slate-700">
        Printed: {stamp(printedAt)}
      </div>
      <div className="text-center">
        <h1 className="text-[17px] font-bold tracking-wide">{title}</h1>
        <div className="text-[12px] text-slate-600">{titleZh}</div>
      </div>
      <div className="flex w-44 justify-end">
        <img src={logo} alt="" className="h-14 w-auto object-contain" />
      </div>
    </div>
  );
}

export function PrintShell({
  backTo,
  title,
  titleZh,
  logo,
  hideTitle = false,
  children,
}: {
  backTo: string;
  title: string;
  titleZh: string;
  logo: string;
  /**
   * Set when the page puts PrintTitleBlock inside its own table header, so the
   * title repeats on every page instead of being printed once up here.
   */
  hideTitle?: boolean;
  children: ReactNode;
}) {
  const [printedAt] = useState(() => new Date());

  /**
   * Opening a print URL goes straight to the browser's print dialog — the page
   * on screen is the document itself, not a preview to click through. The wait
   * lets the logo and web fonts settle first, so the dialog never captures a
   * half-drawn page; the controls stay for printing again after a cancel.
   */
  useEffect(() => {
    let cancelled = false;
    const ready = Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
    ]);
    ready.then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white text-slate-900">
      {/* Only on screen: the controls. @media print hides them. */}
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          /* The print pages live inside the admin layout: its sidebar, topbar
             and page padding must not end up on the sheet. */
          .print-hide { display: none !important; }
          .print-reset {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
          }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex items-center gap-2 border-b border-slate-200 p-4">
        <Link to={backTo} className="btn-secondary">
          ← Back to document
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
        <span className="text-xs text-slate-400">
          Printed from the browser — use landscape A4 for the original layout.
        </span>
      </div>

      <div className="print-reset mx-auto max-w-[277mm] px-6 pb-8 text-[11px]">
        {hideTitle ? null : (
          <PrintTitleBlock
            title={title}
            titleZh={titleZh}
            logo={logo}
            printedAt={printedAt}
          />
        )}
        {children}
      </div>
    </div>
  );
}
