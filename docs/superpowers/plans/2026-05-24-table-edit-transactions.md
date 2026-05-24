# Table Edit Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared authority-aware transaction helper for ordinary Notidian table value writes and route paste plus single-cell edits through it.

**Architecture:** Add a dependency-injected utility under `src/core/utils/contexts` that groups frontmatter writes, root table row changes, and linked context table changes. React context code calls the helper and remains responsible for state setters, Obsidian-specific services, and page-title rename transactions.

**Tech Stack:** TypeScript, React context integration, Jest, existing Notidian `SpaceTable`/`DBRow` types.

---

### Task 1: Transaction Utility Red Test

**Files:**
- Create: `src/core/utils/contexts/tableEditTransaction.test.ts`
- Create: `src/core/utils/contexts/tableEditTransaction.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/core/utils/contexts/tableEditTransaction.test.ts` with tests for path fallback, frontmatter grouping, failure gating, root table batching, linked context batching, and skipped linked contexts.

- [ ] **Step 2: Run the tests to verify red**

Run: `npm test -- src/core/utils/contexts/tableEditTransaction.test.ts --runInBand`

Expected: fail because `./tableEditTransaction` does not exist.

- [ ] **Step 3: Add the minimal exported types and function**

Create `src/core/utils/contexts/tableEditTransaction.ts` with `TableCellWrite`, `TableEditTransactionResult`, and `executeTableValueWrites`.

- [ ] **Step 4: Run the tests to verify green**

Run: `npm test -- src/core/utils/contexts/tableEditTransaction.test.ts --runInBand`

Expected: all transaction utility tests pass.

### Task 2: Context Integration

**Files:**
- Modify: `src/core/react/context/ContextEditorContext.tsx`
- Modify: `src/core/utils/contexts/tablePasteExecution.ts`
- Modify: `src/core/utils/contexts/tablePasteExecution.test.ts`

- [ ] **Step 1: Replace duplicated paste write execution**

Change `applyTableEdits` so non-file writes are converted to `TableCellWrite[]` and passed to `executeTableValueWrites`.

- [ ] **Step 2: Route single-cell writes through the helper**

Change `updateValue` so ordinary value writes call `executeTableValueWrites` with one write.

- [ ] **Step 3: Keep field option writes local while routing the value write**

Change `updateFieldValue` so the value persistence uses `executeTableValueWrites`, then preserves the existing column-option update behavior.

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- src/core/utils/contexts/tableEditTransaction.test.ts src/core/utils/contexts/tablePasteExecution.test.ts src/core/utils/contexts/tablePastePlan.test.ts --runInBand`

Expected: all targeted tests pass.

### Task 3: Verification And Delivery

**Files:**
- Build output: `main.js`

- [ ] **Step 1: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: exit code 0.

- [ ] **Step 2: Full tests**

Run: `npm test -- --runInBand`

Expected: all Jest suites pass.

- [ ] **Step 3: Production build**

Run: `npm run build`

Expected: TypeScript and esbuild complete and regenerate `main.js`/`styles.css` as needed.

- [ ] **Step 4: Install and reload in the Atlas Vault**

Back up `/Users/druker/Atlas Vault/.obsidian/plugins/notidian`, copy `main.js`, `styles.css`, and `manifest.json`, then run `obsidian plugin:reload id=notidian`.

- [ ] **Step 5: Runtime error check**

Run: `obsidian dev:errors`

Expected: `No errors captured.`

- [ ] **Step 6: Commit and push**

Commit the docs, source, tests, and generated bundle, then push `main`.

## Self-Review

- Spec coverage: the plan covers the shared executor, paste integration, single-cell integration, tests, build, vault install, and runtime check.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: the plan consistently names the helper `executeTableValueWrites` and the write type `TableCellWrite`.
