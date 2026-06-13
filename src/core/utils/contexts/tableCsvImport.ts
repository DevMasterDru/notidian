import { CsvImport } from "core/utils/contexts/tableCsv";
import { sanitizeFileName } from "shared/utils/sanitizers";

// CSV import planning (Notidian-84u). Pure: turn parsed CSV records into a
// reviewable plan (which header is the row title/file name, which headers
// already map to columns, per-row frontmatter, and name collisions) that a
// preview UI shows before any file is written. Creating files is the caller's
// job (newPathInSpace + saveFrontmatterProperties) — this layer never touches
// the vault, so it stays fully testable.

export type CsvHeaderMapping = {
  header: string;
  // True when a column with this exact name already exists in the target table.
  // New headers still import (frontmatter auto-materializes a column) — this
  // only drives the preview's "new column" hint.
  existingColumn: boolean;
  // The title header becomes each row's file name, not a frontmatter property.
  isTitle: boolean;
};

export type CsvImportRowPlan = {
  title: string; // raw (display) value from the title header
  fileName: string; // sanitized file name actually created (illegal chars / path
  // separators stripped) — collision + creation use this, not the raw title
  properties: Record<string, string>; // every non-title header -> raw value
  // none: a fresh name. existing: a row with this name is already in the space.
  // duplicate: an earlier record in this same import already used this name.
  collision: "none" | "existing" | "duplicate";
};

export type CsvImportPlan = {
  titleHeader: string | null;
  headers: CsvHeaderMapping[];
  rows: CsvImportRowPlan[];
  totalRecords: number; // records parsed from the CSV
  importableCount: number; // records with a usable (non-empty) title
  skippedNoTitle: number; // records dropped because the title cell was empty
};

export const planCsvImport = (params: {
  parsed: CsvImport;
  existingColumnNames: string[];
  existingRowTitles: string[]; // titles/basenames already present in the space
  titleHeader?: string | null; // defaults to the first header
}): CsvImportPlan => {
  const { parsed, existingColumnNames, existingRowTitles } = params;
  const existingCols = new Set(existingColumnNames);
  // Use the requested title header only if it actually exists; else the first.
  const titleHeader =
    params.titleHeader && parsed.headers.includes(params.titleHeader)
      ? params.titleHeader
      : (parsed.headers[0] ?? null);

  const headers: CsvHeaderMapping[] = parsed.headers.map((header) => ({
    header,
    existingColumn: existingCols.has(header),
    isTitle: header === titleHeader,
  }));

  // Existing row titles are basenames (already sanitized), so collisions are
  // compared on the sanitized file name, which is what actually gets created.
  const existingNames = new Set(existingRowTitles);
  const seenNames = new Set<string>();
  const rows: CsvImportRowPlan[] = [];
  let skippedNoTitle = 0;

  for (const record of parsed.rows) {
    const title = titleHeader ? String(record[titleHeader] ?? "").trim() : "";
    // Sanitize to a safe file name (strip path separators / illegal chars) so a
    // title like "A/B" cannot create nested folders. A title that sanitizes to
    // nothing can't name a file → skipped.
    const fileName = sanitizeFileName(title).trim();
    if (!fileName) {
      skippedNoTitle++;
      continue;
    }
    const properties: Record<string, string> = {};
    for (const header of parsed.headers) {
      if (header === titleHeader || header.trim().length === 0) continue;
      properties[header] = record[header] ?? "";
    }
    let collision: CsvImportRowPlan["collision"] = "none";
    if (seenNames.has(fileName)) collision = "duplicate";
    else if (existingNames.has(fileName)) collision = "existing";
    seenNames.add(fileName);
    rows.push({ title, fileName, properties, collision });
  }

  return {
    titleHeader,
    headers,
    rows,
    totalRecords: parsed.rows.length,
    importableCount: rows.length,
    skippedNoTitle,
  };
};
