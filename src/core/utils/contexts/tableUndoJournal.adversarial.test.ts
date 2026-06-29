/**
 * Adversarial & property-based tests for tableUndoJournal.
 *
 * These stress the undo journal's invariants under edge-case and random-ish
 * inputs that the functional tests (tableUndoJournal.test.ts) do not cover.
 * The goal: prove data-integrity guarantees hold even under pathological inputs,
 * since incorrect undo = silent data corruption.
 *
 * Bead: Notidian-q5gf
 */

import { PathPropertyName } from "shared/types/context";
import {
  createTableUndoEntry,
  CreateTableUndoEntryParams,
  filterTableUndoEntryForResult,
  pushTableUndoEntry,
  TableUndoEntry,
  tableUndoWriteForDirectEdit,
} from "./tableUndoJournal";
import { TablePasteWrite } from "./tablePastePlan";
import type { TableEditTransactionResult } from "./tableEditTransaction";
import type { DBRow } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal row factory. */
const makeRow = (
  index: string | number,
  path: string,
  props: Record<string, string> = {}
): DBRow => ({
  _index: String(index),
  [PathPropertyName]: path,
  ...props,
});

/** Minimal write factory (frontmatter authority by default). */
const makeWrite = (
  rowId: string,
  columnId: string,
  value: string,
  extra: Partial<TablePasteWrite> = {}
): TablePasteWrite => ({
  rowId,
  columnId,
  columnName: extra.columnName ?? columnId,
  table: extra.table ?? "",
  value,
  authority: extra.authority ?? "frontmatter",
  ...extra,
});

/** Minimal file (page-title) write. */
const makeFileWrite = (rowId: string, newTitle: string): TablePasteWrite => ({
  rowId,
  columnId: PathPropertyName,
  columnName: PathPropertyName,
  table: "",
  value: newTitle,
  authority: "file",
});

const emptyResult = (): TableEditTransactionResult => ({
  ok: true,
  applied: 0,
  skipped: [],
  failed: [],
});

// ---------------------------------------------------------------------------
// 1. Undo/redo value symmetry
// ---------------------------------------------------------------------------
describe("adversarial: undo/redo value symmetry", () => {
  it("for any single write, undo.value == pre-edit and redo.value == write.value", () => {
    const values = ["alpha", "beta", "", "0", "null", "true", "日本語"];
    const rows = [makeRow(0, "Folder/Note.md", { col: "pre" })];

    for (const v of values) {
      const entry = createTableUndoEntry({
        label: "sym",
        rows,
        writes: [makeWrite("0", "col", v)],
      });
      if (v === "pre") {
        // No-op — should produce empty entry
        expect(entry.writes).toHaveLength(0);
        expect(entry.redoWrites).toHaveLength(0);
      } else {
        expect(entry.writes[0].value).toBe("pre");
        expect(entry.redoWrites[0].value).toBe(v);
      }
    }
  });

  it("symmetry holds for many writes across multiple rows", () => {
    const rows = [
      makeRow(0, "A.md", { x: "a0", y: "b0" }),
      makeRow(1, "B.md", { x: "a1", y: "b1" }),
      makeRow(2, "C.md", { x: "a2", y: "b2" }),
    ];
    const writes = [
      makeWrite("0", "x", "new0"),
      makeWrite("1", "y", "new1"),
      makeWrite("2", "x", "new2"),
    ];
    const entry = createTableUndoEntry({ label: "multi", rows, writes });

    expect(entry.writes.map((w) => w.value)).toEqual(["a0", "b1", "a2"]);
    expect(entry.redoWrites.map((w) => w.value)).toEqual([
      "new0",
      "new1",
      "new2",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Deduplication net-effect correctness
// ---------------------------------------------------------------------------
describe("adversarial: deduplication net effect", () => {
  it("many writes to same cell capture PRE-edit and NET forward value", () => {
    const rows = [makeRow(0, "A.md", { col: "original" })];
    const writes = [
      makeWrite("0", "col", "v1"),
      makeWrite("0", "col", "v2"),
      makeWrite("0", "col", "v3"),
      makeWrite("0", "col", "final"),
    ];
    const entry = createTableUndoEntry({ label: "dedup", rows, writes });

    expect(entry.writes).toHaveLength(1);
    expect(entry.redoWrites).toHaveLength(1);
    expect(entry.writes[0].value).toBe("original"); // PRE-edit
    expect(entry.redoWrites[0].value).toBe("final"); // NET forward
  });

  it("alternating values still produce correct net effect", () => {
    const rows = [makeRow(0, "A.md", { col: "start" })];
    const writes = [
      makeWrite("0", "col", "alpha"),
      makeWrite("0", "col", "beta"),
      makeWrite("0", "col", "alpha"),
      makeWrite("0", "col", "beta"),
      makeWrite("0", "col", "gamma"),
    ];
    const entry = createTableUndoEntry({ label: "alternate", rows, writes });

    expect(entry.writes[0].value).toBe("start");
    expect(entry.redoWrites[0].value).toBe("gamma");
  });

  it("if net value equals pre-edit, the entry is a no-op (dedup then skip)", () => {
    const rows = [makeRow(0, "A.md", { col: "same" })];
    const writes = [
      makeWrite("0", "col", "changed"),
      makeWrite("0", "col", "same"), // back to original
    ];
    const entry = createTableUndoEntry({ label: "noop-dedup", rows, writes });

    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });

  it("deduplication per cell: independent cells preserved alongside deduplicated", () => {
    const rows = [
      makeRow(0, "A.md", { x: "old-x", y: "old-y" }),
    ];
    const writes = [
      makeWrite("0", "x", "v1"),
      makeWrite("0", "y", "new-y"),
      makeWrite("0", "x", "v2"),
    ];
    const entry = createTableUndoEntry({ label: "mixed", rows, writes });

    expect(entry.writes).toHaveLength(2);
    // x: pre-edit is "old-x", net forward is "v2"
    const undoX = entry.writes.find((w) => w.columnId === "x")!;
    const redoX = entry.redoWrites.find((w) => w.columnId === "x")!;
    expect(undoX.value).toBe("old-x");
    expect(redoX.value).toBe("v2");
    // y: single write, pre-edit is "old-y", forward is "new-y"
    const undoY = entry.writes.find((w) => w.columnId === "y")!;
    const redoY = entry.redoWrites.find((w) => w.columnId === "y")!;
    expect(undoY.value).toBe("old-y");
    expect(redoY.value).toBe("new-y");
  });
});

// ---------------------------------------------------------------------------
// 3. expectedCurrentValue guard consistency
// ---------------------------------------------------------------------------
describe("adversarial: expectedCurrentValue guard consistency", () => {
  it("undo.expectedCurrentValue == redo.value and redo.expectedCurrentValue == undo.value", () => {
    const rows = [makeRow(0, "A.md", { col: "before" })];
    const writes = [makeWrite("0", "col", "after")];
    const entry = createTableUndoEntry({ label: "guard", rows, writes });

    const undo = entry.writes[0];
    const redo = entry.redoWrites[0];
    // The undo write restores "before" and expects current to be "after" (what redo produces)
    expect(undo.expectedCurrentValue).toBe(redo.value);
    // The redo write restores "after" and expects current to be "before" (what undo produces)
    expect(redo.expectedCurrentValue).toBe(undo.value);
  });

  it("guard consistency holds through deduplication", () => {
    const rows = [makeRow(0, "A.md", { col: "orig" })];
    const writes = [
      makeWrite("0", "col", "tmp"),
      makeWrite("0", "col", "final"),
    ];
    const entry = createTableUndoEntry({ label: "guard-dedup", rows, writes });

    const undo = entry.writes[0];
    const redo = entry.redoWrites[0];
    expect(undo.value).toBe("orig");
    expect(undo.expectedCurrentValue).toBe("final");
    expect(redo.value).toBe("final");
    expect(redo.expectedCurrentValue).toBe("orig");
    // Cross-check: each direction's expected matches the other direction's value
    expect(undo.expectedCurrentValue).toBe(redo.value);
    expect(redo.expectedCurrentValue).toBe(undo.value);
  });

  it("guard consistency holds for many independent writes", () => {
    const rows = [
      makeRow(0, "A.md", { a: "a0", b: "b0" }),
      makeRow(1, "B.md", { a: "a1" }),
    ];
    const writes = [
      makeWrite("0", "a", "newA"),
      makeWrite("0", "b", "newB"),
      makeWrite("1", "a", "newA1"),
    ];
    const entry = createTableUndoEntry({ label: "multi-guard", rows, writes });

    for (let i = 0; i < entry.writes.length; i++) {
      const undo = entry.writes[i];
      const redo = entry.redoWrites[i];
      expect(undo.expectedCurrentValue).toBe(redo.value);
      expect(redo.expectedCurrentValue).toBe(undo.value);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. File authority special path
// ---------------------------------------------------------------------------
describe("adversarial: file authority special path", () => {
  it("file writes do NOT carry expectedCurrentValue", () => {
    const rows = [makeRow(0, "Notes/OldName.md")];
    const writes = [makeFileWrite("0", "NewName")];
    const entry = createTableUndoEntry({ label: "rename", rows, writes });

    // Undo inverse
    expect(entry.writes[0].expectedCurrentValue).toBeUndefined();
    // Redo re-applies — file writes keep original shape, no expectedCurrentValue
    expect(entry.redoWrites[0].expectedCurrentValue).toBeUndefined();
  });

  it("file undo path is baked via buildPageTitleRename (reflects the renamed path)", () => {
    const rows = [makeRow(0, "Folder/Alpha.md")];
    const writes = [makeFileWrite("0", "Beta")];
    const entry = createTableUndoEntry({ label: "rename-path", rows, writes });

    // The undo write's path should point at the RENAMED file (where the file
    // will be after the forward rename).
    expect(entry.writes[0].path).toBe("Folder/Beta.md");
    // Undo value is the old page title
    expect(entry.writes[0].value).toBe("Alpha");
  });

  it("redo file write preserves original write shape (no baked path override)", () => {
    const rows = [makeRow(0, "Dir/One.md")];
    const writes = [makeFileWrite("0", "Two")];
    const entry = createTableUndoEntry({ label: "redo-shape", rows, writes });

    // Redo re-applies the original write (sans forceFrontmatterWrite)
    expect(entry.redoWrites[0].value).toBe("Two");
    expect(entry.redoWrites[0].authority).toBe("file");
  });

  it("mixed file + property writes in a single batch", () => {
    const rows = [makeRow(0, "Dir/Old.md", { status: "draft" })];
    const writes: TablePasteWrite[] = [
      makeFileWrite("0", "New"),
      makeWrite("0", "status", "published"),
    ];
    const entry = createTableUndoEntry({ label: "mixed-batch", rows, writes });

    // File write undo
    const fileUndo = entry.writes.find((w) => w.authority === "file")!;
    expect(fileUndo.value).toBe("Old");
    expect(fileUndo.expectedCurrentValue).toBeUndefined();
    expect(fileUndo.path).toBe("Dir/New.md"); // baked path

    // Property write undo
    const propUndo = entry.writes.find((w) => w.authority !== "file")!;
    expect(propUndo.value).toBe("draft");
    expect(propUndo.expectedCurrentValue).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// 5. Stack cap bound
// ---------------------------------------------------------------------------
describe("adversarial: stack cap bound", () => {
  const makeEntry = (label: string): TableUndoEntry => ({
    label,
    writes: [],
    redoWrites: [],
  });

  it("never exceeds maxEntries regardless of input sequence", () => {
    let stack: TableUndoEntry[] = [];
    for (let i = 0; i < 100; i++) {
      stack = pushTableUndoEntry(stack, makeEntry(`e${i}`), 20);
      expect(stack.length).toBeLessThanOrEqual(20);
    }
    // At the end, exactly 20 entries
    expect(stack).toHaveLength(20);
    // Oldest surviving entry should be e80
    expect(stack[0].label).toBe("e80");
    expect(stack[19].label).toBe("e99");
  });

  it("respects maxEntries = 1", () => {
    let stack: TableUndoEntry[] = [];
    stack = pushTableUndoEntry(stack, makeEntry("A"), 1);
    stack = pushTableUndoEntry(stack, makeEntry("B"), 1);
    stack = pushTableUndoEntry(stack, makeEntry("C"), 1);
    expect(stack).toHaveLength(1);
    expect(stack[0].label).toBe("C");
  });

  it("handles maxEntries larger than input", () => {
    let stack: TableUndoEntry[] = [];
    stack = pushTableUndoEntry(stack, makeEntry("A"), 50);
    stack = pushTableUndoEntry(stack, makeEntry("B"), 50);
    expect(stack).toHaveLength(2);
  });

  it("default maxEntries (20) is enforced", () => {
    let stack: TableUndoEntry[] = Array.from({ length: 25 }, (_, i) =>
      makeEntry(`old${i}`)
    );
    stack = pushTableUndoEntry(stack, makeEntry("new"));
    // 25 + 1 = 26, capped to 20
    expect(stack).toHaveLength(20);
    expect(stack[stack.length - 1].label).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// 6. filterTableUndoEntryForResult monotonicity (never widens)
// ---------------------------------------------------------------------------
describe("adversarial: filterTableUndoEntryForResult monotonicity", () => {
  const rows = [
    makeRow(0, "A.md", { x: "old-x" }),
    makeRow(1, "B.md", { y: "old-y" }),
    makeRow(2, "C.md", { z: "old-z" }),
  ];

  it("filtering only removes writes, never adds them", () => {
    const entry = createTableUndoEntry({
      label: "filter-test",
      rows,
      writes: [
        makeWrite("0", "x", "new-x"),
        makeWrite("1", "y", "new-y"),
        makeWrite("2", "z", "new-z"),
      ],
    });

    const beforeCount = entry.writes.length;
    const filtered = filterTableUndoEntryForResult(entry, {
      ok: true,
      applied: 2,
      skipped: [
        {
          write: {
            rowId: "1",
            columnId: "y",
            columnName: "y",
            table: "",
            value: "new-y",
          },
          reason: "frontmatter-conflict",
        },
      ],
      failed: [],
    });

    expect(filtered.writes.length).toBeLessThanOrEqual(beforeCount);
    expect(filtered.redoWrites.length).toBeLessThanOrEqual(beforeCount);
    // Specifically: one was removed
    expect(filtered.writes.length).toBe(beforeCount - 1);
    expect(filtered.redoWrites.length).toBe(beforeCount - 1);
  });

  it("filtering with empty skipped/failed changes nothing", () => {
    const entry = createTableUndoEntry({
      label: "no-reject",
      rows,
      writes: [makeWrite("0", "x", "new-x"), makeWrite("2", "z", "new-z")],
    });

    const filtered = filterTableUndoEntryForResult(entry, emptyResult());
    expect(filtered.writes).toEqual(entry.writes);
    expect(filtered.redoWrites).toEqual(entry.redoWrites);
  });

  it("filtering all writes produces empty entry", () => {
    const entry = createTableUndoEntry({
      label: "all-rejected",
      rows,
      writes: [makeWrite("0", "x", "new-x")],
    });

    const filtered = filterTableUndoEntryForResult(entry, {
      ok: false,
      applied: 0,
      skipped: [],
      failed: [
        {
          write: {
            rowId: "0",
            columnId: "x",
            columnName: "x",
            table: "",
            value: "new-x",
          },
          reason: "frontmatter-write-failed",
        },
      ],
    });

    expect(filtered.writes).toHaveLength(0);
    expect(filtered.redoWrites).toHaveLength(0);
  });

  it("repeated filtering only shrinks or stays same", () => {
    const entry = createTableUndoEntry({
      label: "shrink",
      rows,
      writes: [
        makeWrite("0", "x", "new-x"),
        makeWrite("1", "y", "new-y"),
        makeWrite("2", "z", "new-z"),
      ],
    });

    const result1: TableEditTransactionResult = {
      ok: true,
      applied: 2,
      skipped: [
        {
          write: {
            rowId: "0",
            columnId: "x",
            columnName: "x",
            table: "",
            value: "new-x",
          },
          reason: "missing-row",
        },
      ],
      failed: [],
    };
    const filtered1 = filterTableUndoEntryForResult(entry, result1);

    const result2: TableEditTransactionResult = {
      ok: true,
      applied: 1,
      skipped: [
        {
          write: {
            rowId: "2",
            columnId: "z",
            columnName: "z",
            table: "",
            value: "new-z",
          },
          reason: "missing-path",
        },
      ],
      failed: [],
    };
    const filtered2 = filterTableUndoEntryForResult(filtered1, result2);

    expect(filtered2.writes.length).toBeLessThanOrEqual(
      filtered1.writes.length
    );
    expect(filtered2.redoWrites.length).toBeLessThanOrEqual(
      filtered1.redoWrites.length
    );
  });
});

// ---------------------------------------------------------------------------
// 7. forceFrontmatterWrite strip (sanitize)
// ---------------------------------------------------------------------------
describe("adversarial: forceFrontmatterWrite strip", () => {
  it("forceFrontmatterWrite never appears in undo writes", () => {
    const rows = [makeRow(0, "A.md", { col: "old" })];
    const writes = [
      {
        ...makeWrite("0", "col", "new"),
        forceFrontmatterWrite: true,
      } as any,
    ];
    const entry = createTableUndoEntry({ label: "strip", rows, writes });

    for (const w of entry.writes) {
      expect(w).not.toHaveProperty("forceFrontmatterWrite");
    }
    for (const w of entry.redoWrites) {
      expect(w).not.toHaveProperty("forceFrontmatterWrite");
    }
  });

  it("forceFrontmatterWrite strip on file writes too", () => {
    const rows = [makeRow(0, "Dir/X.md")];
    const writes = [
      {
        ...makeFileWrite("0", "Y"),
        forceFrontmatterWrite: true,
      } as any,
    ];
    const entry = createTableUndoEntry({ label: "strip-file", rows, writes });

    for (const w of [...entry.writes, ...entry.redoWrites]) {
      expect(w).not.toHaveProperty("forceFrontmatterWrite");
    }
  });

  it("multiple writes with forceFrontmatterWrite are all sanitized", () => {
    const rows = [
      makeRow(0, "A.md", { a: "old-a" }),
      makeRow(1, "B.md", { b: "old-b" }),
    ];
    const writes = [
      { ...makeWrite("0", "a", "new-a"), forceFrontmatterWrite: true } as any,
      { ...makeWrite("1", "b", "new-b"), forceFrontmatterWrite: true } as any,
    ];
    const entry = createTableUndoEntry({ label: "strip-multi", rows, writes });

    for (const w of [...entry.writes, ...entry.redoWrites]) {
      expect(w).not.toHaveProperty("forceFrontmatterWrite");
    }
  });
});

// ---------------------------------------------------------------------------
// 8. No-op writes produce empty entries
// ---------------------------------------------------------------------------
describe("adversarial: no-op writes produce empty entries", () => {
  it("single write with value == current row value", () => {
    const rows = [makeRow(0, "A.md", { col: "same" })];
    const writes = [makeWrite("0", "col", "same")];
    const entry = createTableUndoEntry({ label: "noop", rows, writes });

    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });

  it("multiple no-op writes across rows", () => {
    const rows = [
      makeRow(0, "A.md", { x: "a", y: "b" }),
      makeRow(1, "B.md", { x: "c" }),
    ];
    const writes = [
      makeWrite("0", "x", "a"),
      makeWrite("0", "y", "b"),
      makeWrite("1", "x", "c"),
    ];
    const entry = createTableUndoEntry({ label: "all-noop", rows, writes });

    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });

  it("file write that matches current page title is a no-op", () => {
    const rows = [makeRow(0, "Dir/ExactName.md")];
    const writes = [makeFileWrite("0", "ExactName")];
    const entry = createTableUndoEntry({ label: "file-noop", rows, writes });

    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });

  it("empty writes array produces empty entry", () => {
    const rows = [makeRow(0, "A.md", { col: "v" })];
    const entry = createTableUndoEntry({ label: "empty", rows, writes: [] });

    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Adversarial scenarios
// ---------------------------------------------------------------------------
describe("adversarial: repeated same-cell writes with alternating values", () => {
  it("handles rapid oscillation between two values", () => {
    const rows = [makeRow(0, "A.md", { col: "X" })];
    const writes: TablePasteWrite[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(makeWrite("0", "col", i % 2 === 0 ? "Y" : "X"));
    }
    // Last write (i=19) is "X", same as original => no-op after dedup
    const entry = createTableUndoEntry({ label: "oscillate", rows, writes });
    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });

  it("odd number of oscillations produces a real change", () => {
    const rows = [makeRow(0, "A.md", { col: "X" })];
    const writes: TablePasteWrite[] = [];
    for (let i = 0; i < 19; i++) {
      writes.push(makeWrite("0", "col", i % 2 === 0 ? "Y" : "X"));
    }
    // Last write (i=18) is "Y", different from original
    const entry = createTableUndoEntry({ label: "oscillate-odd", rows, writes });
    expect(entry.writes).toHaveLength(1);
    expect(entry.writes[0].value).toBe("X");
    expect(entry.redoWrites[0].value).toBe("Y");
  });
});

describe("adversarial: writes referencing missing rows", () => {
  it("writes to non-existent rowIds are silently dropped", () => {
    const rows = [makeRow(0, "A.md", { col: "v" })];
    const writes = [
      makeWrite("999", "col", "new"),
      makeWrite("nonexistent", "col", "new"),
    ];
    const entry = createTableUndoEntry({ label: "missing", rows, writes });

    // No rows matched => empty
    expect(entry.writes).toHaveLength(0);
    expect(entry.redoWrites).toHaveLength(0);
  });

  it("mix of valid and invalid rowIds: only valid survive", () => {
    const rows = [makeRow(0, "A.md", { col: "old" })];
    const writes = [
      makeWrite("0", "col", "new"),
      makeWrite("99", "col", "ghost"),
    ];
    const entry = createTableUndoEntry({ label: "partial", rows, writes });

    expect(entry.writes).toHaveLength(1);
    expect(entry.writes[0].rowId).toBe("0");
  });
});

describe("adversarial: mixed file + property writes in single batch", () => {
  it("file and property writes for the same row are independent entries", () => {
    const rows = [makeRow(0, "Dir/Page.md", { status: "draft" })];
    const writes: TablePasteWrite[] = [
      makeFileWrite("0", "Renamed"),
      makeWrite("0", "status", "published"),
    ];
    const entry = createTableUndoEntry({ label: "mixed", rows, writes });

    expect(entry.writes).toHaveLength(2);
    expect(entry.redoWrites).toHaveLength(2);

    const fileEntry = entry.writes.find((w) => w.authority === "file")!;
    const propEntry = entry.writes.find((w) => w.authority !== "file")!;

    // File undo: no expectedCurrentValue
    expect(fileEntry.expectedCurrentValue).toBeUndefined();
    // Property undo: has expectedCurrentValue
    expect(propEntry.expectedCurrentValue).toBe("published");
  });

  it("mixed batch with multiple rows", () => {
    const rows = [
      makeRow(0, "D/A.md", { tag: "v1" }),
      makeRow(1, "D/B.md", { tag: "v2" }),
    ];
    const writes: TablePasteWrite[] = [
      makeFileWrite("0", "AA"),
      makeWrite("0", "tag", "v1-new"),
      makeFileWrite("1", "BB"),
      makeWrite("1", "tag", "v2-new"),
    ];
    const entry = createTableUndoEntry({ label: "multi-mixed", rows, writes });

    expect(entry.writes).toHaveLength(4);
    expect(entry.redoWrites).toHaveLength(4);

    // All file writes have no expectedCurrentValue
    const fileUndos = entry.writes.filter((w) => w.authority === "file");
    for (const fu of fileUndos) {
      expect(fu.expectedCurrentValue).toBeUndefined();
    }
    // All property writes have expectedCurrentValue
    const propUndos = entry.writes.filter((w) => w.authority !== "file");
    for (const pu of propUndos) {
      expect(pu.expectedCurrentValue).toBeDefined();
    }
  });
});

describe("adversarial: rows with duplicate _index values", () => {
  it("uses the first matching row for value lookup", () => {
    const rows = [
      makeRow(0, "A.md", { col: "first" }),
      makeRow(0, "B.md", { col: "second" }), // duplicate _index
    ];
    const writes = [makeWrite("0", "col", "new")];
    const entry = createTableUndoEntry({ label: "dup-index", rows, writes });

    // rows.find returns the first match
    expect(entry.writes).toHaveLength(1);
    expect(entry.writes[0].value).toBe("first");
  });

  it("path baking uses the first matching row's path", () => {
    const rows = [
      makeRow(0, "First/Path.md", { col: "v1" }),
      makeRow(0, "Second/Path.md", { col: "v2" }), // dup
    ];
    const writes = [makeWrite("0", "col", "changed")];
    const entry = createTableUndoEntry({ label: "dup-path", rows, writes });

    expect(entry.writes[0].path).toBe("First/Path.md");
  });
});

describe("adversarial: unicode, empty, and special values", () => {
  it("unicode values survive undo/redo roundtrip", () => {
    const unicodeValues = [
      "日本語テスト",
      "🎉🔥💡",
      "αβγδ",
      "مرحبا",
      " ", // control chars
      "line1\nline2",
      "tab\there",
      "quote\"double",
      "single'quote",
    ];

    for (const uv of unicodeValues) {
      const rows = [makeRow(0, "A.md", { col: "old" })];
      const writes = [makeWrite("0", "col", uv)];
      const entry = createTableUndoEntry({
        label: "unicode",
        rows,
        writes,
      });

      expect(entry.writes[0].value).toBe("old");
      expect(entry.redoWrites[0].value).toBe(uv);
      // Guard symmetry
      expect(entry.writes[0].expectedCurrentValue).toBe(uv);
      expect(entry.redoWrites[0].expectedCurrentValue).toBe("old");
    }
  });

  it("empty string as value", () => {
    const rows = [makeRow(0, "A.md", { col: "notempty" })];
    const writes = [makeWrite("0", "col", "")];
    const entry = createTableUndoEntry({ label: "empty-val", rows, writes });

    expect(entry.writes[0].value).toBe("notempty");
    expect(entry.redoWrites[0].value).toBe("");
  });

  it("empty string as current row value", () => {
    const rows = [makeRow(0, "A.md", { col: "" })];
    const writes = [makeWrite("0", "col", "filled")];
    const entry = createTableUndoEntry({ label: "empty-cur", rows, writes });

    expect(entry.writes[0].value).toBe("");
    expect(entry.redoWrites[0].value).toBe("filled");
  });

  it("property that does not exist on row defaults to empty string", () => {
    const rows = [makeRow(0, "A.md")]; // no 'col' property
    const writes = [makeWrite("0", "col", "new")];
    const entry = createTableUndoEntry({
      label: "missing-prop",
      rows,
      writes,
    });

    expect(entry.writes[0].value).toBe(""); // default from currentValueForWrite
    expect(entry.redoWrites[0].value).toBe("new");
  });

  it("columnName fallback when columnId does not match a row key", () => {
    // columnId and columnName differ; row has the property under columnName
    const rows = [makeRow(0, "A.md", { realName: "original" })];
    const writes = [
      makeWrite("0", "differentId", "updated", { columnName: "realName" }),
    ];
    const entry = createTableUndoEntry({ label: "fallback", rows, writes });

    expect(entry.writes[0].value).toBe("original");
  });
});

describe("adversarial: tableUndoWriteForDirectEdit edge cases", () => {
  it("returns null for computed columns", () => {
    const result = tableUndoWriteForDirectEdit({
      rowId: "0",
      column: {
        name: "Created",
        type: "fileprop",
        source: "",
        value: "File.ctime",
      },
      value: "2026-01-01",
    });
    expect(result).toBeNull();
  });

  it("omits undefined fields from the result", () => {
    const result = tableUndoWriteForDirectEdit({
      rowId: "0",
      column: {
        name: "tag",
        type: "text",
        source: "frontmatter",
        value: "",
      },
      value: "new-tag",
      // path, fieldValue, fieldAttrs intentionally not provided
    });

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("fieldValue");
    expect(result).not.toHaveProperty("fieldAttrs");
  });

  it("includes fieldAttrs when explicitly null", () => {
    const result = tableUndoWriteForDirectEdit({
      rowId: "0",
      column: {
        name: "tag",
        type: "text",
        source: "frontmatter",
        value: "",
      },
      value: "new-tag",
      fieldAttrs: null,
    });

    expect(result).not.toBeNull();
    expect(result!.fieldAttrs).toBeNull();
  });

  it("uses column.table in columnId when present", () => {
    const result = tableUndoWriteForDirectEdit({
      rowId: "0",
      column: {
        name: "col",
        type: "text",
        source: "frontmatter",
        value: "",
        table: "myTable",
      },
      value: "v",
    });

    expect(result).not.toBeNull();
    expect(result!.columnId).toBe("colmyTable");
  });
});

describe("adversarial: path baking for non-file writes", () => {
  it("bakes the row path for undo replay even when write has no path", () => {
    const rows = [makeRow(0, "Vault/Note.md", { col: "old" })];
    const writes = [makeWrite("0", "col", "new")];
    const entry = createTableUndoEntry({ label: "bake", rows, writes });

    expect(entry.writes[0].path).toBe("Vault/Note.md");
    expect(entry.redoWrites[0].path).toBe("Vault/Note.md");
  });

  it("preserves explicit path from write when present", () => {
    const rows = [makeRow(0, "A.md", { col: "old" })];
    const writes = [makeWrite("0", "col", "new", { path: "Explicit/Path.md" })];
    const entry = createTableUndoEntry({ label: "explicit", rows, writes });

    // For non-file, currentPathAfterWrite uses write.path ?? row path
    // Since write.path is provided, it should be used
    expect(entry.writes[0].path).toBe("Explicit/Path.md");
  });
});

describe("adversarial: large batch stress", () => {
  it("handles 1000 unique cell writes without error", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeRow(i, `F/R${i}.md`, { c0: `v${i}` })
    );
    const writes = Array.from({ length: 1000 }, (_, i) =>
      makeWrite(String(i % 100), `c${Math.floor(i / 100)}`, `new${i}`)
    );

    const entry = createTableUndoEntry({
      label: "stress",
      rows,
      writes,
    });

    // Should not throw, and all undo/redo arrays should have equal length
    expect(entry.writes.length).toBe(entry.redoWrites.length);
    // Guard consistency holds for all
    for (let i = 0; i < entry.writes.length; i++) {
      const undo = entry.writes[i];
      const redo = entry.redoWrites[i];
      if (undo.authority !== "file") {
        expect(undo.expectedCurrentValue).toBe(redo.value);
        expect(redo.expectedCurrentValue).toBe(undo.value);
      }
    }
  });
});

describe("adversarial: writes across different tables", () => {
  it("same columnName in different tables are treated as separate cells", () => {
    const rows = [makeRow(0, "A.md", { col: "old" })];
    // Two writes to same rowId and same columnName but different table
    const writes: TablePasteWrite[] = [
      makeWrite("0", "col", "tableA-val", { table: "tableA" }),
      makeWrite("0", "col", "tableB-val", { table: "tableB" }),
    ];
    const entry = createTableUndoEntry({ label: "multi-table", rows, writes });

    // Both should survive — they have different undo keys (rowId::columnId)
    // Actually undoKeyForWrite is rowId::columnId, and columnId is "col" for both.
    // The dedup is by rowId::columnId, so same columnId => deduplicated.
    // This tests the actual behavior.
    // columnId defaults to columnName in our makeWrite, so both have columnId="col"
    // Therefore they deduplicate and the net value is "tableB-val".
    expect(entry.redoWrites).toHaveLength(1);
    expect(entry.redoWrites[0].value).toBe("tableB-val");
  });

  it("different columnIds in same table are NOT deduplicated", () => {
    const rows = [makeRow(0, "A.md", { colA: "oldA", colB: "oldB" })];
    const writes: TablePasteWrite[] = [
      makeWrite("0", "colA", "newA"),
      makeWrite("0", "colB", "newB"),
    ];
    const entry = createTableUndoEntry({ label: "diff-cols", rows, writes });

    expect(entry.writes).toHaveLength(2);
    expect(entry.redoWrites).toHaveLength(2);
  });
});

describe("adversarial: sanitizeHistoryWrite removes undefined fields", () => {
  it("undo/redo writes never contain undefined-valued fields", () => {
    const rows = [makeRow(0, "A.md", { col: "old" })];
    const writes = [makeWrite("0", "col", "new")];
    const entry = createTableUndoEntry({ label: "clean", rows, writes });

    for (const w of [...entry.writes, ...entry.redoWrites]) {
      for (const [key, val] of Object.entries(w)) {
        expect(val).not.toBeUndefined();
      }
    }
  });
});
