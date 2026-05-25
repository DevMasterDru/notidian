# Real Vault Table Workflow Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `npm run test:real-vault -- --ui` so it verifies live table paste, undo, title rename, and conflict-apply workflows in Obsidian.

**Architecture:** Keep the existing Node harness and Obsidian CLI `eval` approach. Add small marked browser-context eval builders for each workflow, verify canonical metadata from Node after each eval, and return the UI-renamed Alpha path so cleanup targets the current file.

**Tech Stack:** Node.js, Jest, Obsidian CLI `eval`, Notidian React table DOM, Obsidian metadata cache.

---

## File Structure

- Modify `scripts/notidianRealVaultHarness.js`: add UI workflow constants, browser eval helpers, scenario metadata assertions, final path return, and cleanup support for the UI-renamed Alpha file.
- Modify `scripts/notidianRealVaultHarness.test.js`: add failing tests for the expanded UI workflow sequence, cleanup path update, and workflow failure reporting.
- Modify `docs/real-vault-smoke-harness.md`: document the expanded `--ui` workflow.
- Modify `README.md`, `docs/current-state.md`, and `docs/table-database-workflows.md`: narrow the remaining real-vault UI automation gap after paste, undo, rename, and conflict actions are covered.

## Task 1: Expand Harness Tests

**Files:**

- Modify: `scripts/notidianRealVaultHarness.test.js`

- [ ] **Step 1: Update the successful UI scenario mock**

In `runs the optional table UI smoke scenario before cleanup`, update the mock eval handler to recognize these markers and return successful payloads:

```js
if (code.includes("notidianTableUiPaste")) {
  return JSON.stringify({
    ok: true,
    editedValues: { status: "paste-active", rating: "7" },
  });
}
if (code.includes("notidianTableUiUndo")) {
  return JSON.stringify({
    ok: true,
    editedValues: { status: "ui-active", rating: "2" },
  });
}
if (code.includes("notidianTableUiRename")) {
  return JSON.stringify({
    ok: true,
    path:
      "Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed.md",
    title: "notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed",
  });
}
if (code.includes("notidianTableUiConflict")) {
  return JSON.stringify({
    ok: true,
    appliedValue: "conflict-applied",
  });
}
```

Extend the metadata eval response queue to include:

```js
"=> ui-active",
"=> paste-active",
"=> 7",
"=> ui-active",
"=> 2",
"=> active",
"=> conflict-applied"
```

- [ ] **Step 2: Assert every workflow ran**

Add assertions that at least one eval call contains each marker:

```js
[
  "notidianTableUiEdit",
  "notidianTableUiPaste",
  "notidianTableUiUndo",
  "notidianTableUiRename",
  "notidianTableUiConflict",
].forEach((marker) => {
  expect(
    calls.some((args) => args[1] == "eval" && args.join(" ").includes(marker))
  ).toBe(true);
});
```

- [ ] **Step 3: Assert cleanup uses the UI-renamed Alpha path**

Add an assertion against the delete calls:

```js
expect(
  calls.some((args) =>
    args.includes(
      "path=Notidian Integration Fixtures/notidian-smoke-2026-05-25T10-20-30-456Z-Alpha UI Renamed.md"
    )
  )
).toBe(true);
```

- [ ] **Step 4: Add a workflow failure test**

Add a test where `notidianTableUiPaste` returns:

```js
JSON.stringify({ ok: false, reason: "missing-cell" });
```

Assert rejection:

```js
await expect(runRealVaultSmokeHarness(...)).rejects.toThrow(
  "Notidian table UI paste failed: missing-cell"
);
```

- [ ] **Step 5: Verify RED**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: tests fail because the new workflow evals and cleanup path update are not implemented.

## Task 2: Implement UI Workflow Evals

**Files:**

- Modify: `scripts/notidianRealVaultHarness.js`

- [ ] **Step 1: Add workflow constants**

Add constants:

```js
const DEFAULT_TABLE_UI_PASTE_STATUS = "paste-active";
const DEFAULT_TABLE_UI_PASTE_RATING = "7";
const DEFAULT_TABLE_UI_CONFLICT_EXTERNAL = "conflict-external";
const DEFAULT_TABLE_UI_CONFLICT_APPLIED = "conflict-applied";
```

- [ ] **Step 2: Add a reusable DOM helper inside each eval**

Each eval should find the latest matching fixture table by:

```js
const views = Array.from(document.querySelectorAll(".mk-space-view")).filter(
  (view) =>
    view.getAttribute("data-path") === folder && view.querySelector(".mk-table")
);
const table = views[views.length - 1]?.querySelector(".mk-table");
```

It should map headers with `thead th`, find rows by visible title text, and return structured `missing-view`, `missing-table`, `missing-column`, `missing-row`, or `missing-cell` failures.

- [ ] **Step 3: Add `tableUiPasteEvalCode`**

Build an eval that:

1. Selects the Beta `status` cell.
2. Temporarily overrides `navigator.clipboard.readText` to return `"paste-active\t7"`.
3. Dispatches `Cmd/Ctrl+V` on `.mk-table`.
4. Restores `navigator.clipboard.readText`.
5. Polls the Beta `status` and `rating` cells until they render `paste-active` and `7`.

- [ ] **Step 4: Add `tableUiUndoEvalCode`**

Build an eval that:

1. Focuses `.mk-table`.
2. Dispatches `Cmd/Ctrl+Z`.
3. Polls Beta `status` and `rating` until they render `ui-active` and `2`.

- [ ] **Step 5: Add `tableUiRenameEvalCode`**

Build an eval that:

1. Selects the Alpha renamed `File` cell.
2. Opens the contenteditable title editor.
3. Uses `document.execCommand("insertText", false, nextTitle)` to replace the title.
4. Commits with Enter or blur.
5. Waits until `app.vault.getAbstractFileByPath(nextPath)` exists.
6. Returns `{ ok: true, path: nextPath, title: nextTitle }`.

- [ ] **Step 6: Add `tableUiConflictEvalCode`**

Build an eval that:

1. Uses `app.fileManager.processFrontMatter` on the Beta fixture to set `status` to `conflict-external`.
2. Waits until `app.metadataCache.getFileCache(file).frontmatter.status` is `conflict-external`.
3. Edits the visible Beta `status` cell to `conflict-applied`.
4. Waits for a `.mk-cell-conflict` cell with an `Apply anyway` button.
5. Clicks `Apply anyway`.
6. Waits until metadata reports `status: conflict-applied`.
7. Returns `{ ok: true, appliedValue: "conflict-applied" }`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: harness tests pass.

## Task 3: Wire Metadata Assertions And Cleanup

**Files:**

- Modify: `scripts/notidianRealVaultHarness.js`

- [ ] **Step 1: Add post-workflow metadata waits**

After paste:

```js
await waitForMetadataValue({ path: paths.betaPath, property: "status", expected: "paste-active" });
await waitForMetadataValue({ path: paths.betaPath, property: "rating", expected: "7" });
```

After undo:

```js
await waitForMetadataValue({ path: paths.betaPath, property: "status", expected: "ui-active" });
await waitForMetadataValue({ path: paths.betaPath, property: "rating", expected: "2" });
```

After title rename:

```js
await runObsidian(config, runner, "read", { path: renamedPath });
await waitForMetadataValue({ path: renamedPath, property: "status", expected: "active" });
```

After conflict apply:

```js
await waitForMetadataValue({ path: paths.betaPath, property: "status", expected: "conflict-applied" });
```

- [ ] **Step 2: Return final paths from `runTableUiSmokeScenario`**

Return:

```js
return { primaryPath: renameResult.path };
```

- [ ] **Step 3: Update `runRealVaultSmokeHarness` cleanup path**

When the UI scenario returns `primaryPath`, assign it to the local `primaryPath` before cleanup.

## Task 4: Update Documentation

**Files:**

- Modify: `docs/real-vault-smoke-harness.md`
- Modify: `README.md`
- Modify: `docs/current-state.md`
- Modify: `docs/table-database-workflows.md`

- [ ] **Step 1: Document expanded `--ui` behavior**

Describe direct edit, one-row multi-cell paste, undo, file-title rename, conflict Apply anyway, and cleanup of the UI-renamed Alpha file.

- [ ] **Step 2: Narrow remaining gaps**

Replace remaining broad "paste, undo, rename, conflict action" gaps with:

```text
Broader real-vault UI automation for multi-row paste, copy/cut, rejected title paste, redo, richer conflict merge flows, and metadata timing fixtures.
```

## Task 5: Full Verification And Push

**Files:**

- All modified files.

- [ ] **Step 1: Run local verification**

Run:

```bash
npm test -- --runInBand
npx tsc --noEmit --skipLibCheck
npm run build
git diff --check -- scripts docs README.md src
```

- [ ] **Step 2: Run docs link check**

Run the repo markdown local-link checker that skips any path segment containing `archive` or `ignore`.

- [ ] **Step 3: Run live vault verification**

Run:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --ui
obsidian vault="Atlas Vault" dev:errors
obsidian vault="Atlas Vault" dev:console level=error
obsidian vault="Atlas Vault" files folder="Notidian Integration Fixtures" | rg 'notidian-smoke-2026-05-25T' || true
```

Expected: smoke passes, errors and console errors are empty, and no timestamped fixture files remain.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add scripts/notidianRealVaultHarness.js scripts/notidianRealVaultHarness.test.js docs/real-vault-smoke-harness.md README.md docs/current-state.md docs/table-database-workflows.md docs/superpowers/specs/2026-05-25-real-vault-table-workflow-automation-design.md docs/superpowers/plans/2026-05-25-real-vault-table-workflow-automation.md
git commit -m "test: cover real table workflows"
git push origin main
```
