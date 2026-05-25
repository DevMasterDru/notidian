# Real Vault Table UI Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in real-vault UI scenario that verifies Notidian renders and edits a real table in Obsidian.

**Architecture:** Extend the existing Node harness with `--ui`. Reuse the same fixture files, then run app-context JavaScript through `obsidian eval` to force the fixture root into table view, open it, inspect the DOM, perform a direct cell edit, and confirm the edit reaches canonical frontmatter metadata.

**Tech Stack:** Node.js, Jest, Obsidian CLI `eval`, Notidian React DOM, existing real-vault harness.

---

## File Structure

- Modify `scripts/notidianRealVaultHarness.js`: parse `--ui`, add UI eval helpers, run the UI scenario before fixture cleanup when requested, and export helper functions for tests.
- Modify `scripts/notidianRealVaultHarness.test.js`: add unit coverage for `--ui`, command sequencing, and UI failure handling.
- Modify `docs/real-vault-smoke-harness.md`: document `--ui`, the fixture-root predicate write, checked behavior, and current UI limits.
- Modify `README.md`, `docs/current-state.md`, and `docs/table-database-workflows.md`: remove stale statements that inline conflict actions are unimplemented.

## Task 1: Add UI Mode Tests

**Files:**

- Modify: `scripts/notidianRealVaultHarness.test.js`

- [ ] **Step 1: Test `--ui` parsing**

Add an assertion to the existing CLI parsing test:

```js
expect(
  parseHarnessArgs(["vault=Atlas Vault", "--allow-write", "--ui"], {})
).toMatchObject({
  vault: "Atlas Vault",
  allowWrite: true,
  includeUi: true,
});
```

- [ ] **Step 2: Test the UI command sequence**

Add a test that runs `runRealVaultSmokeHarness` with `includeUi: true`, makes the mocked `eval` command return a successful UI payload for the UI edit call, and asserts that the runner saw an additional UI `eval` call before cleanup.

- [ ] **Step 3: Test UI failure handling**

Add a test where the UI `eval` call returns `{"ok":false,"reason":"missing-table"}` and assert the harness rejects with `Notidian table UI smoke failed: missing-table`.

- [ ] **Step 4: Verify RED**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: fail because `includeUi` and UI scenario execution are not implemented.

## Task 2: Implement UI Harness Mode

**Files:**

- Modify: `scripts/notidianRealVaultHarness.js`

- [ ] **Step 1: Parse and validate UI mode**

Add `includeUi: false` to the default config and set it to true when `--ui` appears in CLI args.

- [ ] **Step 2: Add table-view setup eval**

Create an eval code builder that saves the fixture root `filesView` schema with a table predicate and opens the fixture root through Notidian's UI API.

- [ ] **Step 3: Add DOM edit eval**

Create an eval code builder that:

```js
{
  ok: true,
  columns: ["File", "Created", "Status", "Rating", "Owner"],
  rowFound: true,
  editedValue: "ui-active"
}
```

after it finds the fixture table, selects the target `status` cell, enters edit mode, writes `ui-active`, and commits the edit.

- [ ] **Step 4: Wire UI scenario into the smoke harness**

After the primitive rename/metadata checks and before developer-error checks, call the UI scenario when `config.includeUi` is true. Wait for metadata on the edited beta file before continuing.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Expected: pass.

## Task 3: Update Docs

**Files:**

- Modify: `docs/real-vault-smoke-harness.md`
- Modify: `README.md`
- Modify: `docs/current-state.md`
- Modify: `docs/table-database-workflows.md`

- [ ] **Step 1: Document `--ui`**

Add the command:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --ui
```

Explain that `--ui` opens the Notidian table, forces the fixture root view to table, edits a status cell through the live DOM, and verifies frontmatter metadata.

- [ ] **Step 2: Correct stale conflict wording**

Replace "inline conflict-resolution prompts are not implemented" with a narrower remaining gap: richer conflict diff/merge UI is not implemented.

- [ ] **Step 3: Verify docs links**

Run the existing markdown local-link check from prior verification.

Expected: all local README/docs links resolve.

## Task 4: Live Verification

**Files:**

- No new source files.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
git diff --check -- scripts docs README.md src
```

Expected: all pass, with source/docs whitespace clean.

- [ ] **Step 2: Install and reload built plugin**

Copy `main.js`, `styles.css`, and `manifest.json` into `/Users/druker/Atlas Vault/.obsidian/plugins/notidian` after making a timestamped backup under `/tmp/notidian-plugin-backups`.

Run:

```bash
obsidian vault="Atlas Vault" plugin:reload id=notidian
obsidian vault="Atlas Vault" dev:errors
```

Expected: plugin reloads and no captured errors are reported.

- [ ] **Step 3: Run live UI smoke**

Run:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --ui
```

Expected: source-of-truth smoke passes, UI smoke passes, fixture files are cleaned up, and `obsidian dev:errors` remains clean.

## Task 5: Commit And Push

**Files:**

- All modified files from prior tasks.

- [ ] **Step 1: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

- [ ] **Step 2: Commit**

Run:

```bash
git add scripts/notidianRealVaultHarness.js scripts/notidianRealVaultHarness.test.js docs/real-vault-smoke-harness.md README.md docs/current-state.md docs/table-database-workflows.md main.js styles.css
git commit -m "test: add real table UI smoke"
```

- [ ] **Step 3: Push**

Run:

```bash
git push origin main
```
