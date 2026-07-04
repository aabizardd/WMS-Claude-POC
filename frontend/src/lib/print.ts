// Reusable print helper. Builds a clean, self-contained document (header meta +
// tables) and opens the browser print dialog. Data comes only from what is
// passed in — no extra fetching.

export interface PrintMeta {
  label: string;
  value: string | number | null | undefined;
}

export interface PrintTable {
  heading?: string;
  columns: string[];
  rows: (string | number | null | undefined)[][];
}

export interface PrintDocOptions {
  title: string;
  subtitle?: string;
  meta?: PrintMeta[];
  tables?: PrintTable[];
}

function esc(v: unknown): string {
  const s = v === null || v === undefined || v === '' ? '—' : String(v);
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function printDoc(doc: PrintDocOptions) {
  const meta = (doc.meta ?? [])
    .map(
      (m) =>
        `<div class="meta"><div class="ml">${esc(m.label)}</div><div class="mv">${esc(m.value)}</div></div>`,
    )
    .join('');

  const tables = (doc.tables ?? [])
    .map((t) => {
      const head = t.columns.map((c) => `<th>${esc(c)}</th>`).join('');
      const body = t.rows.length
        ? t.rows
            .map(
              (r) =>
                `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`,
            )
            .join('')
        : `<tr><td colspan="${t.columns.length}" class="empty">No items</td></tr>`;
      return `${t.heading ? `<h3>${esc(t.heading)}</h3>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 24px; margin-bottom: 24px; }
  .ml { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #94a3b8; }
  .mv { font-size: 13px; font-weight: 600; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #f1f5f9; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #475569; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  .empty { text-align: center; color: #94a3b8; padding: 16px; }
  @media print { body { margin: 0; } }
</style></head><body>
  <h1>${esc(doc.title)}</h1>
  ${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}
  ${meta ? `<div class="meta-grid">${meta}</div>` : ''}
  ${tables}
</body></html>`;

  const w = window.open('', '_blank', 'width=920,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* user can print manually */
    }
  }, 300);
}
