# Table Edit Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface table edit transaction results as pending, skipped, and failed cell feedback in the table UI.

**Architecture:** Add pure mapping helpers under `src/core/utils/contexts`, return `TableEditTransactionResult` from context edit methods, and let `TableView` own transient cell feedback state. Styling lives in the existing table CSS file.

**Tech Stack:** TypeScript, React, Jest, existing Notidian table transaction types.

---

### Task 1: Feedback Mapping Utility

**Files:**
- Create: `src/core/utils/contexts/tableEditFeedback.ts`
- Create: `src/core/utils/contexts/tableEditFeedback.test.ts`

- [ ] **Step 1: Write failing tests**

Test pending feedback from planned writes, failed/skipped feedback from transaction results, stable cell keys, and notification summary strings.

- [ ] **Step 2: Run red**

Run: `npm test -- src/core/utils/contexts/tableEditFeedback.test.ts --runInBand`

Expected: fail because the helper module does not exist.

- [ ] **Step 3: Implement helper**

Export `tableCellFeedbackKey`, `pendingFeedbackForWrites`, `feedbackForTableEditResult`, and `summaryForTableEditResult`.

- [ ] **Step 4: Run green**

Run: `npm test -- src/core/utils/contexts/tableEditFeedback.test.ts --runInBand`

Expected: all tests pass.

### Task 2: Result Propagation

**Files:**
- Modify: `src/core/react/context/ContextEditorContext.tsx`
- Modify: `src/core/utils/contexts/tableEditTransaction.ts`
- Modify: `src/core/utils/contexts/tableEditTransaction.test.ts`

- [ ] **Step 1: Add transaction result helpers**

Add empty/combine helpers and a file-rename failure reason so mixed paste can return one result.

- [ ] **Step 2: Return results from edit methods**

Change `updateValue`, `updateFieldValue`, and `applyTableEdits` to return `Promise<TableEditTransactionResult>`.

- [ ] **Step 3: Run targeted tests and typecheck**

Run: `npm test -- src/core/utils/contexts/tableEditTransaction.test.ts --runInBand`

Run: `npx tsc -noEmit -skipLibCheck`

Expected: both pass.

### Task 3: Table UI Feedback

**Files:**
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- Modify: `src/css/SpaceViewer/TableView.css`

- [ ] **Step 1: Track transient paste feedback**

Set pending feedback before `applyTableEdits`, then replace it with failed/skipped feedback from the result.

- [ ] **Step 2: Render feedback classes and reason titles**

Add `mk-cell-pending`, `mk-cell-failed`, and `mk-cell-skipped` classes on table cells.

- [ ] **Step 3: Notify concise result summaries**

Use the result summary helper for failed/skipped counts.

### Task 4: Verification And Delivery

**Files:**
- Build output: `main.js`
- Build output: `styles.css`

- [ ] **Step 1: Full tests**

Run: `npm test -- --runInBand`

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc -noEmit -skipLibCheck`

Run: `npm run build`

- [ ] **Step 3: Install and reload in Atlas Vault**

Back up the current plugin directory, copy `main.js`, `styles.css`, and `manifest.json`, then run `obsidian plugin:reload id=notidian`.

- [ ] **Step 4: Runtime check**

Run: `obsidian dev:errors`

Expected: `No errors captured.`
