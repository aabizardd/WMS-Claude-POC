/**
 * Quick Add (Create TO): reading pasted rows of "PN, Qty, Description".
 *
 * One line is one TO row. Columns are split by Tab (a copy from Excel), then
 * ";" or "," — the PN first, the qty second, the rest is the description.
 * With spaces only, the last word is the qty and everything before it the PN
 * (PNs may contain spaces, e.g. "1020900100 - REVERSE ALARM"), so there is no
 * description then. A first line whose qty is not a number but reads like a
 * header ("PN", "Part Number", "Material Code"…) is skipped.
 */

/** The most lines one paste may carry. */
export const QUICK_ADD_MAX_LINES = 500;

export interface ParsedRow {
  /** 1-based line number in the pasted text. */
  line: number;
  code: string;
  qty: number | null;
  /** The qty as pasted (to correct it when it cannot be read). */
  qtyText: string;
  description: string;
  /** Why the line cannot be used as written, if so. */
  error: string | null;
}

const HEADER_WORDS = /^(pn|p\/n|part\s*(no|number|num)?|material(\s*(code|no|number))?|kode(\s*material)?|item(\s*code)?|sku)$/i;

/** "12", "12.5", "12,5" → number; anything else → NaN. */
function parseQty(raw: string): number {
  const v = raw.trim().replace(/\s+/g, '');
  if (!/^\d+([.,]\d+)?$/.test(v)) return NaN;
  return Number(v.replace(',', '.'));
}

function splitLine(text: string): { code: string; qty: string; description: string } {
  for (const sep of ['\t', ';', ',']) {
    if (text.includes(sep)) {
      const [code = '', qty = '', ...rest] = text.split(sep);
      return { code: code.trim(), qty: qty.trim(), description: rest.join(sep === '\t' ? ' ' : sep).trim() };
    }
  }
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return { code: words[0] ?? '', qty: '', description: '' };
  return { code: words.slice(0, -1).join(' '), qty: words[words.length - 1], description: '' };
}

export function parseQuickAdd(text: string): { rows: ParsedRow[]; skippedHeader: boolean; tooMany: boolean } {
  const lines = text.split(/\r?\n/);
  const rows: ParsedRow[] = [];
  let skippedHeader = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const { code, qty: qtyText, description } = splitLine(raw);
    const qty = qtyText ? parseQty(qtyText) : NaN;
    if (!rows.length && !skippedHeader && Number.isNaN(qty) && HEADER_WORDS.test(code)) {
      skippedHeader = true;
      continue;
    }
    let error: string | null = null;
    if (!code) error = 'Missing PN';
    else if (code.length > 200) error = 'PN is too long';
    else if (!qtyText) error = 'Missing qty';
    else if (Number.isNaN(qty)) error = `Invalid qty "${qtyText}"`;
    else if (qty <= 0) error = 'Qty must be above 0';
    rows.push({ line: i + 1, code, qty: Number.isNaN(qty) ? null : qty, qtyText, description: description.slice(0, 300), error });
  }
  return { rows: rows.slice(0, QUICK_ADD_MAX_LINES), skippedHeader, tooMany: rows.length > QUICK_ADD_MAX_LINES };
}
