# Notidian

Notidian is an independent fork of Make.md for Obsidian. The fork is focused on making local Markdown files behave like a durable, Notion-style database system without separating data governance from Obsidian's native files and properties.

## Direction

Notidian uses an authority-partitioned database model:

- A row is a Markdown file.
- The page title is the file name/path.
- Ordinary editable properties are frontmatter.
- Folder and table views are projections over files and properties.
- Notidian context MDB files store view state, ordering, formulas, relations, compatibility cache state, and explicitly Notidian-owned fields.
- Existing Obsidian tools such as Properties, Bases, Dataview, scripts, and direct YAML edits should see the same data.

The main rule is that file-backed data must not silently become governed by a hidden context database.

## Current Behavior

Notidian currently implements the core Obsidian-native database foundation:

- Folder contexts can materialize existing frontmatter properties as visible table columns.
- Frontmatter-backed columns are marked with `source: "frontmatter"`.
- Frontmatter-backed edits write to the Markdown file before Notidian accepts the context edit.
- Frontmatter-backed and computed values are stripped before context MDB persistence, so MDB rows do not become the durable source of truth.
- The built-in `File` column behaves like a Notion-style page title column.
- Editing a page title performs a controlled file rename transaction.
- Rename transactions preserve context row order, deduplicate renamed rows, and return explicit failure reasons for deterministic handling.
- Rectangular table selections support copy, cut, paste, delete/clear, arrow movement, and TSV interoperability with spreadsheet-like tools.
- Normal cell edits, field-value edits, and paste value writes share one authority-aware transaction executor.
- Paste operations show pending, failed, and skipped cell feedback derived from transaction results.
- Direct value edits, field-option edits, and page-title rename edits show pending/failed/skipped cell feedback and reset failed optimistic editor state back to canonical data.

This is intentionally not a wholesale replacement of Make.md contexts with `.base` files yet. Contexts remain the view/configuration engine while files and frontmatter remain the durable data layer.

## Documentation

The documentation entry point is [docs/README.md](docs/README.md). The current implementation reference is [docs/current-state.md](docs/current-state.md). Durable architectural decisions live in [docs/adr](docs/adr/README.md); historical design and execution plans live under `docs/superpowers`.

The most important records are:

- [ADR 0001: Authority-partitioned database model](docs/adr/0001-authority-partitioned-database-model.md)
- [ADR 0002: Frontmatter-backed context columns](docs/adr/0002-frontmatter-backed-context-columns.md)
- [ADR 0003: Editable page titles through file renames](docs/adr/0003-editable-page-titles-through-file-renames.md)
- [ADR 0004: Authority hardening transactions and reconciliation](docs/adr/0004-authority-hardening-transactions-and-reconciliation.md)
- [ADR 0005: Obsidian Bases alignment without replacing contexts](docs/adr/0005-obsidian-bases-alignment-without-replacing-contexts.md)
- [ADR 0006: Unified table edit transactions](docs/adr/0006-unified-table-edit-transactions.md)
- [ADR 0007: Table edit feedback](docs/adr/0007-table-edit-feedback.md)

ADR 0003 is the canonical full record for why direct file-name editing was problematic, what solution was chosen, and how the implemented rename transaction handles the risks.

## Compatibility

Notidian uses the Obsidian plugin id `notidian`. This means it installs separately from the original `make-md` plugin.

On first load, Notidian prefers its own plugin data directory:

```text
.obsidian/plugins/notidian
```

If Notidian data does not exist yet, it can read legacy Make.md data from:

```text
.obsidian/plugins/make-md
```

New writes target the Notidian plugin directory. Keep a backup of your vault before switching plugins.

## Status

This fork is in active development. The current foundation is implemented and documented. The next high-value work is:

- Undo journal for bulk table operations.
- External edit conflict detection.
- Real vault fixture integration tests for metadata reload timing.
- Legacy Make.md context migration tooling.
- Clear UI indicators for column authority.
- A dedicated move command for changing folders from table rows.
- Broader reconciliation for external file moves/deletes.
- `.base` import/export or bridge behavior where semantics match.

## Development

```bash
npm install
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

## Credits

Notidian is forked from Make.md, which is licensed under the MIT License.

Original project: https://github.com/Make-md/makemd

Parts of the Flow Editor are based on Hover Editor:
https://github.com/nothingislost/obsidian-hover-editor

Dataview syncing was adapted with help from Metadata Menu:
https://github.com/mdelobelle/metadatamenu
