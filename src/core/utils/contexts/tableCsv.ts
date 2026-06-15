// Pure RFC 4180 CSV serialize/parse + database row mapping (Notidian-7gg).
// View/data-layer only: serialization reads projected row values; import
// produces plain records that a caller turns into files + frontmatter.
//
// Notes on two deliberate behaviours:
// - An empty/whitespace grid round-trips to no rows. tableToCsv always emits a
//   header row and parseCsvToRecords skips empty rows, so this only affects the
//   degenerate `[['']]` case, which we treat as "no data" by design.
// - No spreadsheet formula-injection mitigation (`=`,`+`,`-`,`@` prefixes). The
//   vault is single-user and trusted (same threat model as the password field),
//   and prefix-escaping would corrupt the user's own values on re-import.

import { uniqueNameFromString } from "shared/utils/array";

const needsQuoting = (cell: string): boolean =>
  cell.includes(",") || cell.includes('"') || cell.includes("\n") || cell.includes("\r");

const serializeCell = (cell: string): string =>
  needsQuoting(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;

export const serializeCsv = (rows: string[][]): string =>
  rows.map((row) => row.map((cell) => serializeCell(cell ?? "")).join(",")).join("\n");

// State-machine parser: handles quoted fields with embedded commas, quotes
// (doubled), and newlines, plus LF/CRLF/CR row breaks. A trailing newline does
// not produce an extra empty row.
export const parseCsv = (text: string): string[][] => {
  if (text.length == 0) return [];
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch == '"') {
        if (text[i + 1] == '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch == '"' && field.length == 0) {
      // A quote only opens a quoted field at field start.
      inQuotes = true;
      i++;
      continue;
    }
    if (ch == '"') {
      // A bare quote mid-field (malformed input) is kept literally rather than
      // silently corrupting the rest of the row.
      field += '"';
      i++;
      continue;
    }
    if (ch == ",") {
      pushField();
      i++;
      continue;
    }
    if (ch == "\r") {
      // swallow CRLF as one break
      if (text[i + 1] == "\n") i++;
      pushRow();
      i++;
      continue;
    }
    if (ch == "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field/row unless the text ended exactly on a row break
  // (in which case row is empty and field is "").
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
};

// Project a database view (visible columns + filtered rows) to a CSV string:
// a header row of column names, then one row per record reading row[col.key].
export const tableToCsv = (params: {
  columns: { key: string; name: string }[];
  rows: Record<string, unknown>[];
}): string => {
  const header = params.columns.map((col) => col.name);
  const body = params.rows.map((row) =>
    params.columns.map((col) => {
      const value = row[col.key];
      return value == null ? "" : String(value);
    })
  );
  return serializeCsv([header, ...body]);
};

export type CsvImport = {
  headers: string[];
  rows: Record<string, string>[];
};

// Parse a CSV into header-keyed records, skipping fully-empty rows. The caller
// maps headers to columns and turns each record into a file + frontmatter.
//
// Duplicate-header contract (ADR 0031, Notidian-5zc): a CSV with two columns
// sharing a header name (e.g. `a,a,b`) is auto-uniquified IN THE PARSER via
// `uniqueNameFromString` — the same canonical dedup helper column/schema/
// file-name creation uses — so `a,a,b` -> headers `['a','a1','b']` and the
// record keeps every column (`{ a:'1', a1:'2', b:'3' }`). This is lossless
// (no column silently dropped, last-write-wins) and matches Notion's own CSV
// import (auto-suffix duplicate names). The parser is the only layer that sees
// the raw header row positionally before names become object keys; both callers
// (`planCsvImport`, `executeCsvImport`) and the frontmatter sink are name-keyed,
// so distinctness must be created here or it is lost. The suffixed name surfaces
// in the CsvImportModal preview (it renders `planCsvImport(parseCsvToRecords)`)
// before any write, so the rename is visible, not hidden. By construction
// `headers.length === Object.keys(record).length`.
export const parseCsvToRecords = (text: string): CsvImport => {
  const grid = parseCsv(text);
  if (grid.length == 0) return { headers: [], rows: [] };
  // Build a de-duplicated header list, preserving column order. Each name is
  // uniquified against the names already accepted, so duplicates become
  // `a`, `a1`, `a2`, … (uniqueNameFromString) and every column survives.
  const headers: string[] = [];
  for (const h of grid[0]) headers.push(uniqueNameFromString(h.trim(), headers));
  const rows: Record<string, string>[] = [];
  for (const cells of grid.slice(1)) {
    if (cells.every((cell) => cell.trim().length == 0)) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    rows.push(record);
  }
  return { headers, rows };
};
