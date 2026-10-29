import type { Writable } from 'stream';
import * as ExcelJS from 'exceljs';

/** A column of an export sheet: its header, width and value. */
export interface ExportColumn<T> {
  header: string;
  width: number;
  value: (row: T) => string | number | null;
}

export interface ExportSheet<T> {
  name: string;
  columns: ExportColumn<T>[];
  /** Rows in batches, so a large export streams instead of sitting in memory. */
  rows: AsyncIterable<T[]>;
}

/**
 * How the header row looks. WMS dev's exports come in two styles: dark text
 * on light blue, centred (inventory, sales) and white on indigo with the
 * header frozen (transfer orders).
 */
export interface HeaderStyle {
  fill: string;
  font?: string;
  center?: boolean;
  freeze?: boolean;
}
const DEFAULT_HEADER: HeaderStyle = { fill: 'FFD9E1F2', center: true };

/** Date parts in WIB (Asia/Jakarta), the zone WMS dev stamps its exports in. */
export function wibParts(date: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

/** "2026-10-27 14:33:11" in WIB, as WMS dev writes dates in its exports. */
export function wibDateTime(date: Date) {
  const t = wibParts(date);
  return `${t.y}-${t.m}-${t.d} ${t.hh}:${t.mm}:${t.ss}`;
}

/** "2026-10-27 14:33" in WIB (the transfer-order export drops the seconds). */
export function wibDateTimeMinutes(date: Date) {
  const t = wibParts(date);
  return `${t.y}-${t.m}-${t.d} ${t.hh}:${t.mm}`;
}

/**
 * Streams a workbook laid out like WMS dev's exports: one sheet per entry, a
 * bold header row (see HeaderStyle) and fixed column widths.
 */
export async function writeXlsx(out: Writable, sheets: ExportSheet<any>[], style: HeaderStyle = DEFAULT_HEADER) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useSharedStrings: true, useStyles: true });
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, style.freeze ? { views: [{ state: 'frozen', ySplit: 1 }] } : undefined);
    ws.columns = sheet.columns.map((c) => ({ width: c.width }));
    const header = ws.addRow(sheet.columns.map((c) => c.header));
    header.eachCell((cell) => {
      cell.font = style.font ? { bold: true, color: { argb: style.font } } : { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
      if (style.center) cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    header.commit();
    for await (const rows of sheet.rows) {
      for (const r of rows) ws.addRow(sheet.columns.map((c) => c.value(r))).commit();
    }
    ws.commit();
  }
  await wb.commit();
}

/** Headers for an .xlsx download named `fileName`. */
export function xlsxHeaders(fileName: string): Record<string, string> {
  return {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Access-Control-Expose-Headers': 'Content-Disposition',
  };
}
