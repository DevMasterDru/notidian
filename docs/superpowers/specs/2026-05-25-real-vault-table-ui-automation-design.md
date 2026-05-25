# Real Vault Table UI Automation Design

## Goal

Add an opt-in live Obsidian table UI scenario to the real-vault harness so Notidian verifies the actual table surface, not only the lower-level Obsidian APIs.

## Context

The existing real-vault smoke harness proves that Obsidian can reload the Notidian plugin, create fixture notes, update frontmatter, observe metadata-cache changes, rename files, and capture developer errors. It does not yet open a Notidian table and exercise user-facing table interactions.

That leaves a gap in the most important promise of the fork: a folder should behave like a Notion-style database table while Obsidian files remain canonical.

## Chosen Approach

Extend `scripts/notidianRealVaultHarness.js` with an explicit `--ui` mode. The default command remains the lower-risk source-of-truth smoke. When `--ui` is passed, the harness additionally:

1. Forces the fixture root's default view predicate to table view.
2. Opens the fixture root through `app.plugins.plugins.notidian.superstate.ui.openPath`.
3. Waits for a `.mk-table` in the matching `.mk-space-view`.
4. Verifies the table exposes expected file/frontmatter columns and the fixture rows.
5. Selects a real status cell, presses Enter to enter edit mode, updates the contenteditable editor, commits the edit, and waits for Obsidian frontmatter metadata to show the new value.

The UI interaction uses Obsidian's existing `eval` command to run JavaScript inside the live app context. This avoids an additional browser driver dependency while still going through the real DOM, React event handlers, and table edit transaction path.

## Safety Model

The UI scenario inherits the existing write gates:

- A target vault is required.
- `--allow-write` is required.
- Fixture files are timestamped under the configured fixture root.
- Fixture files are deleted unless `--keep-fixture` is passed.

The UI scenario also writes the fixture root's frame predicate to table view. This is acceptable because the fixture root is explicitly harness-owned and already may contain Notidian `.space` metadata. The harness must document this clearly.

## Scope

This first UI automation slice covers:

- Table view rendering for a fixture folder.
- Frontmatter-backed columns visible in the rendered table.
- Direct text cell edit through the actual table UI.
- Canonical metadata update after that UI edit.

This slice does not yet cover:

- Multi-cell paste through the UI.
- Table undo through keyboard shortcuts.
- Inline conflict action clicks.
- Rich screenshots or DOM snapshots on failure.
- A disposable-vault bootstrapper.

Those are follow-up scenarios built on the same UI harness primitives.

## Error Handling

The UI script should return structured JSON from `obsidian eval`. If it cannot find a view, table, row, column, cell, or editor, the JSON payload should include enough table text/header context to diagnose the missing element. The Node harness converts failed UI results into normal thrown errors so CI/manual runs fail loudly.

## Testing

Unit tests should not require Obsidian. They should cover:

- Parsing `--ui`.
- Keeping the default harness UI mode disabled.
- The expected Obsidian command sequence when `includeUi` is enabled.
- Failure when the UI eval result reports `ok: false`.

The live validation command is:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --ui
```

## Documentation Updates

Update the docs that still describe inline conflict actions as future work. Update the real-vault smoke harness page to explain the new `--ui` mode and its current limits.
