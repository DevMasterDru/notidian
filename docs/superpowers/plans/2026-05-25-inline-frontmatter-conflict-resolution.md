# Inline Frontmatter Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline cell-level resolution actions for stale frontmatter edit conflicts while preserving safe-by-default file authority.

**Architecture:** Extend the existing table transaction result with conflict details and an explicit forced write flag. Reuse the existing table feedback state to render conflict actions in `TableView`, and route Apply anyway back through the same authority-aware write helper.

**Tech Stack:** TypeScript, React, Jest, existing Notidian table transaction/feedback utilities.

---

### Task 1: Transaction Conflict Details And Forced Writes

**Files:**
- Modify: `src/core/utils/contexts/tableEditTransaction.ts`
- Modify: `src/core/utils/contexts/tableEditTransaction.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving that:

- A stale frontmatter write returns `frontmatter-conflict` with `currentValue`, `baseValue`, and `attemptedValue`.
- The same write with `forceFrontmatterWrite: true` writes frontmatter and saves the table snapshot.

- [ ] **Step 2: Verify red**

Run:

```bash
npm test -- src/core/utils/contexts/tableEditTransaction.test.ts --runInBand
```

Expected: fail because conflict detail fields and forced writes are not implemented.

- [ ] **Step 3: Implement transaction changes**

Add `forceFrontmatterWrite?: boolean` to `TableCellWrite`. Add optional detail fields to `TableEditIssue`. Only skip `frontmatter-conflict` when `forceFrontmatterWrite` is not true.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test -- src/core/utils/contexts/tableEditTransaction.test.ts --runInBand
```

Expected: all transaction tests pass.

### Task 2: Feedback Conflict Action State

**Files:**
- Modify: `src/core/utils/contexts/tableEditFeedback.ts`
- Modify: `src/core/utils/contexts/tableEditFeedback.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving that:

- Frontmatter conflicts map to a distinct conflict feedback action.
- Conflict feedback preserves the write and conflict details needed by the UI.
- Reset-token behavior still remounts conflicted cells.

- [ ] **Step 2: Verify red**

Run:

```bash
npm test -- src/core/utils/contexts/tableEditFeedback.test.ts --runInBand
```

Expected: fail because conflict action metadata is not implemented.

- [ ] **Step 3: Implement feedback changes**

Add a conflict action marker to feedback entries for `frontmatter-conflict`. Preserve `write`, `currentValue`, `baseValue`, and `attemptedValue` on the feedback entry.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test -- src/core/utils/contexts/tableEditFeedback.test.ts --runInBand
```

Expected: all feedback tests pass.

### Task 3: TableView Inline Actions

**Files:**
- Modify: `src/core/react/context/ContextEditorContext.tsx`
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- Modify: `src/css/SpaceViewer/TableView.css`

- [ ] **Step 1: Expose value-write and reload helpers**

Add context methods:

- `applyValueEdits(writes: TableCellWrite[])`
- `reloadContextData()`

`applyValueEdits` delegates to the existing `executeValueWrites`. `reloadContextData` reloads the current context path and retrieves the current table.

- [ ] **Step 2: Render inline conflict actions**

When feedback has `action: "frontmatter-conflict"`, render a compact action row inside the cell:

- Reload: calls `reloadContextData`, clears feedback, and remounts the cell.
- Apply anyway: calls `applyValueEdits([{ ...write, forceFrontmatterWrite: true }])`.

- [ ] **Step 3: Style conflict actions**

Add compact, stable CSS for the action row so the cell remains table-like and does not shift surrounding layout more than necessary.

### Task 4: Documentation

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/table-database-workflows.md`
- Modify: `docs/adr/0009-frontmatter-conflict-detection.md`

- [ ] **Step 1: Document current behavior**

Update docs to explain safe skip, Reload, and Apply anyway.

- [ ] **Step 2: Preserve ADR invariants**

Update ADR 0009 to record that forced writes are explicit and do not weaken default stale-write detection.

### Task 5: Verification And Delivery

**Files:**
- All changed files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/core/utils/contexts/tableEditTransaction.test.ts src/core/utils/contexts/tableEditFeedback.test.ts --runInBand
```

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test -- --runInBand
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npx tsc -noEmit -skipLibCheck
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

- [ ] **Step 5: Run live smoke**

Run:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

- [ ] **Step 6: Commit and push**

Commit the implementation and push `main`.

## Self-Review

- Spec coverage: the plan covers transaction semantics, feedback metadata, UI actions, docs, and verification.
- Placeholder scan: no placeholders remain.
- Scope check: this is one focused conflict-resolution slice. Batch conflict workflows and DOM-level table automation remain future work.
