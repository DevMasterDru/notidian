# Real Vault Smoke Harness

The real-vault smoke harness is an opt-in test runner for a live Obsidian vault. It verifies the Obsidian behaviors Notidian relies on for source-of-truth table edits: plugin reload, frontmatter writes, metadata-cache visibility, file rename settling, table UI edits, and developer error capture.

Normal `npm test` does not run this harness.

## When To Run It

Run this harness after changes that affect:

- Frontmatter-backed table edits.
- File/page-title rename behavior.
- Metadata-cache conflict detection.
- Table undo paths that write files.
- Table DOM rendering or direct cell editing when using `--ui`.
- Plugin startup, reload, or vault integration behavior.

Use a disposable test vault when possible. If you use a real working vault, make sure it is backed up.

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

With `--ui`, the harness also performs a live table scenario:

1. Forces the fixture root's default Notidian view to table view.
2. Opens the fixture root through Notidian's UI API.
3. Waits for the matching `.mk-space-view` to render a `.mk-table`.
4. Verifies the fixture row and frontmatter-backed `status` column are present.
5. Selects the Beta row's `status` cell through DOM events.
6. Presses Enter to open the real cell editor.
7. Writes `ui-active` through the browser-native contenteditable insertion path, commits the edit, waits for the rendered cell to settle on `ui-active`, and waits until Obsidian metadata reports `status: ui-active` on the Beta fixture note.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `vault=<name>` | `NOTIDIAN_REAL_VAULT` | Target Obsidian vault. |
| `--allow-write` | Off | Required before fixture creation. |
| `--keep-fixture` | Off | Keeps fixture notes for manual inspection. |
| `--ui` | Off | Also exercises the live Notidian table DOM and verifies a direct cell edit reaches frontmatter. |
| `--plugin-id=<id>` | `notidian` | Plugin id to reload. |
| `--fixture-root=<folder>` | `Notidian Integration Fixtures` | Folder for smoke fixtures. |
| `--timeout-ms=<number>` | `10000` | Metadata-cache polling timeout. |
| `--command-timeout-ms=<number>` | `20000` | Hard timeout for each Obsidian CLI child process. |
| `--poll-interval-ms=<number>` | `250` | Delay between metadata-cache polls. |

## Unit-Test The Harness

The harness has normal Jest tests that do not require Obsidian:

```bash
npm test -- scripts/notidianRealVaultHarness.test.js --runInBand
```

Those tests cover safety gating, CLI argument construction, fixture path creation, metadata polling behavior, API-backed rename behavior, optional UI mode, UI failure reporting, child-process timeouts, and cleanup behavior.

## Current Limits

This is a smoke harness, not the final real-vault test suite.

Still needed:

- Live paste, rename, undo, and conflict-resolution action scenarios through the Notidian UI.
- Fixture tests for legacy Make.md context migration.
- Separate disposable-vault setup automation.
