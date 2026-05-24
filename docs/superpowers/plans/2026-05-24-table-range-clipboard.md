# Table Range Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notion/Excel-style rectangular cell selection, TSV copy/cut/paste, and authority-aware batch writes to Notidian context tables.

**Architecture:** Build pure table clipboard, selection, and paste-planning utilities first. Integrate those utilities into `TableView.tsx`, then route planned writes through a `ContextEditorContext` batch API that delegates to frontmatter writes, context MDB writes, and page-title rename transactions.

**Tech Stack:** TypeScript, React, TanStack Table, Jest, Obsidian/Notidian `Superstate`, existing property authority helpers.

---

## File Structure

- Create `src/core/utils/contexts/tableClipboard.ts`: parse and serialize TSV clipboard grids.
- Create `src/core/utils/contexts/tableClipboard.test.ts`: unit tests for TSV behavior.
- Create `src/core/utils/contexts/tableSelection.ts`: cell coordinate, rectangle, keyboard movement, and range helpers.
- Create `src/core/utils/contexts/tableSelection.test.ts`: unit tests for range selection behavior.
- Create `src/core/utils/contexts/tablePastePlan.ts`: authority-aware paste expansion and write/rejection planning.
- Create `src/core/utils/contexts/tablePastePlan.test.ts`: unit tests for fill, expansion, truncation, and authority decisions.
- Modify `src/core/utils/contexts/pageTitleRename.ts`: add bulk page-title rename preflight and execution helpers.
- Modify `src/core/utils/contexts/pageTitleRename.test.ts`: add bulk rename tests.
- Modify `src/core/react/context/ContextEditorContext.tsx`: expose `applyTableEdits` for batch execution.
- Modify `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`: replace single selected-cell clipboard behavior with rectangular cell selection and batch paste.
- Modify `src/css/SpaceViewer/TableView.css`: add selected-range, active-cell, and pending/error cell styles.
- Modify `docs/adr/0003-editable-page-titles-through-file-renames.md`: add note that bulk title paste uses the same rename authority model.
- Modify `docs/README.md`: add the implementation plan link.

## Task 1: TSV Clipboard Utilities

**Files:**
- Create: `src/core/utils/contexts/tableClipboard.ts`
- Test: `src/core/utils/contexts/tableClipboard.test.ts`

- [ ] **Step 1: Write failing clipboard tests**

Create `src/core/utils/contexts/tableClipboard.test.ts`:

```ts
import {
  parseTableClipboardText,
  serializeTableClipboardGrid,
} from "./tableClipboard";

describe("tableClipboard", () => {
  it("parses tab and newline delimited clipboard text", () => {
    expect(parseTableClipboardText("A\tB\nC\tD")).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("normalizes CRLF line endings and trims only the final clipboard newline", () => {
    expect(parseTableClipboardText("A\tB\r\nC\t\r\n")).toEqual([
      ["A", "B"],
      ["C", ""],
    ]);
  });

  it("serializes rectangular values as TSV", () => {
    expect(
      serializeTableClipboardGrid([
        ["A", "B"],
        ["C", "D"],
      ])
    ).toBe("A\tB\nC\tD");
  });

  it("converts nullish values to empty strings when serializing", () => {
    expect(serializeTableClipboardGrid([["A", null as any, undefined as any]])).toBe(
      "A\t\t"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/core/utils/contexts/tableClipboard.test.ts --runInBand
```

Expected: fail because `tableClipboard.ts` does not exist.

- [ ] **Step 3: Implement minimal clipboard utilities**

Create `src/core/utils/contexts/tableClipboard.ts`:

```ts
export type TableClipboardGrid = string[][];

const trimFinalClipboardNewline = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");

export const parseTableClipboardText = (
  text: string
): TableClipboardGrid => {
  const normalized = trimFinalClipboardNewline(text ?? "");
  if (normalized.length === 0) return [[""]];
  return normalized.split("\n").map((row) => row.split("\t"));
};

export const serializeTableClipboardGrid = (
  grid: unknown[][]
): string =>
  grid
    .map((row) =>
      row.map((cell) => (cell == null ? "" : String(cell))).join("\t")
    )
    .join("\n");
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/core/utils/contexts/tableClipboard.test.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/contexts/tableClipboard.ts src/core/utils/contexts/tableClipboard.test.ts
git commit -m "feat: add table clipboard TSV utilities"
```

## Task 2: Rectangular Selection Utilities

**Files:**
- Create: `src/core/utils/contexts/tableSelection.ts`
- Test: `src/core/utils/contexts/tableSelection.test.ts`

- [ ] **Step 1: Write failing selection tests**

Create `src/core/utils/contexts/tableSelection.test.ts`:

```ts
import {
  CellSelection,
  cellSelectionRange,
  extendCellSelection,
  moveCellSelection,
} from "./tableSelection";

const rows = ["r1", "r2", "r3"];
const columns = ["File", "status", "area"];

describe("tableSelection", () => {
  it("returns the rectangular range between anchor and focus", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r2", columnId: "status" },
      active: { rowId: "r2", columnId: "status" },
    };

    expect(cellSelectionRange(selection, rows, columns)).toEqual([
      { rowId: "r1", columnId: "File" },
      { rowId: "r1", columnId: "status" },
      { rowId: "r2", columnId: "File" },
      { rowId: "r2", columnId: "status" },
    ]);
  });

  it("moves the active cell without extending the selection", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r1", columnId: "File" },
      active: { rowId: "r1", columnId: "File" },
    };

    expect(moveCellSelection(selection, rows, columns, "right")).toEqual({
      anchor: { rowId: "r1", columnId: "status" },
      focus: { rowId: "r1", columnId: "status" },
      active: { rowId: "r1", columnId: "status" },
    });
  });

  it("extends the range while keeping the original anchor", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r1", columnId: "File" },
      active: { rowId: "r1", columnId: "File" },
    };

    expect(extendCellSelection(selection, rows, columns, "down")).toEqual({
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r2", columnId: "File" },
      active: { rowId: "r2", columnId: "File" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/core/utils/contexts/tableSelection.test.ts --runInBand
```

Expected: fail because `tableSelection.ts` does not exist.

- [ ] **Step 3: Implement selection utilities**

Create `src/core/utils/contexts/tableSelection.ts`:

```ts
export type CellCoord = {
  rowId: string;
  columnId: string;
};

export type CellSelection = {
  anchor: CellCoord;
  focus: CellCoord;
  active: CellCoord;
};

export type CellDirection = "up" | "down" | "left" | "right";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const indexOrZero = (value: string, values: string[]): number => {
  const index = values.indexOf(value);
  return index < 0 ? 0 : index;
};

const moveCoord = (
  coord: CellCoord,
  rowOrder: string[],
  columnOrder: string[],
  direction: CellDirection
): CellCoord => {
  const rowIndex = indexOrZero(coord.rowId, rowOrder);
  const columnIndex = indexOrZero(coord.columnId, columnOrder);
  const nextRow =
    direction === "up"
      ? clamp(rowIndex - 1, 0, rowOrder.length - 1)
      : direction === "down"
      ? clamp(rowIndex + 1, 0, rowOrder.length - 1)
      : rowIndex;
  const nextColumn =
    direction === "left"
      ? clamp(columnIndex - 1, 0, columnOrder.length - 1)
      : direction === "right"
      ? clamp(columnIndex + 1, 0, columnOrder.length - 1)
      : columnIndex;

  return {
    rowId: rowOrder[nextRow],
    columnId: columnOrder[nextColumn],
  };
};

export const moveCellSelection = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[],
  direction: CellDirection
): CellSelection => {
  const active = moveCoord(selection.active, rowOrder, columnOrder, direction);
  return { anchor: active, focus: active, active };
};

export const extendCellSelection = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[],
  direction: CellDirection
): CellSelection => {
  const active = moveCoord(selection.active, rowOrder, columnOrder, direction);
  return { ...selection, focus: active, active };
};

export const cellSelectionRange = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[]
): CellCoord[] => {
  const startRow = indexOrZero(selection.anchor.rowId, rowOrder);
  const endRow = indexOrZero(selection.focus.rowId, rowOrder);
  const startColumn = indexOrZero(selection.anchor.columnId, columnOrder);
  const endColumn = indexOrZero(selection.focus.columnId, columnOrder);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  const minColumn = Math.min(startColumn, endColumn);
  const maxColumn = Math.max(startColumn, endColumn);
  const cells: CellCoord[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      cells.push({ rowId: rowOrder[row], columnId: columnOrder[column] });
    }
  }

  return cells;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/core/utils/contexts/tableSelection.test.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/contexts/tableSelection.ts src/core/utils/contexts/tableSelection.test.ts
git commit -m "feat: add table cell selection utilities"
```

## Task 3: Paste Planning Utilities

**Files:**
- Create: `src/core/utils/contexts/tablePastePlan.ts`
- Test: `src/core/utils/contexts/tablePastePlan.test.ts`

- [ ] **Step 1: Write failing paste planning tests**

Create `src/core/utils/contexts/tablePastePlan.test.ts`:

```ts
import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { CellSelection } from "./tableSelection";
import { planTablePaste } from "./tablePastePlan";

const rows = ["0", "1", "2"];
const columns = [
  { id: PathPropertyName, name: PathPropertyName, type: "file" },
  {
    id: "status",
    name: "status",
    type: "text",
    source: frontmatterPropertySource,
  },
  { id: "manual", name: "manual", type: "text" },
  { id: "Created", name: "Created", type: "fileprop" },
];

const singleStatusSelection: CellSelection = {
  anchor: { rowId: "0", columnId: "status" },
  focus: { rowId: "0", columnId: "status" },
  active: { rowId: "0", columnId: "status" },
};

describe("planTablePaste", () => {
  it("expands a multi-cell clipboard grid from the active cell", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: singleStatusSelection,
      clipboardGrid: [
        ["active", "local"],
        ["paused", "remote"],
      ],
    });

    expect(plan.writes).toEqual([
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "active",
        authority: "frontmatter",
      },
      {
        rowId: "0",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "local",
        authority: "notidian",
      },
      {
        rowId: "1",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "paused",
        authority: "frontmatter",
      },
      {
        rowId: "1",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "remote",
        authority: "notidian",
      },
    ]);
    expect(plan.rejections).toEqual([]);
  });

  it("fills a selected range from a one-cell clipboard grid", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: "status" },
        focus: { rowId: "1", columnId: "manual" },
        active: { rowId: "0", columnId: "status" },
      },
      clipboardGrid: [["same"]],
    });

    expect(plan.writes.map((write) => write.value)).toEqual([
      "same",
      "same",
      "same",
      "same",
    ]);
  });

  it("rejects read-only computed cells", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: "Created" },
        focus: { rowId: "0", columnId: "Created" },
        active: { rowId: "0", columnId: "Created" },
      },
      clipboardGrid: [["tomorrow"]],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toEqual([
      {
        rowId: "0",
        columnId: "Created",
        value: "tomorrow",
        reason: "read-only",
      },
    ]);
  });

  it("marks file title writes as file authority", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: PathPropertyName },
        focus: { rowId: "0", columnId: PathPropertyName },
        active: { rowId: "0", columnId: PathPropertyName },
      },
      clipboardGrid: [["New Name"]],
    });

    expect(plan.writes).toEqual([
      {
        rowId: "0",
        columnId: PathPropertyName,
        columnName: PathPropertyName,
        table: "",
        value: "New Name",
        authority: "file",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/core/utils/contexts/tablePastePlan.test.ts --runInBand
```

Expected: fail because `tablePastePlan.ts` does not exist.

- [ ] **Step 3: Implement paste planner**

Create `src/core/utils/contexts/tablePastePlan.ts` with exported `TablePasteColumn`, `TablePasteWrite`, `TablePasteRejection`, `TablePastePlan`, and `planTablePaste`. The implementation must use `propertyAuthorityForColumn` and `cellSelectionRange`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/core/utils/contexts/tablePastePlan.test.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/contexts/tablePastePlan.ts src/core/utils/contexts/tablePastePlan.test.ts
git commit -m "feat: plan authority-aware table pastes"
```

## Task 4: Bulk Page Title Rename Transaction

**Files:**
- Modify: `src/core/utils/contexts/pageTitleRename.ts`
- Modify: `src/core/utils/contexts/pageTitleRename.test.ts`

- [ ] **Step 1: Write failing bulk rename tests**

Append tests to `src/core/utils/contexts/pageTitleRename.test.ts` for:

```ts
import {
  executeBulkPageTitleRename,
  planBulkPageTitleRename,
} from "./pageTitleRename";
```

Required test cases:

- `planBulkPageTitleRename` rejects empty names and slash-containing names before rename.
- `planBulkPageTitleRename` rejects duplicate target paths inside the batch.
- `planBulkPageTitleRename` rejects existing target paths outside the batch.
- `executeBulkPageTitleRename` uses temporary paths when two files swap names.
- `executeBulkPageTitleRename` preserves context row order after the batch.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/core/utils/contexts/pageTitleRename.test.ts --runInBand
```

Expected: fail because the bulk helpers do not exist.

- [ ] **Step 3: Implement bulk rename helpers**

Extend `src/core/utils/contexts/pageTitleRename.ts` with:

```ts
export type BulkPageTitleRenameItem = {
  row: DBRow;
  value: string;
};

export type BulkPageTitleRenamePlan = {
  ok: true;
  renames: {
    oldPath: string;
    newPath: string;
    value: string;
    originalIndex: number;
  }[];
} | {
  ok: false;
  failures: {
    row: DBRow;
    value: string;
    reason: RenamePageTitleFailureReason | "internal-duplicate";
  }[];
};
```

The executor must:

- preflight every target before any rename
- route cycles and swaps through unique temporary `.notidian-renaming-<timestamp>-<index>.md` paths
- call `spaceManager.renamePath`
- reload the context once after execution
- save row order with renamed paths in their original positions

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/core/utils/contexts/pageTitleRename.test.ts --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/contexts/pageTitleRename.ts src/core/utils/contexts/pageTitleRename.test.ts
git commit -m "feat: add bulk page title rename transactions"
```

## Task 5: Batch Edit API

**Files:**
- Modify: `src/core/react/context/ContextEditorContext.tsx`

- [ ] **Step 1: Add context API type**

Modify `ContextEditorContextProps` to include:

```ts
applyTableEdits: (writes: TablePasteWrite[]) => Promise<void>;
```

Import `TablePasteWrite` from `core/utils/contexts/tablePastePlan`.

- [ ] **Step 2: Implement batch execution**

Add `applyTableEdits` inside `ContextEditorProvider`.

Behavior:

- Group file-authority writes and pass them to `executeBulkPageTitleRename`.
- Apply frontmatter and Notidian writes by calling the existing `updateValue` path.
- Skip computed writes because planner rejects them.
- Notify the user when there are rejected or failed writes.

- [ ] **Step 3: Run type check**

Run:

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/react/context/ContextEditorContext.tsx
git commit -m "feat: add table batch edit execution"
```

## Task 6: TableView Range Selection And Clipboard Integration

**Files:**
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- Modify: `src/css/SpaceViewer/TableView.css`

- [ ] **Step 1: Replace single selected column state with cell selection**

Import:

```ts
import {
  CellSelection,
  cellSelectionRange,
  extendCellSelection,
  moveCellSelection,
} from "core/utils/contexts/tableSelection";
import {
  parseTableClipboardText,
  serializeTableClipboardGrid,
} from "core/utils/contexts/tableClipboard";
import { planTablePaste } from "core/utils/contexts/tablePastePlan";
```

Add `const [cellSelection, setCellSelection] = useState<CellSelection>(null);`.

- [ ] **Step 2: Build visible row and column order**

Inside `TableView`, derive:

```ts
const visibleRowOrder = data.map((row) => row._index);
const visibleColumnOrder = columns
  .map((column) => column.accessorKey)
  .filter((column) => column != "+");
```

- [ ] **Step 3: Copy selected range as TSV**

Use `cellSelectionRange` to collect values from `tableData.rows[parseInt(rowId)]` and write `serializeTableClipboardGrid(grid)` to `navigator.clipboard`.

- [ ] **Step 4: Paste through the planner and batch API**

On `Cmd/Ctrl+V`, read clipboard text, parse with `parseTableClipboardText`, call `planTablePaste`, notify for rejections, then call `applyTableEdits(plan.writes)`.

- [ ] **Step 5: Add selection rendering classes**

Cells inside `cellSelectionRange` get `mk-selected-cell`; the active cell additionally gets `mk-active-cell`.

Add CSS:

```css
.mk-table .mk-selected-cell {
  outline: 1px solid var(--interactive-accent);
  outline-offset: -1px;
  background: var(--background-modifier-hover);
}

.mk-table .mk-active-cell {
  box-shadow: inset 0 0 0 2px var(--interactive-accent);
}
```

- [ ] **Step 6: Run type check**

Run:

```bash
npx tsc -noEmit -skipLibCheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx src/css/SpaceViewer/TableView.css
git commit -m "feat: add table range clipboard UI"
```

## Task 7: Documentation And Verification

**Files:**
- Modify: `docs/adr/0003-editable-page-titles-through-file-renames.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/plans/2026-05-24-table-range-clipboard.md`

- [ ] **Step 1: Update ADR 0003**

Add a section explaining that range paste treats page-title edits as file rename transactions and that bulk title paste preflights the batch before applying file operations.

- [ ] **Step 2: Link this plan from docs**

Add `[Table range clipboard plan](superpowers/plans/2026-05-24-table-range-clipboard.md)` under key implementation plans in `docs/README.md`.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/core/utils/contexts/tableClipboard.test.ts src/core/utils/contexts/tableSelection.test.ts src/core/utils/contexts/tablePastePlan.test.ts src/core/utils/contexts/pageTitleRename.test.ts --runInBand
```

Expected: pass.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: pass.

- [ ] **Step 5: Run type check and build**

Run:

```bash
npx tsc -noEmit -skipLibCheck
npm run build
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0003-editable-page-titles-through-file-renames.md docs/README.md docs/superpowers/plans/2026-05-24-table-range-clipboard.md
git commit -m "docs: record table range clipboard implementation"
```

## Self-Review Checklist

- The plan covers clipboard parsing, selection, paste planning, batch execution, bulk file rename transactions, React integration, CSS, documentation, and verification.
- The plan uses focused utilities before React integration to keep behavior testable.
- The plan preserves the source-of-truth rules: file paths own page titles, frontmatter owns ordinary metadata, context MDB owns explicit Notidian fields, and computed cells are read-only.
