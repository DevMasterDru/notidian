# Real Vault Table Workflow Automation Design

## Goal

Expand the live `--ui` real-vault harness from a single direct cell edit into a user-workflow smoke that exercises the table behaviors that make Notidian feel like a Notion-style database: paste, undo, title rename, and frontmatter conflict actions.

## Context

The current `--ui` harness proves that Notidian can render a live table and commit a direct frontmatter-backed text edit through the real DOM. That is necessary but not enough. The higher-risk table promises are the wrapper workflows: keyboard paste through the table, table-local undo, file-title editing through a cell, and conflict recovery when the Markdown file changed outside the table.

These workflows are already implemented in the plugin. The gap is verification in a live Obsidian vault with real metadata-cache timing, real React event handlers, and real Markdown files.

## Chosen Approach

Extend the existing `--ui` scenario in `scripts/notidianRealVaultHarness.js`.

The scenario will keep using Obsidian CLI `eval` to run browser-context JavaScript inside the live app. Each workflow gets a separate marked eval block so failures report the exact stage:

1. `notidianTableUiEdit`: direct edit of the Beta `status` cell to `ui-active`.
2. `notidianTableUiPaste`: table keyboard paste from the Beta `status` cell with a one-row, two-column TSV payload that updates `status` and `rating`.
3. `notidianTableUiUndo`: table keyboard undo that restores the pasted cells to their pre-paste values.
4. `notidianTableUiRename`: edit the Alpha file-title cell and verify the file path changed through the table UI.
5. `notidianTableUiConflict`: mutate Beta frontmatter outside the table, attempt a stale table edit, click `Apply anyway`, and verify the forced write reaches frontmatter.

The harness will still verify canonical Markdown metadata from Node after each workflow. DOM success alone is not enough.

## Safety Model

The existing write gates remain:

- A vault name is required.
- `--allow-write` is required.
- Fixture files use timestamped names under the fixture root.
- Fixture files are deleted unless `--keep-fixture` is passed.

The title rename workflow changes the Alpha fixture path after the primitive API rename. The UI scenario must return the final Alpha path so cleanup deletes the final file, not the stale path.

The conflict workflow only mutates the Beta fixture file created by the same harness run.

## Workflow Details

### Paste And Undo

The paste workflow will use the table's actual `Cmd/Ctrl+V` handler. The eval block temporarily overrides `navigator.clipboard.readText` to return a TSV payload and dispatches the keyboard event on the focused `.mk-table`.

The first implementation intentionally uses a one-row, two-column paste into Beta `status` and `rating`. This proves multi-cell paste, type parsing, frontmatter writes, and the undo journal without depending on fixture rows being adjacent to each other in a folder that may contain other harness notes.

Undo dispatches `Cmd/Ctrl+Z` on the same table and verifies the two cells return to their pre-paste values.

### Title Rename

The rename workflow edits the `File` column for the Alpha fixture row through the same contenteditable insertion path used by direct text edits. It verifies the new file exists and returns the new path to the Node harness for metadata checks and cleanup.

### Conflict Action

The conflict workflow changes Beta `status` through Obsidian's frontmatter API while the table still has the pre-change row value. It then attempts a table edit, expects a rendered frontmatter-conflict state, clicks `Apply anyway`, and waits for the forced frontmatter write.

If live metadata reload timing causes the table to refresh before a conflict can be produced, the workflow should fail with a clear `missing-conflict` reason instead of silently passing. That would reveal a real limitation of this smoke technique and should be addressed separately.

## Error Handling

Every eval block returns structured JSON:

```json
{"marker":"notidianTableUiPaste","ok":false,"reason":"missing-cell","columns":["File","Created","Status"]}
```

The Node harness converts these payloads into stage-specific thrown errors. Failure payloads should include enough context to diagnose missing views, headers, rows, cells, editors, conflict buttons, or stale display values.

## Testing

Unit tests remain Obsidian-free and mock the runner. They should cover:

- The expanded UI scenario command sequence.
- Metadata waits after paste and undo.
- Cleanup using the UI-renamed Alpha path.
- Loud failure when any UI workflow eval returns `ok: false`.

Live verification remains:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --ui
```

After the live run, `obsidian dev:errors` and `obsidian dev:console level=error` must be clean, and no timestamped fixture files should remain when `--keep-fixture` is not passed.

## Non-Goals

- Do not add a separate durable data layer.
- Do not introduce Playwright or another browser driver for this slice.
- Do not depend on two fixture rows being adjacent in the rendered table.
- Do not test drag-fill, row creation, full rectangular multi-row paste, or redo in this slice.
