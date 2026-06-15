/**
 * Adversarial / characterization net for the LAST stage of the spreadsheet-paste
 * seam: applyTableWritesToRows (the in-memory root-row projection of a paste plan)
 * and resolveTableEditPath (the path-resolution used by the canonical write path).
 *
 * AUTHORITY focus (ADR 0001/0014/0017): applyTableWritesToRows must NOT be a blind
 * MDB write. It deliberately applies ONLY the writes that belong in the root files
 * table by index — i.e. table == "" AND authority != "file". File-identity (rename)
 * writes and context-table (table != "") writes are intentionally left out here; they
 * are routed through their own canonical paths (file rename / context DB) elsewhere.
 * These pins prevent a regression that "helpfully" starts mutating the row snapshot
 * for a rename or a foreign-table write.
 *
 * The closing block is a PLAN -> EXECUTION integration property: a plan produced by
 * planTablePaste, fed straight into applyTableWritesToRows, mutates exactly the cells
 * the plan promised — no off-by-one, no leakage into rows the plan did not target.
 */
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { notidianPropertySource } from "core/utils/properties/propertyAuthority";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { CellSelection } from "./tableSelection";
import { planTablePaste, TablePasteColumn, TablePasteWrite } from "./tablePastePlan";
import {
  applyTableWritesToRows,
  resolveTableEditPath,
} from "./tablePasteExecution";

const baseRows = (): DBRow[] => [
  { [PathPropertyName]: "Notes/A.md", status: "old0", manual: "m0" },
  { [PathPropertyName]: "Notes/B.md", status: "old1", manual: "m1" },
  { [PathPropertyName]: "Notes/C.md", status: "old2", manual: "m2" },
];

describe("resolveTableEditPath — path selection for the canonical write", () => {
  it("falls back to the row file path when the explicit path is missing/blank", () => {
    expect(resolveTableEditPath(undefined, "Notes/A.md")).toBe("Notes/A.md");
    expect(resolveTableEditPath(null, "Notes/A.md")).toBe("Notes/A.md");
    expect(resolveTableEditPath("", "Notes/A.md")).toBe("Notes/A.md");
    expect(resolveTableEditPath("   ", "Notes/A.md")).toBe("Notes/A.md");
  });

  it("keeps a non-blank explicit path (replay writes carry a baked path)", () => {
    expect(resolveTableEditPath("Notes/Explicit.md", "Notes/A.md")).toBe(
      "Notes/Explicit.md"
    );
  });

  it("returns undefined when neither an explicit nor a row path exists", () => {
    expect(resolveTableEditPath(undefined, undefined)).toBeUndefined();
    expect(resolveTableEditPath("", undefined)).toBeUndefined();
  });
});

describe("applyTableWritesToRows — routing guardrails (not a blind MDB write)", () => {
  it("applies a root frontmatter/notidian write to the row at the matching index", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "1",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "active",
        authority: "frontmatter",
      },
    ];
    const out = applyTableWritesToRows(baseRows(), writes);
    expect(out[0].status).toBe("old0"); // untouched
    expect(out[1].status).toBe("active"); // applied at index 1
    expect(out[2].status).toBe("old2"); // untouched
  });

  it("does NOT apply a file-identity (rename) write to the row snapshot — that routes through the rename path", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "0",
        columnId: PathPropertyName,
        columnName: PathPropertyName,
        table: "",
        value: "Renamed",
        authority: "file",
      },
    ];
    const rows = baseRows();
    const out = applyTableWritesToRows(rows, writes);
    expect(out).toEqual(rows); // snapshot unchanged
    expect(out[0][PathPropertyName]).toBe("Notes/A.md");
  });

  it("does NOT apply a context-table (table != '') write to the root row snapshot", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "0",
        columnId: "linked",
        columnName: "linked",
        table: "OtherTable",
        value: "x",
        authority: "notidian",
      },
    ];
    const rows = baseRows();
    const out = applyTableWritesToRows(rows, writes);
    expect(out).toEqual(rows); // root snapshot untouched; foreign table handled elsewhere
  });

  it("ignores a write whose rowId index is out of range (no new rows, no throw)", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "99",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "ghost",
        authority: "frontmatter",
      },
    ];
    const rows = baseRows();
    const out = applyTableWritesToRows(rows, writes);
    expect(out).toEqual(rows);
    expect(out).toHaveLength(3);
  });

  it("applies multiple writes to the SAME row in order, last-write-wins per column", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "first",
        authority: "frontmatter",
      },
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "second",
        authority: "frontmatter",
      },
      {
        rowId: "0",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "mm",
        authority: "notidian",
      },
    ];
    const out = applyTableWritesToRows(baseRows(), writes);
    expect(out[0].status).toBe("second");
    expect(out[0].manual).toBe("mm");
  });

  it("writes the verbatim string value (no coercion) into the row snapshot", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "  spaced \"quoted\" not-a-number  ",
        authority: "frontmatter",
      },
    ];
    const out = applyTableWritesToRows(baseRows(), writes);
    expect(out[0].status).toBe('  spaced "quoted" not-a-number  ');
  });

  it("interprets rowId via parseInt — a non-numeric rowId targets no row (NaN != index)", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "Notes/A.md",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "x",
        authority: "frontmatter",
      },
    ];
    const rows = baseRows();
    expect(applyTableWritesToRows(rows, writes)).toEqual(rows);
  });

  it("returns a new array and new row objects for mutated rows (no input mutation)", () => {
    const rows = baseRows();
    const writes: TablePasteWrite[] = [
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "active",
        authority: "frontmatter",
      },
    ];
    const out = applyTableWritesToRows(rows, writes);
    expect(out).not.toBe(rows);
    expect(out[0]).not.toBe(rows[0]); // mutated row is a fresh object
    expect(out[1]).toBe(rows[1]); // untouched row reference is preserved
    expect(rows[0].status).toBe("old0"); // original input untouched
  });
});

describe("PLAN -> EXECUTION integration: applyTableWritesToRows honors the plan exactly", () => {
  const columns: TablePasteColumn[] = [
    { id: PathPropertyName, name: PathPropertyName, type: "file" },
    { id: "status", name: "status", type: "text", source: frontmatterPropertySource },
    { id: "manual", name: "manual", type: "text", source: notidianPropertySource },
    { id: "Created", name: "Created", type: "fileprop" },
  ];
  const rowOrder = ["0", "1", "2"];
  const cell = (rowId: string, columnId: string): CellSelection => ({
    anchor: { rowId, columnId },
    focus: { rowId, columnId },
    active: { rowId, columnId },
  });

  it("a property-paste plan mutates exactly the non-file root cells it promised", () => {
    const plan = planTablePaste({
      rowOrder,
      columns,
      selection: cell("0", "status"),
      clipboardGrid: [
        ["s0", "m0"],
        ["s1", "m1"],
      ],
    });
    const out = applyTableWritesToRows(baseRows(), plan.writes);
    expect(out[0].status).toBe("s0");
    expect(out[0].manual).toBe("m0");
    expect(out[1].status).toBe("s1");
    expect(out[1].manual).toBe("m1");
    expect(out[2].status).toBe("old2"); // not in the plan -> untouched
  });

  it("a bulk-rename (file) plan leaves the root row snapshot UNCHANGED (rename handled elsewhere)", () => {
    const plan = planTablePaste({
      rowOrder,
      columns,
      selection: cell("0", PathPropertyName),
      clipboardGrid: [["New Title"]],
    });
    const rows = baseRows();
    const out = applyTableWritesToRows(rows, plan.writes);
    expect(out).toEqual(rows);
  });

  it("a mixed plan applies the non-file cell but not the rename cell", () => {
    const plan = planTablePaste({
      rowOrder,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: PathPropertyName },
        focus: { rowId: "0", columnId: "manual" },
        active: { rowId: "0", columnId: PathPropertyName },
      },
      clipboardGrid: [["title", "s", "m"]],
    });
    expect(plan.mode).toBe("mixed");
    const out = applyTableWritesToRows(baseRows(), plan.writes);
    expect(out[0][PathPropertyName]).toBe("Notes/A.md"); // rename NOT applied here
    expect(out[0].status).toBe("s");
    expect(out[0].manual).toBe("m");
  });

  it("the count of root non-file writes equals the count of row-cell mutations the executor performs", () => {
    // Sweep the whole writable area; tally how many writes the executor would apply
    // (table=='' && authority!='file' && in-range index) and confirm it equals the
    // number of cells whose value actually changed.
    const plan = planTablePaste({
      rowOrder,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: PathPropertyName },
        focus: { rowId: "2", columnId: "Created" },
        active: { rowId: "0", columnId: PathPropertyName },
      },
      clipboardGrid: [["v"]],
    });
    const rootApplicable = plan.writes.filter(
      (w) =>
        w.table === "" &&
        w.authority !== "file" &&
        Number.isInteger(parseInt(w.rowId)) &&
        parseInt(w.rowId) >= 0 &&
        parseInt(w.rowId) < rowOrder.length
    );
    const before = baseRows();
    const after = applyTableWritesToRows(before, plan.writes);

    let changed = 0;
    after.forEach((row, idx) => {
      for (const key of Object.keys(row)) {
        if (row[key] !== before[idx][key]) changed++;
      }
    });
    expect(changed).toBe(rootApplicable.length);
  });
});
