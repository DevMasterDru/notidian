# Bases Adapter

The Bases adapter is the first implementation step for ADR 0011's Bases-first convergence path. ADR 0012 adds the next gate: a custom Bases view that proves Notidian can attach a future table surface to `.base` files.

It is intentionally pure and conservative. It converts a Notidian `SpaceTable` plus an optional table predicate into an in-memory `.base` document shape and deterministic YAML. It does not write files, mutate context MDB data, or claim that every Notidian context can round-trip to native Bases.

## What It Exports

The first adapter supports simple folder table views:

- folder scope as a global `file.inFolder(...)` filter;
- a global `file.ext == "md"` filter so exported `.base` files and other non-Markdown files do not appear as database rows;
- the `File` column as `file.name`;
- frontmatter-backed columns as note properties;
- file property columns such as `File.ctime` as `file.ctime`;
- visible column order;
- column display names when a Notidian alias exists;
- table limits;
- one group-by field when it maps to a supported property;
- simple equality, inequality, numeric comparison, and boolean filters;
- column summaries when they target supported visible properties.

Unsupported behavior is returned in a structured `unsupported` list. This is a core safety rule: the adapter must report unsupported semantics instead of silently dropping them.

## What It Does Not Export Yet

The adapter does not yet provide:

- `.base` import back into Notidian;
- guaranteed handling for every Make.md predicate function;
- stable sort export, because current documented Bases syntax does not expose a general portable sort field;
- context-owned values, relations, aggregates, or complex formulas.
- full Bases-backed Notidian table editing.

Context-owned values must be migrated to frontmatter or kept as explicit Notidian-owned state before they can be represented in native Bases.

## Implementation

Main files:

- [notidianBaseAdapter.ts](../src/core/utils/bases/notidianBaseAdapter.ts)
- [notidianBaseAdapter.test.ts](../src/core/utils/bases/notidianBaseAdapter.test.ts)

Primary functions:

- `notidianTableToBaseDocument`
- `basePropertyForNotidianColumn`
- `serializeBaseDocumentToYaml`

The adapter returns:

```ts
{
  document: BaseDocument;
  unsupported: BaseUnsupportedFeature[];
}
```

Callers should only write the YAML to a vault after presenting unsupported features to the user.

## Obsidian Command

Notidian includes the command:

```text
Export active folder as Obsidian Base
```

The command:

- resolves the active folder, or the parent folder of the active note;
- materializes frontmatter-backed columns before export;
- chooses a new sibling `.base` path without overwriting existing files;
- previews the generated YAML;
- shows unsupported-feature warnings;
- writes the `.base` file only after confirmation.

If the previewed output path appears before the user confirms, the command refuses to overwrite it and asks the user to reopen the preview.

## Custom Bases View

Notidian registers a custom Bases view type when the running Obsidian host supports the custom Bases view API:

```text
notidian-table
```

This is currently a feasibility gate with several proven interaction slices. The view is registered as `Notidian Table`, reads rows and visible properties from Obsidian's current Bases query result, captures runtime capabilities, renders a table projection, lets ordinary note-property cells write through Obsidian frontmatter, lets structured TSV paste update ordinary note-property cells through the same frontmatter path, detects stale frontmatter before note-property writes, supports Reload and Apply anyway conflict actions, supports `Cmd/Ctrl+Z` undo and `Cmd/Ctrl+Shift+Z`/`Cmd/Ctrl+Y` redo for applied custom-view history, lets selected ranges copy displayed values as TSV, lets cut clear only ordinary note-property cells through frontmatter writes, lets `file.name` cells rename the row Markdown file, and lets structured TSV paste include `file.name` cells after rename preflight. It does not persist a hidden mirror or replace the current context-backed Notidian table editor.

Use this view type only to validate the Bases-hosted surface for now. File properties other than `file.name` and formulas are read-only in the custom view. File-name paste preflights the batch for unsafe names, duplicate targets, existing target files, and source-target collisions before any rename. Mixed file-name/property paste applies renames first, retargets dependent property writes to the renamed path, and stores inverse writes in reverse transaction order so undo does not depend on metadata reload timing. Redo stores the original accepted writes and replays them through the same file/frontmatter path; conflict Apply anyway writes are stored without their one-time force flag. Cut intentionally skips `file.name`, other file projections, and formulas rather than clearing file identity or computed data. The custom view still needs typed value preservation, broader multi-row range validation, and swap/cycle title paste through temporary paths before it can replace the context-backed table. The future goal is to move Notidian's enhanced table interactions into this view once those safeguards are proven.

The runtime capability snapshot records the controller keys, config methods, data shape, first entry/value methods, and whether an entry appears to expose a native `setValue` write method. This keeps the next editing step grounded in the actual Obsidian runtime rather than undocumented assumptions.

The live harness can validate the registration and renderer in Obsidian:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-view
```

That smoke also edits the Beta fixture's `status` note property, pastes status/rating TSV values into note-property cells, undoes that paste, applies a surfaced frontmatter conflict, copies and cuts a selected status/rating range, undoes that cut, redoes it, undoes it again to restore the row, pastes into the Beta fixture's `file.name` and `status` cells, undoes that mixed title/status paste, performs a final `file.name` rename, and waits until Obsidian metadata reports the changed frontmatter values on the renamed path.

## Real-Vault Verification

The live Obsidian harness can exercise the export command end to end:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-export
```

The smoke scenario sets the active Notidian path to the fixture folder, executes the actual command, confirms the preview modal, waits for the generated `.base` file, verifies the folder scope and table view YAML, and deletes the exported file during cleanup unless `--keep-fixture` is passed.

## Relationship To ADRs

- [ADR 0011](adr/0011-bases-first-convergence.md) defines why Notidian is converging toward Bases semantics.
- [ADR 0012](adr/0012-custom-bases-view-feasibility-gate.md) defines why the custom Bases view is a feasibility gate before a table rewrite.
- [ADR 0010](adr/0010-legacy-context-audit-and-migration.md) defines why legacy context data must be audited before cleanup.
- [ADR 0001](adr/0001-authority-partitioned-database-model.md) defines the source-of-truth model that this adapter preserves.
