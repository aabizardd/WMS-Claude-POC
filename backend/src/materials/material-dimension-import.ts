import ExcelJS from 'exceljs';
import type { Writable } from 'stream';

/**
 * Materials — Import Dimensions: an Excel round trip for the dimension fields
 * WMS owns (the ERP sync only writes code and name). The template lists the
 * materials with their current values; the user edits it and uploads it back.
 * Uploads are only read here: the preview says what would change, and Apply
 * writes the checked rows.
 */

/** The most data rows one upload may carry (every material fits). */
export const DIMENSION_IMPORT_MAX_ROWS = 20000;
/** Upload size limit. */
export const DIMENSION_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** The header is looked for within the first rows of the sheet. */
const HEADER_SCAN_ROWS = 10;

export type NumField = 'length' | 'width' | 'height' | 'weight';
export type UomField = 'dimension_uom' | 'weight_uom';
type Field = 'code' | 'erp' | 'name' | NumField | UomField;

/** Header names per field (any case; the template's own first). */
const HEADER_WORDS: Record<Field, string[]> = {
  code: ['material code', 'kode material', 'part number', 'item code'],
  erp: ['erp doc id', 'erp id', 'erp_doc_id', 'internal id'],
  name: ['material name', 'nama material', 'item name'],
  length: ['length', 'material length', 'panjang'],
  width: ['width', 'material width', 'lebar'],
  height: ['height', 'material height', 'tinggi'],
  dimension_uom: ['uod', 'dimension uom', 'uom dimension', 'satuan dimensi'],
  weight: ['weight', 'material weight', 'berat'],
  weight_uom: ['weight uom', 'uom weight', 'satuan berat'],
};

export const FIELD_LABEL: Record<NumField | UomField, string> = {
  length: 'Length',
  width: 'Width',
  height: 'Height',
  dimension_uom: 'UoD',
  weight: 'Weight',
  weight_uom: 'Weight UoM',
};

/** One data row as written in the file (empty strings for empty cells). */
export interface DimensionFileRow {
  line: number;
  code: string;
  erp: string;
  /** Raw values per field, as text; numbers keep the cell's number. */
  values: Partial<Record<NumField | UomField, string | number>>;
}

export interface DimensionFile {
  sheet: string | null;
  rows: DimensionFileRow[];
  /** The fields the header names (so a file can carry only some of them). */
  columns: (NumField | UomField)[];
  truncated: boolean;
  error?: string;
}

/** A cell as plain text, or its number. */
function cellValue(cell: ExcelJS.Cell): string | number {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) {
      const r = v.result;
      return r == null ? '' : typeof r === 'number' ? r : String(r).trim();
    }
    if ('text' in v) return String(v.text).trim();
  }
  return String(v).trim();
}

const asText = (v: string | number) => (typeof v === 'number' ? String(v) : v);
const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').replace(/\(.*?\)/g, '').trim();

/** Which field a header cell names. Longer names win ("Weight UoM" over "Weight"). */
function fieldOf(header: string): Field | null {
  const h = norm(header);
  let best: { f: Field; len: number } | null = null;
  for (const [f, words] of Object.entries(HEADER_WORDS) as [Field, string[]][]) {
    for (const w of words) {
      if (h === w && (!best || w.length > best.len)) best = { f, len: w.length };
    }
  }
  return best?.f ?? null;
}

function findHeader(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(ws.rowCount, HEADER_SCAN_ROWS); r++) {
    const cols: Partial<Record<Field, number>> = {};
    ws.getRow(r).eachCell((cell, c) => {
      const t = asText(cellValue(cell));
      const f = t ? fieldOf(t) : null;
      if (f && cols[f] == null) cols[f] = c;
    });
    if (cols.code != null || cols.erp != null) return { row: r, cols };
  }
  return null;
}

const VALUE_FIELDS: (NumField | UomField)[] = ['length', 'width', 'height', 'dimension_uom', 'weight', 'weight_uom'];

/** Read the first sheet that has a Material Code / ERP Doc ID header. */
export async function readDimensionFile(buffer: Buffer): Promise<DimensionFile> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { sheet: null, rows: [], columns: [], truncated: false, error: 'The file is not a readable .xlsx workbook.' };
  }
  const found = wb.worksheets.map((ws) => ({ ws, header: findHeader(ws) })).find((s) => s.header);
  if (!found?.header) {
    return {
      sheet: null,
      rows: [],
      columns: [],
      truncated: false,
      error: `No header with a "Material Code" or "ERP Doc ID" column was found in the first ${HEADER_SCAN_ROWS} rows. Use the downloaded template.`,
    };
  }
  const { ws, header } = found;
  const columns = VALUE_FIELDS.filter((f) => header.cols[f] != null);
  if (!columns.length) {
    return {
      sheet: ws.name,
      rows: [],
      columns,
      truncated: false,
      error: 'The header has no dimension column (Length, Width, Height, UoD, Weight, Weight UoM).',
    };
  }
  const rows: DimensionFileRow[] = [];
  let truncated = false;
  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (f: Field) => (header.cols[f] != null ? cellValue(row.getCell(header.cols[f]!)) : '');
    const code = asText(get('code'));
    const erp = asText(get('erp'));
    const values: DimensionFileRow['values'] = {};
    for (const f of columns) {
      const v = get(f);
      if (v !== '') values[f] = v;
    }
    if (!code && !erp && !Object.keys(values).length) continue;
    if (rows.length >= DIMENSION_IMPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    rows.push({ line: r, code, erp, values });
  }
  return { sheet: ws.name, rows, columns, truncated };
}

/** A dimension value: empty = unchanged; otherwise a number of 0 or more. */
export function parseAmount(v: string | number | undefined): { value?: number; error?: string } {
  if (v === undefined || v === '') return {};
  if (typeof v === 'number') return v >= 0 && Number.isFinite(v) ? { value: v } : { error: 'must be 0 or more' };
  const t = v.replace(/\s+/g, '');
  // "12,5" and "12.5" both read as 12.5 (a decimal comma, as typed in Indonesia).
  if (!/^\d+([.,]\d+)?$/.test(t)) return { error: `"${v}" is not a number` };
  return { value: Number(t.replace(',', '.')) };
}

export interface TemplateMaterial {
  materialCode: string;
  erpDocId: string | null;
  materialName: string;
  materialLength: number;
  materialWidth: number;
  materialHeight: number;
  materialWeight: number;
  dimensionUom: { uomCode: string } | null;
  weightUom: { uomCode: string } | null;
}

/** The template: the materials with their current dimensions, a UoM list and a short how-to. */
export async function writeDimensionTemplate(
  out: Writable,
  materials: TemplateMaterial[],
  uoms: { uomCode: string; uomName: string }[],
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dimensions', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  ws.columns = [
    { header: 'Material Code', width: 24 },
    { header: 'ERP Doc ID', width: 12 },
    { header: 'Material Name', width: 40 },
    { header: 'Length', width: 11 },
    { header: 'Width', width: 11 },
    { header: 'Height', width: 11 },
    { header: 'UoD', width: 9 },
    { header: 'Weight', width: 11 },
    { header: 'Weight UoM', width: 12 },
  ];
  ws.getRow(1).eachCell((c, col) => {
    // Read-only columns are grey: they identify the row and are not imported (except the code/ERP id).
    const editable = col >= 4;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: editable ? 'FF5166AE' : 'FF64748B' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // An empty dimension (0 / no UoM) is left blank, so a re-upload does not
  // rewrite it as 0 and only what the user typed changes.
  const n = (v: number) => (v ? v : null);
  for (const m of materials) {
    const row = ws.addRow([
      m.materialCode,
      m.erpDocId,
      m.materialName,
      n(m.materialLength),
      n(m.materialWidth),
      n(m.materialHeight),
      m.dimensionUom?.uomCode ?? null,
      n(m.materialWeight),
      m.weightUom?.uomCode ?? null,
    ]);
    row.getCell(1).numFmt = '@';
    row.getCell(2).numFmt = '@';
  }

  const uomSheet = wb.addWorksheet('UoM');
  uomSheet.columns = [
    { header: 'UoM Code', width: 12 },
    { header: 'UoM Name', width: 24 },
  ];
  uomSheet.getRow(1).font = { bold: true };
  uoms.forEach((u) => uomSheet.addRow([u.uomCode, u.uomName]));

  const last = Math.max(materials.length + 1, 2);
  const uomList = `UoM!$A$2:$A$${Math.max(uoms.length + 1, 2)}`;
  for (let r = 2; r <= last; r++) {
    for (const col of ['D', 'E', 'F', 'H']) {
      ws.getCell(`${col}${r}`).dataValidation = {
        type: 'decimal',
        operator: 'greaterThanOrEqual',
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Dimension',
        error: 'Enter a number of 0 or more.',
      };
    }
    for (const col of ['G', 'I']) {
      ws.getCell(`${col}${r}`).dataValidation = {
        type: 'list',
        formulae: [uomList],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'UoM',
        error: 'Pick a UoM code from the UoM sheet.',
      };
    }
  }

  const help = wb.addWorksheet('How to');
  help.getColumn(1).width = 110;
  [
    'Import Dimensions — how to fill this file',
    '',
    '1. Each row is matched by Material Code (or ERP Doc ID when the code is empty). Material Name is for reference only.',
    '2. Fill or change Length, Width, Height, UoD, Weight and Weight UoM.',
    '3. An empty cell leaves the current value unchanged. Enter 0 to clear a number.',
    '4. Numbers must be 0 or more; 12.5 and 12,5 both read as 12.5.',
    '5. UoD and Weight UoM take a code from the UoM sheet (e.g. cm, Kg).',
    '6. Rows can be deleted: only the rows in the file are checked. Upload it on Master Data → Materials → ☰ → Import Dimensions.',
    '7. The upload shows a preview first; nothing is saved until you click Apply.',
  ].forEach((t, i) => {
    help.getCell(`A${i + 1}`).value = t;
    if (i === 0) help.getCell('A1').font = { bold: true, size: 13 };
  });

  await wb.xlsx.write(out);
}
