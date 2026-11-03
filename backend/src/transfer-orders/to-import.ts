import ExcelJS from 'exceljs';
import type { Writable } from 'stream';

/**
 * Create TO — Import Excel: reading a workbook of "Kode Material / Jumlah
 * Transfer" rows like the ones the sites already send (a title row, then a
 * header — Chinese and/or Indonesian/English — then one row per material).
 * The header is found by its names, so title rows above it, extra columns and
 * any column order are fine. Nothing is stored: the rows go back to the form,
 * which checks them like a paste.
 */

/** The most data rows one sheet may carry. */
export const IMPORT_MAX_ROWS = 500;
/** Header rows are looked for within the first rows of a sheet. */
const HEADER_SCAN_ROWS = 20;

type Field = 'code' | 'qty' | 'name' | 'description';

/** Header words per field, matched against each line of a header cell (any case). */
const HEADER_WORDS: Record<Field, string[]> = {
  code: ['kode material', 'material code', 'part number', 'part no', 'pn', 'p/n', 'kode', 'item code', '物料编码', '编码'],
  qty: ['jumlah transfer', 'qty request', 'qty', 'quantity', 'jumlah', 'qty transfer', '调拨数量', '数量'],
  name: ['nama item', 'nama material', 'material name', 'item name', 'nama', '物料名称', '名称'],
  description: ['keterangan', 'description', 'remark', 'remarks', 'catatan', 'note', '备注', '说明'],
};

export interface ImportRow {
  /** The Excel row number. */
  line: number;
  code: string;
  /** The qty as written (to show and correct when it is not a number). */
  qty_text: string;
  qty: number | null;
  /** The file's own item name — shown for comparison only. */
  name: string;
  description: string;
}

export interface ImportResult {
  sheets: { name: string; rows: number }[];
  sheet: string | null;
  /** Excel row of the header found, and which columns it named. */
  header_row: number | null;
  columns: Partial<Record<Field, string>>;
  rows: ImportRow[];
  truncated: boolean;
  error?: string;
}

/** A cell as plain text (numbers without a trailing ".0", rich text joined, formulas by result). */
function text(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'string') return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return v.result == null ? '' : String(v.result).trim();
    if ('text' in v) return String(v.text).trim();
  }
  return String(v).trim();
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Which field a header cell names, if any ("物料编码\nKode Material" → code). */
function fieldOf(header: string): Field | null {
  const parts = header.split(/\r?\n|\//).map(norm).filter(Boolean);
  for (const f of ['code', 'qty', 'name', 'description'] as Field[]) {
    if (parts.some((p) => HEADER_WORDS[f].some((w) => p === w || p.startsWith(`${w} `) || p.includes(w) && w.length > 3))) {
      return f;
    }
  }
  return null;
}

/** The header row of a sheet: the first one naming both the code and the qty column. */
function findHeader(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(ws.rowCount, HEADER_SCAN_ROWS); r++) {
    const cols: Partial<Record<Field, number>> = {};
    const names: Partial<Record<Field, string>> = {};
    ws.getRow(r).eachCell((cell, c) => {
      const t = text(cell);
      const f = t ? fieldOf(t) : null;
      if (f && cols[f] == null) {
        cols[f] = c;
        names[f] = t.replace(/\s*\r?\n\s*/g, ' / ');
      }
    });
    if (cols.code != null && cols.qty != null) return { row: r, cols, names };
  }
  return null;
}

/** Rows below the header, blank lines skipped. */
function readRows(ws: ExcelJS.Worksheet, header: NonNullable<ReturnType<typeof findHeader>>) {
  const rows: ImportRow[] = [];
  let truncated = false;
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (f: Field) => (header.cols[f] != null ? text(row.getCell(header.cols[f]!)) : '');
    const code = get('code');
    const qtyText = get('qty');
    if (!code && !qtyText) continue;
    if (rows.length >= IMPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    const cell = row.getCell(header.cols.qty!).value;
    const qty =
      typeof cell === 'number'
        ? cell
        : /^\d+([.,]\d+)?$/.test(qtyText.replace(/\s+/g, ''))
          ? Number(qtyText.replace(/\s+/g, '').replace(',', '.'))
          : null;
    rows.push({ line: r, code, qty_text: qtyText, qty, name: get('name'), description: get('description').slice(0, 300) });
  }
  return { rows, truncated };
}

/** Read an uploaded .xlsx: the sheets it has, and the rows of the chosen one (else the first with a header). */
export async function parseToImport(buffer: Buffer, sheetName?: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { sheets: [], sheet: null, header_row: null, columns: {}, rows: [], truncated: false, error: 'The file is not a readable .xlsx workbook.' };
  }
  const sheets = wb.worksheets.map((ws) => ({ ws, header: findHeader(ws) }));
  const list = sheets.map(({ ws, header }) => ({
    name: ws.name,
    rows: header ? Math.max(0, ws.actualRowCount - header.row) : 0,
  }));
  const chosen = sheetName
    ? sheets.find((s) => s.ws.name === sheetName)
    : (sheets.find((s) => s.header) ?? sheets[0]);
  if (!chosen) {
    return { sheets: list, sheet: null, header_row: null, columns: {}, rows: [], truncated: false, error: `Sheet "${sheetName}" not found.` };
  }
  if (!chosen.header) {
    return {
      sheets: list,
      sheet: chosen.ws.name,
      header_row: null,
      columns: {},
      rows: [],
      truncated: false,
      error: `No header with a material code column (e.g. "Kode Material") and a qty column (e.g. "Jumlah Transfer") was found in the first ${HEADER_SCAN_ROWS} rows of "${chosen.ws.name}".`,
    };
  }
  const { rows, truncated } = readRows(chosen.ws, chosen.header);
  return {
    sheets: list,
    sheet: chosen.ws.name,
    header_row: chosen.header.row,
    columns: chosen.header.names,
    rows,
    truncated,
  };
}

/** The import template: the sites' layout (title, bilingual header) plus an optional Keterangan column. */
export async function writeToImportTemplate(out: Writable) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TO');
  ws.columns = [{ width: 9 }, { width: 24 }, { width: 34 }, { width: 18 }, { width: 30 }];
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'DAFTAR TRANSFER ORDER — <ASAL> TO <TUJUAN>';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  const header = ws.getRow(2);
  header.values = ['序号\nNomor seri', '物料编码\nKode Material', '物料名称\nNama Item', '调拨数量\nJumlah Transfer', '备注\nKeterangan'];
  header.height = 36;
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5166AE' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  const samples: [string, string, number, string][] = [
    ['04.35160.9714', 'POLYAMIDE TUBE PA14', 25, ''],
    ['0220-609-9-Z61091', 'AIR VALVE', 10, 'Rak A'],
    ['0220-609-9-Z61091', 'AIR VALVE', 5, 'Rak B'],
  ];
  samples.forEach(([code, name, qty, note], i) => {
    const row = ws.addRow([i + 1, code, name, qty, note]);
    row.getCell(2).numFmt = '@';
  });
  // Material codes are text: a code of digits keeps its leading zeros.
  for (let r = 3; r <= 202; r++) {
    ws.getCell(`B${r}`).numFmt = '@';
    ws.getCell(`D${r}`).dataValidation = {
      type: 'decimal',
      operator: 'greaterThan',
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'Jumlah Transfer',
      error: 'Isi angka lebih dari 0.',
    };
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const help = wb.addWorksheet('Petunjuk');
  help.columns = [{ width: 110 }];
  [
    'PETUNJUK IMPORT TRANSFER ORDER',
    '',
    '1. Isi mulai baris 3 sheet "TO": satu baris = satu baris TO.',
    '2. Kode Material dan Jumlah Transfer wajib. Nama Item hanya pembanding — nama yang dipakai dari Material Master WMS.',
    '3. Keterangan (opsional) menjadi Description baris TO.',
    '4. Kode Material yang sama boleh di beberapa baris, dengan qty sama atau berbeda — tiap baris tetap terpisah.',
    '5. Jumlah Transfer berupa angka > 0, tanpa pemisah ribuan. Total qty satu Kode Material tidak boleh melebihi stok tersedia di warehouse asal.',
    '6. Baris judul dan kolom lain (mis. Nomor seri) boleh ada; header dikenali dari namanya (Kode Material / Jumlah Transfer / Nama Item / Keterangan).',
    '7. Hapus baris contoh sebelum dipakai. Maksimal 200 baris per TO.',
  ].forEach((t, i) => {
    const c = help.getCell(`A${i + 1}`);
    c.value = t;
    if (i === 0) c.font = { bold: true, size: 13 };
  });

  await wb.xlsx.write(out);
}
