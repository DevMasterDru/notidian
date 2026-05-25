# Legacy Context Audit Report

The legacy context audit report inspects one Notidian/Make.md folder context and compares its `context.mdb` table with the Markdown frontmatter for the row files.

It is read-only. It does not write Markdown files, does not write MDB files, and does not apply a migration.

## Run The Report

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```

Useful options:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices" --json
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices" --max-files=1
```

Options:

| Option | Meaning |
| --- | --- |
| `--vault=<path>` | Absolute vault path. Can also be set through `NOTIDIAN_AUDIT_VAULT`. |
| `--folder=<path>` | Required vault-relative folder/context path. |
| `--schema=<id>` | MDB schema id. Defaults to `files`. |
| `--space-subfolder=<path>` | Context metadata folder. Defaults to `.space`. |
| `--format=markdown` | Human-readable report. This is the default. |
| `--json` or `--format=json` | Machine-readable report for future tooling. |
| `--max-files=<n>` | Read only the first `n` row files. `0` means read all row files. |

Paths containing `archive` or `ignore` in any path part are blocked.

## Read The Output

The report includes:

- total rows and columns from the context table;
- how many row files were read for frontmatter;
- whether the frontmatter scan is complete;
- whether the audit is automatically applicable;
- column classifications;
- migration-preview actions;
- blocking issues and warnings.

`Can apply automatically` is `No` whenever the scan is partial. A report created with `--max-files=1` is useful for a quick sanity check, but it is not migration-ready.

## Migration Preview Meaning

| Preview field | Meaning |
| --- | --- |
| `Mark as frontmatter-backed` | Legacy columns that can safely receive `source: "frontmatter"` after a complete scan. |
| `Strip from MDB rows` | Values that can be removed from context row storage after authority is clear. |
| `Add discovered frontmatter columns` | Frontmatter keys present in files but missing from the context schema. |
| `Context-only columns preserved` | MDB-owned fields that are not treated as note metadata. |

Automatic cleanup is blocked by:

- `conflict`: context and frontmatter both have values and they differ;
- `context-only-value`: context has a value but frontmatter does not.

Those blockers protect user data. A future migration UI or CLI must let the user decide whether to keep frontmatter, backfill frontmatter from context, keep the value as context-only, or discard a duplicate.

## Current Boundary

This report is the real-vault inspection layer. The write migration command is still intentionally deferred until conflict/backfill decisions are user-reviewable.
