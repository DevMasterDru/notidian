import { parseCsvToRecords } from "core/utils/contexts/tableCsv";
import {
  CsvImportPlan,
  planCsvImport,
} from "core/utils/contexts/tableCsvImport";
import { Superstate } from "makemd-core";
import React, { useMemo, useState } from "react";
import { default as i18n } from "shared/i18n";

// Preview-and-confirm modal for CSV import (Notidian-84u). Paste CSV (e.g. from
// a spreadsheet or a .csv file), pick which column names the rows, review the
// header→column mapping + counts + name collisions, then Import. No file is
// written until the user clicks Import; the parent wires onImport to execution.
export const CsvImportModal = (props: {
  superstate: Superstate;
  existingColumnNames: string[];
  existingRowTitles: string[];
  onImport: (plan: CsvImportPlan) => void;
  hide?: () => void;
}) => {
  const [text, setText] = useState("");
  const [titleHeader, setTitleHeader] = useState<string | null>(null);

  const plan = useMemo<CsvImportPlan>(
    () =>
      planCsvImport({
        parsed: parseCsvToRecords(text),
        existingColumnNames: props.existingColumnNames,
        existingRowTitles: props.existingRowTitles,
        titleHeader,
      }),
    [text, titleHeader, props.existingColumnNames, props.existingRowTitles]
  );

  const collisions = plan.rows.filter((r) => r.collision != "none").length;
  const canImport = plan.importableCount > 0;

  const doImport = () => {
    if (!canImport) return;
    props.onImport(plan);
    if (props.hide) props.hide();
  };

  return (
    <div className="mk-layout-column mk-gap-8 mk-csv-import">
      <textarea
        value={text}
        placeholder="Paste CSV here (first row = headers)…"
        onChange={(e) => setText(e.target.value)}
        className="mk-input mk-csv-import-input"
        rows={8}
        style={{ width: "100%", fontFamily: "var(--font-monospace)" }}
      />

      {plan.headers.length > 0 ? (
        <>
          <div className="mk-csv-import-title-row">
            <span>Name rows by</span>
            <select
              value={plan.titleHeader ?? ""}
              onChange={(e) => setTitleHeader(e.target.value)}
              className="mk-input"
            >
              {plan.headers.map((h) => (
                <option key={h.header} value={h.header}>
                  {h.header}
                </option>
              ))}
            </select>
          </div>

          <div className="mk-csv-import-headers">
            {plan.headers.map((h) => (
              <span
                key={h.header}
                className={
                  "mk-csv-import-chip" +
                  (h.isTitle ? " mk-csv-import-chip-title" : "") +
                  (!h.isTitle && !h.existingColumn
                    ? " mk-csv-import-chip-new"
                    : "")
                }
                title={
                  h.isTitle
                    ? "Becomes the file name"
                    : h.existingColumn
                      ? "Maps to an existing column"
                      : "New column (frontmatter)"
                }
              >
                {h.header}
                {h.isTitle
                  ? " · name"
                  : h.existingColumn
                    ? ""
                    : " · new"}
              </span>
            ))}
          </div>

          <div className="mk-csv-import-summary">
            {plan.importableCount} row
            {plan.importableCount == 1 ? "" : "s"} to create
            {plan.skippedNoTitle > 0
              ? ` · ${plan.skippedNoTitle} skipped (no name)`
              : ""}
            {collisions > 0
              ? ` · ${collisions} name collision${
                  collisions == 1 ? "" : "s"
                } (will be auto-renamed)`
              : ""}
          </div>
        </>
      ) : (
        <div className="mk-csv-import-summary">
          Paste CSV to preview the import.
        </div>
      )}

      <div className="mk-modal-actions">
        <button
          onClick={doImport}
          disabled={!canImport}
          aria-disabled={!canImport}
        >
          Import {canImport ? `${plan.importableCount} ` : ""}rows
        </button>
        <button onClick={() => props.hide && props.hide()}>
          {i18n.buttons.cancel}
        </button>
      </div>
    </div>
  );
};
