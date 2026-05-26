# Real Vault Smoke Harness

The real-vault smoke harness is an opt-in test runner for a live Obsidian vault. It verifies the Obsidian behaviors Notidian relies on for source-of-truth table edits: plugin reload, frontmatter writes, metadata-cache visibility, file rename settling, table UI edits, and developer error capture.

Normal `npm test` does not run this harness.

## When To Run It

Run this harness after changes that affect:

- Frontmatter-backed table edits.
- File/page-title rename behavior.
- Metadata-cache conflict detection.
- Table undo paths that write files.
- Table DOM rendering, paste, undo, rename, or conflict actions when using `--ui`.
- `.base` export command behavior when using `--base-export`.
- Custom Bases view registration and rendering when using `--base-view`.
- Plugin startup, reload, or vault integration behavior.

Use a disposable test vault when possible. If you use a real working vault, make sure it is backed up.

Before running command-level smoke tests such as `--base-export`, make sure the target vault's installed Notidian plugin bundle is the current build. A stale `.obsidian/plugins/notidian/main.js` can reload successfully while missing newly added commands.

```bash
npm run build
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
obsidian vault="Atlas Vault" plugin:reload id=notidian
```

## Safety Model

The harness refuses to write unless both conditions are true:

- A target vault is provided.
- `--allow-write` is passed.

It writes only under a stable fixture root with timestamped fixture file names:

```text
Notidian Integration Fixtures/notidian-smoke-<timestamp>-Alpha.md
Notidian Integration Fixtures/notidian-smoke-<timestamp>-Beta.md
```

By default, it deletes the fixture notes before exiting. Pass `--keep-fixture` to leave them in the vault for inspection.

The harness intentionally avoids creating a per-run folder. Notidian may create `.space/context.mdb` inside observed folders, and deleting such a folder while the plugin is active can race with context reads. Timestamped file names provide isolation without deleting plugin-owned folder metadata.

When `--ui` is passed, the harness also writes the fixture root's default frame view predicate to table view. Use a dedicated fixture root for this command; the default `Notidian Integration Fixtures` folder is intended for that purpose.

The harness wraps each Obsidian CLI command with a hard process timeout. File rename is performed through `obsidian eval` and Obsidian's `fileManager.renameFile` API instead of the CLI `rename` command because the CLI command can complete the rename but keep the child process open. The API path still exercises Obsidian's native rename event and metadata-cache behavior without letting a finished rename stall the smoke run.

The harness waits briefly before and after fixture cleanup. This gives Obsidian's metadata cache and native Bases indexer time to settle before fixture files or exported `.base` files are deleted and before the final developer-error check runs.

## Run The Smoke Harness

With an explicit vault:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

With an environment variable:

```bash
NOTIDIAN_REAL_VAULT="Atlas Vault" npm run test:real-vault -- --allow-write
```

Keep fixtures after the run:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --keep-fixture
```

Target a different plugin id:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --plugin-id=notidian
```

Run the live table UI smoke:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --ui
```

Run the `.base` export command smoke:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-export
```

Run the custom Bases view smoke:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-view
```

## What The Harness Checks

The source-of-truth smoke scenario performs these steps:

1. Targets the selected vault through the Obsidian CLI.
2. Reloads the Notidian plugin.
3. Clears captured developer errors.
4. Creates two Markdown fixture notes with frontmatter.
5. Waits until Obsidian's metadata cache reports the expected frontmatter value.
6. Sets a property through Obsidian's property API.
7. Verifies the new value through `property:read`.
8. Waits until metadata cache reports the updated value.
9. Renames one fixture file through Obsidian's `fileManager.renameFile` API.
10. Verifies the renamed file can be read.
11. Waits until metadata cache reports the updated frontmatter on the renamed path.
12. Checks captured developer errors.
13. Deletes fixture notes unless `--keep-fixture` was passed.

This proves the live vault supports the primitive operations Notidian's table transactions depend on.

With `--ui`, the harness also performs live table scenarios:

1. Forces the fixture root's default Notidian view to table view.
2. Opens the fixture root through Notidian's UI API.
3. Waits for the matching `.mk-space-view` to render a `.mk-table`.
4. Verifies the fixture row and frontmatter-backed `status` column are present.
5. Selects the Beta row's `status` cell through DOM events.
6. Presses Enter to open the real cell editor.
7. Writes `ui-active` through the browser-native contenteditable insertion path, commits the edit, waits for the rendered cell to settle on `ui-active`, and waits until Obsidian metadata reports `status: ui-active` on the Beta fixture note.
8. Uses the table's keyboard paste handler to paste a one-row, two-column TSV payload into Beta `status` and `rating`, then verifies both frontmatter values.
9. Uses the table's keyboard undo handler to restore the pasted cells to `status: ui-active` and `rating: 2`, then verifies both frontmatter values.
10. Creates a deterministic stale frontmatter authority state for the Beta row, edits the visible `status` cell, clicks the rendered `Apply anyway` conflict action, and verifies `status: conflict-applied` reaches the Markdown file.
11. Edits the Alpha `File` cell through the live title editor, verifies the file was renamed, and uses the final renamed path during fixture cleanup.

The conflict scenario intentionally creates the stale authority state inside Notidian's live path index instead of racing a real external file edit. Real external edits often refresh the table before a stale row can be exercised. The lower-level transaction tests cover detection against canonical metadata; this live UI step verifies that the rendered conflict action can force the attempted value through the same write path.

With `--base-export`, the harness also performs a live `.base` export command scenario:

1. Sets the active Notidian path to the fixture root folder.
2. Executes the real `Export active folder as Obsidian Base` Obsidian command.
3. Waits for the export preview modal.
4. Reads the previewed output path from the modal.
5. Clicks the real `Export .base` button.
6. Waits for the generated `.base` file.
7. Verifies the exported YAML contains a folder scope and table view.
8. Deletes the exported `.base` file during fixture cleanup unless `--keep-fixture` was passed.

With `--base-view`, the harness also performs a live custom Bases view scenario:

1. Verifies the loaded Notidian plugin registered the custom Bases view.
2. Writes a temporary `.base` file with `type: "notidian-table"`.
3. Opens the `.base` file through Obsidian.
4. Waits for the `.notidian-bases-table-view` DOM.
5. Verifies the fixture row and visible `status` and `rating` properties render through the custom view.
6. Verifies the view exposed runtime capability metadata for the Bases controller/config/data/value surface.
7. Deletes the temporary `.base` file during fixture cleanup unless `--keep-fixture` was passed.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `vault=<name>` | `NOTIDIAN_REAL_VAULT` | Target Obsidian vault. |
| `--allow-write` | Off | Required before fixture creation. |
| `--keep-fixture` | Off | Keeps fixture notes for manual inspection. |
| `--ui` | Off | Also exercises the live Notidian table DOM for direct edit, paste, undo, conflict apply, and file-title rename workflows. |
| `--base-export` | Off | Also exercises the live `.base` export command and deletes the generated `.base` file during cleanup. |
| `--base-view` | Off | Also exercises the live `notidian-table` custom Bases view and deletes the temporary `.base` file during cleanup. |
| `--plugin-id=<id>` | `notidian` | Plugin id to reload. |
| `--fixture-root=<folder>` | `Notidian Integration Fixtures` | Folder for smoke fixtures. |
| `--timeout-ms=<number>` | `10000` | Metadata-cache polling timeout. |
| `--command-timeout-ms=<number>` | `20000` | Hard timeout for each Obsidian CLI child process. |
| `--poll-interval-ms=<number>` | `250` | Delay between metadata-cache polls. |
| `--cleanup-settle-ms=<number>` | `1000` | Delay before and after fixture cleanup so delayed Obsidian file/index events are captured. |

## Install The Current Build

Use the installer when you want the selected vault to run the repository's current `main.js`, `styles.css`, and `manifest.json`:

```bash
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
```

The installer writes only to `.obsidian/plugins/<plugin-id>` inside the target vault. It refuses to run without `--allow-write`, verifies that the source build artifacts exist, and checks that `manifest.json` matches the requested plugin id before copying.

## Unit-Test The Harness

The harness has normal Jest tests that do not require Obsidian:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Those tests cover safety gating, CLI argument construction, fixture path creation, metadata polling behavior, API-backed rename behavior, optional UI mode, optional `.base` export mode, optional custom Bases view mode, expanded UI workflow sequencing, UI failure reporting, child-process timeouts, and cleanup behavior.

## Current Limits

This is a smoke harness, not the final real-vault test suite.

Still needed:

- Broader live UI automation for multi-row paste, copy/cut, rejected title paste, redo, richer conflict merge flows, and additional metadata timing fixtures.
- Deeper live `.base` validation for custom-view editing, Bases formula/sort/group behavior, and runtime API changes.
- Fixture tests for legacy Make.md context migration.
- Separate disposable-vault setup automation.
