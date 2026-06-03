# Notidian

Notidian is an independent fork of Make.md for Obsidian. The fork is focused on making local Markdown files behave like a durable, Notion-style database system without separating data governance from Obsidian's native files and properties.

## Direction

Notidian uses an authority-partitioned database model:

- A row is a Markdown file.
- The page title is the file name/path.
- Ordinary editable properties are frontmatter.
- Folder and table views are projections over files and properties.
- Notidian is the only intended database engine and interface for this fork.
- Notidian context MDB files store view state, ordering, formulas, relations, legacy compatibility state, and explicitly Notidian-owned fields.
- Native Obsidian Bases and `.base` files are not active runtime targets, compatibility pillars, or roadmap assumptions.
- Existing Obsidian tools such as Properties, Dataview, scripts, and direct YAML edits should see the same ordinary file data.

The main rule is that file-backed data must not silently become governed by a hidden context database.

## Current Behavior

Notidian currently implements the core Obsidian-native database foundation:

- Folder contexts can materialize existing frontmatter properties as visible table columns.
- Frontmatter-backed columns are marked with `source: "frontmatter"`.
- Frontmatter-backed edits write to the Markdown file before Notidian accepts the context edit.
- Frontmatter-backed edits are skipped if the file metadata changed outside Notidian after the table row was rendered.
- Frontmatter-backed and computed values are stripped before context MDB persistence, so MDB rows do not become the durable source of truth.
- The built-in `File` column behaves like a Notion-style page title column.
- Editing a page title performs a controlled file rename transaction.
- Rename transactions preserve context row order, deduplicate renamed rows, and return explicit failure reasons for deterministic handling.
- Rectangular table selections support copy, cut, paste, delete/clear, arrow movement, and TSV interoperability with spreadsheet-like tools.
- Normal cell edits, field-value edits, and paste value writes share one authority-aware transaction executor.
- Paste operations show pending, failed, and skipped cell feedback derived from transaction results.
- Direct value edits, field-option edits, and page-title rename edits show pending/failed/skipped cell feedback and reset failed optimistic editor state back to canonical data.
- Bulk paste, cut, delete/clear, fill-from-single-cell paste, and page-title paste can be undone with `Cmd/Ctrl+Z` through the same authority-aware write paths.

This is intentionally not a hidden Make.md-style parallel database and not a native Bases wrapper. Contexts remain the current view/configuration engine while files and frontmatter remain the durable data layer.

Active Notidian vault storage lives under `.notidian`. Retired `.space` folders are legacy migration input only; use `npm run migrate:space-store -- --vault-path="<vault>"` for a dry-run inventory before any approved write migration. Runtime vault adapter calls also normalize exact legacy storage path segments (`.space` and `.makemd`) to `.notidian` so stale listeners cannot recreate retired roots after an update.

## Documentation

The documentation entry point is [docs/README.md](docs/README.md). For practical table behavior, use [Table Database Workflows](docs/table-database-workflows.md). For live Obsidian smoke verification, use [Real Vault Smoke Harness](docs/real-vault-smoke-harness.md). The current implementation reference is [docs/current-state.md](docs/current-state.md). Durable architectural decisions live in [docs/adr](docs/adr/README.md); historical design and execution plans live under `docs/superpowers`.

The most important records are:

- [ADR 0001: Authority-partitioned database model](docs/adr/0001-authority-partitioned-database-model.md)
- [ADR 0002: Frontmatter-backed context columns](docs/adr/0002-frontmatter-backed-context-columns.md)
- [ADR 0003: Editable page titles through file renames](docs/adr/0003-editable-page-titles-through-file-renames.md)
- [ADR 0006: Unified table edit transactions](docs/adr/0006-unified-table-edit-transactions.md)
- [ADR 0007: Table edit feedback](docs/adr/0007-table-edit-feedback.md)
- [ADR 0008: Table undo journal](docs/adr/0008-table-undo-journal.md)
- [ADR 0009: Frontmatter conflict detection](docs/adr/0009-frontmatter-conflict-detection.md)
- [ADR 0010: Legacy context audit and migration](docs/adr/0010-legacy-context-audit-and-migration.md)
- [ADR 0014: Notidian-only personal database engine](docs/adr/0014-notidian-only-personal-database-engine.md)
- [ADR 0015: Canonical schema planning](docs/adr/0015-canonical-schema-planning.md)

ADR 0003 is the canonical full record for why direct file-name editing was problematic, what solution was chosen, and how the implemented rename transaction handles the risks.
Historical ADRs and `docs/superpowers` records are preserved for context, but they do not override the current Notidian-only architecture.

## Compatibility

Notidian uses the Obsidian plugin id `notidian`. This means it installs separately from the original `make-md` plugin.

On first load, Notidian prefers its own plugin data directory:

```text
.obsidian/plugins/notidian
```

Notidian does not automatically read or migrate data from the original Make.md plugin directory. Legacy Make.md context data should be handled through the explicit read-only audit and migration-planning tools before any user-approved migration. New plugin data reads and writes target the Notidian plugin directory, and active vault storage writes target `.notidian`.

## Status

This fork is in active development. The current foundation is implemented and documented. The next high-value work is:

- Redo support for table operations.
- Richer conflict diff/merge UI beyond the current inline Reload and Apply anyway actions.
- Broader real-vault UI automation for multi-row paste, copy/cut, rejected title paste, redo, richer conflict merge flows, and metadata timing fixtures.
- Legacy Make.md context-value migration tooling.
- Clear UI indicators for column authority.
- A dedicated move command for changing folders from table rows.
- Broader reconciliation for external file moves/deletes.

## Development

```bash
npm install
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

Install the current build into a local vault plugin directory:

```bash
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
```

Opt-in live vault smoke test:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

## Credits

Notidian is forked from Make.md, which is licensed under the MIT License.

Original project: https://github.com/Make-md/makemd

Parts of the Flow Editor are based on Hover Editor:
https://github.com/nothingislost/obsidian-hover-editor
