/**
 * Adversarial / property characterization net for the MIDDLE stage of the
 * spreadsheet-paste seam: planTablePaste (clipboard grid + selection + columns ->
 * an authority-tagged write plan + rejections).
 *
 * This is a Notion-parity behavior on an untrusted-input path, so the plan layer is
 * where clipboard data first meets the authority partition (ADR 0001/0014/0017):
 *   - file identity (the title column) is a VALID paste target -> "file" authority,
 *     "bulk-rename" mode (routes through the file rename path, never a blind row write).
 *   - computed / read-only columns are ALWAYS rejected ("read-only") and can NEVER
 *     appear as a write (TablePasteWrite.authority is Exclude<PropertyAuthority,
 *     "computed">; enforced structurally AND pinned here behaviorally).
 *   - frontmatter vs notidian authority is resolved per column, never guessed.
 *
 * Pins are characterization (current behavior locked), established by tracing the
 * implementation directly. The closing block is a deterministic PROPERTY test: over
 * a sweep of N x M grids it asserts the plan's write+rejection cardinality exactly
 * matches what the executor will consume — no off-by-one between plan and execution.
 */
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { notidianPropertySource } from "core/utils/properties/propertyAuthority";
import { PathPropertyName } from "shared/types/context";
import { CellSelection } from "./tableSelection";
import {
  planTablePaste,
  TablePasteColumn,
  TablePasteWrite,
} from "./tablePastePlan";

const rows = ["0", "1", "2"];

// Column kinds exercised across the suite:
//   File     -> file authority (rename target, valid)
//   status   -> frontmatter (text + frontmatter source)
//   manual   -> notidian (explicit Notidian-owned)
//   Created  -> computed (fileprop) -> always rejected
const columns: TablePasteColumn[] = [
  { id: PathPropertyName, name: PathPropertyName, type: "file" },
  {
    id: "status",
    name: "status",
    type: "text",
    source: frontmatterPropertySource,
  },
  { id: "manual", name: "manual", type: "text", source: notidianPropertySource },
  { id: "Created", name: "Created", type: "fileprop" },
];

const cell = (rowId: string, columnId: string): CellSelection => ({
  anchor: { rowId, columnId },
  focus: { rowId, columnId },
  active: { rowId, columnId },
});

const range = (
  anchor: [string, string],
  focus: [string, string]
): CellSelection => ({
  anchor: { rowId: anchor[0], columnId: anchor[1] },
  focus: { rowId: focus[0], columnId: focus[1] },
  active: { rowId: anchor[0], columnId: anchor[1] },
});

describe("planTablePaste — ragged rows (pad / spill / rectangularize)", () => {
  it("pads a SHORT clipboard row: missing trailing cells become empty-string writes (not rejections)", () => {
    // Grid is 2x2 by max width; row 1 is short so its second cell pads to "".
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "status"),
      clipboardGrid: [["a", "b"], ["c"]],
    });

    expect(plan.rejections).toEqual([]);
    expect(plan.writes.map((w) => [w.columnName, w.value])).toEqual([
      ["status", "a"],
      ["manual", "b"],
      ["status", "c"],
      ["manual", ""], // padded from the short ragged row
    ]);
  });

  it("SPILLS a long clipboard row across the rectangle width derived from the widest row", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "status"),
      clipboardGrid: [["a"], ["c", "d"]],
    });

    expect(plan.rejections).toEqual([]);
    expect(plan.writes.map((w) => [w.columnName, w.value])).toEqual([
      ["status", "a"],
      ["manual", ""], // row 0 padded to the widest-row width (2)
      ["status", "c"],
      ["manual", "d"],
    ]);
  });

  it("an empty in-cell ('') and a missing (padded) cell are INDISTINGUISHABLE at the write layer", () => {
    const explicitEmpty = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "status"),
      clipboardGrid: [["a", ""]], // present-but-empty second cell
    });
    const paddedMissing = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "status"),
      // 2-wide rectangle (because of a sibling row), row has only one cell -> pad
      clipboardGrid: [["a"], ["x", "y"]],
    });

    const firstRowOf = (writes: TablePasteWrite[]) =>
      writes.slice(0, 2).map((w) => [w.columnName, w.value]);

    // Both produce a status="a" + manual="" pair for the first source row.
    expect(firstRowOf(explicitEmpty.writes)).toEqual([
      ["status", "a"],
      ["manual", ""],
    ]);
    expect(firstRowOf(paddedMissing.writes)).toEqual([
      ["status", "a"],
      ["manual", ""],
    ]);
  });

  it("CLAMPS cells that spill past the last column into 'out-of-bounds' rejections, not silent loss", () => {
    // Start at the last (computed) column; a 2-wide grid spills one cell off the edge.
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "Created"),
      clipboardGrid: [["x", "y"]],
    });

    // First cell hits the computed column -> read-only; second spills off the right
    // edge -> out-of-bounds. The ROW still exists (rowId "0"), only the column is
    // out of range, so the rejection keeps the row id and blanks the column id.
    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toEqual([
      { rowId: "0", columnId: "Created", value: "x", reason: "read-only" },
      { rowId: "0", columnId: "", value: "y", reason: "out-of-bounds" },
    ]);
  });

  it("CLAMPS cells that spill past the last row into 'out-of-bounds' rejections (rowId empty)", () => {
    // 3 source rows starting at the last data row -> 2 spill below the table.
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("2", "manual"),
      clipboardGrid: [["a"], ["b"], ["c"]],
    });

    expect(plan.writes).toEqual([
      {
        rowId: "2",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "a",
        authority: "notidian",
      },
    ]);
    expect(plan.rejections).toEqual([
      { rowId: "", columnId: "manual", value: "b", reason: "out-of-bounds" },
      { rowId: "", columnId: "manual", value: "c", reason: "out-of-bounds" },
    ]);
  });
});

describe("planTablePaste — embedded TAB/newline/quote payloads survive verbatim into write values", () => {
  it("carries quote characters in a cell value unchanged (no de-quoting)", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "status"),
      clipboardGrid: [['"quoted"']],
    });
    expect(plan.writes[0].value).toBe('"quoted"');
  });

  it("carries a value with surrounding/internal whitespace unchanged (no trimming)", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "status"),
      clipboardGrid: [["  spaced  "]],
    });
    expect(plan.writes[0].value).toBe("  spaced  ");
  });

  it("carries a value containing a literal newline (a cell the parser would have split, but a programmatic grid can hold)", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", "manual"),
      clipboardGrid: [["line1\nline2"]],
    });
    expect(plan.writes[0].value).toBe("line1\nline2");
  });
});

describe("planTablePaste — value coercion is NOT the plan's job (raw strings only)", () => {
  // The plan emits string values verbatim; typed coercion (number/boolean/date/option)
  // happens later in executeTableValueWrites via the injected parseValue. This pins
  // that non-conforming text is NOT rejected or mangled at the plan layer.
  const typedColumns: TablePasteColumn[] = [
    { id: PathPropertyName, name: PathPropertyName, type: "file" },
    { id: "count", name: "count", type: "number", source: frontmatterPropertySource },
    { id: "done", name: "done", type: "boolean", source: frontmatterPropertySource },
    { id: "due", name: "due", type: "date", source: frontmatterPropertySource },
    { id: "pri", name: "pri", type: "option", source: frontmatterPropertySource },
  ];

  it.each([
    ["count", "not-a-number"],
    ["count", "12abc"],
    ["done", "maybe"],
    ["due", "32/13/2026"],
    ["pri", "unknown-option"],
  ])(
    "passes non-conforming text into a typed %s column verbatim (no plan-level coercion/rejection)",
    (columnId, text) => {
      const plan = planTablePaste({
        rowOrder: rows,
        columns: typedColumns,
        selection: cell("0", columnId),
        clipboardGrid: [[text]],
      });
      expect(plan.rejections).toEqual([]);
      expect(plan.writes).toHaveLength(1);
      expect(plan.writes[0].value).toBe(text);
      expect(plan.writes[0].columnName).toBe(columnId);
      // The typed column resolves to its frontmatter home, not silently to notidian.
      expect(plan.writes[0].authority).toBe("frontmatter");
    }
  );
});

describe("planTablePaste — AUTHORITY guardrails (the security/parity core)", () => {
  it("NEVER emits a write whose authority is 'computed' (structural + behavioral)", () => {
    // Sweep the whole table from row 0 col 0 with a single value -> fills every cell.
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: range(["0", PathPropertyName], ["2", "Created"]),
      clipboardGrid: [["v"]],
    });
    for (const write of plan.writes) {
      expect(write.authority).not.toBe("computed");
      expect(["file", "frontmatter", "notidian"]).toContain(write.authority);
    }
  });

  it("rejects EVERY computed-column target as read-only, never a write", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: range(["0", "Created"], ["2", "Created"]),
      clipboardGrid: [["x"]],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toHaveLength(3);
    expect(plan.rejections.every((r) => r.reason === "read-only")).toBe(true);
    expect(plan.rejections.map((r) => r.columnId)).toEqual([
      "Created",
      "Created",
      "Created",
    ]);
  });

  it("treats the file-identity (title) column as a VALID rename target, not a blind value write", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("0", PathPropertyName),
      clipboardGrid: [["Renamed Page"]],
    });
    expect(plan.mode).toBe("bulk-rename");
    expect(plan.writes).toEqual([
      {
        rowId: "0",
        columnId: PathPropertyName,
        columnName: PathPropertyName,
        table: "",
        value: "Renamed Page",
        authority: "file",
      },
    ]);
  });

  it("classifies a mixed file + non-file selection as 'mixed' mode (so the caller routes both paths)", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: range(["0", PathPropertyName], ["0", "manual"]),
      clipboardGrid: [["title", "s", "m"]],
    });
    expect(plan.mode).toBe("mixed");
    expect(plan.writes.map((w) => w.authority)).toEqual([
      "file",
      "frontmatter",
      "notidian",
    ]);
  });

  it("rejects a paste whose active cell is not in the row/column order (out-of-bounds, no writes)", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: cell("does-not-exist", "status"),
      clipboardGrid: [["v"]],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toEqual([
      {
        rowId: "does-not-exist",
        columnId: "status",
        value: "v",
        reason: "out-of-bounds",
      },
    ]);
  });

  it("rejects a stale multi-cell range whose row ids are no longer visible (no snap to first row)", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "old-a", columnId: "status" },
        focus: { rowId: "old-b", columnId: "manual" },
        active: { rowId: "old-a", columnId: "status" },
      },
      clipboardGrid: [["v"]],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toEqual([
      {
        rowId: "old-a",
        columnId: "status",
        value: "v",
        reason: "out-of-bounds",
      },
    ]);
  });

  it("rejects a non-repeatable multi-cell range as a single 'non-repeatable-range' (atomic, no partial writes)", () => {
    // 3-row selection, 2-row source -> 3 % 2 != 0 -> reject the whole paste.
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: range(["0", "status"], ["2", "status"]),
      clipboardGrid: [["a"], ["b"]],
    });
    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toEqual([
      {
        rowId: "0",
        columnId: "status",
        value: "a",
        reason: "non-repeatable-range",
      },
    ]);
  });
});

describe("planTablePaste — PROPERTY: plan cardinality == executor expectation over N x M grids", () => {
  // Deterministic generative sweep (no fast-check dependency; fully offline).
  //
  // INVARIANT: when pasting an N x M grid from the top-left writable, in-bounds cell
  // into a table tall/wide enough to hold it, every source cell becomes exactly one
  // plan entry (write OR rejection) — never lost, never duplicated. i.e.
  //   writes + rejections == N * M, and there is no off-by-one between the plan's
  //   per-cell loop and the executor's per-write consumption.
  const wideRows = ["0", "1", "2", "3", "4", "5"];
  // 4 writable columns + 1 trailing computed column (so some cells reject).
  const wideColumns: TablePasteColumn[] = [
    { id: "a", name: "a", type: "text", source: frontmatterPropertySource },
    { id: "b", name: "b", type: "text", source: notidianPropertySource },
    { id: "c", name: "c", type: "text", source: frontmatterPropertySource },
    { id: "d", name: "d", type: "text", source: notidianPropertySource },
    { id: "ro", name: "ro", type: "aggregate" }, // computed
  ];

  for (let n = 1; n <= 5; n++) {
    for (let m = 1; m <= 5; m++) {
      it(`N=${n} x M=${m}: writes + rejections === N*M and no duplicate cell coverage`, () => {
        const grid = Array.from({ length: n }, (_, r) =>
          Array.from({ length: m }, (_, c) => `r${r}c${c}`)
        );
        const plan = planTablePaste({
          rowOrder: wideRows,
          columns: wideColumns,
          selection: cell("0", "a"), // top-left writable cell
          clipboardGrid: grid,
        });

        // 1) Total accounting: every source cell is accounted for exactly once.
        expect(plan.writes.length + plan.rejections.length).toBe(n * m);

        // 2) No write targets a computed column and none carries computed authority.
        for (const w of plan.writes) {
          expect(w.authority).not.toBe("computed");
        }

        // 3) Executor consumes EXACTLY the in-bounds writable cells. The grid starts
        //    at column index 0; column index 4 ("ro") is computed. So per row, cells
        //    landing on column 4 reject as read-only; cells past column 4 reject as
        //    out-of-bounds. Compute the expected writable count and assert the
        //    executor would see precisely that many root writes.
        const startCol = 0;
        const writableColIndexes = wideColumns
          .map((col, idx) => ({ col, idx }))
          .filter(({ col }) => col.type !== "aggregate")
          .map(({ idx }) => idx);
        let expectedWrites = 0;
        for (let c = 0; c < m; c++) {
          const targetCol = startCol + c;
          if (writableColIndexes.includes(targetCol)) expectedWrites += n;
        }
        expect(plan.writes.length).toBe(expectedWrites);

        // 4) Round-trip the plan through the executor's expectation: each write maps
        //    to a unique (rowId, columnId) within the plan — no off-by-one dupes.
        const keys = plan.writes.map((w) => `${w.rowId}:${w.columnId}`);
        expect(new Set(keys).size).toBe(keys.length);
      });
    }
  }
});
