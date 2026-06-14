# ADR 0017: Explicit Notidian Ownership (Eliminating The Silent Authority Fallback)

## Status

Accepted.

## Date

2026-06-15

## Context

[ADR 0001](0001-authority-partitioned-database-model.md) decided that the context
MDB may persist a column's row value only when the field is **explicitly
Notidian-owned**, and that the MDB is "no longer allowed to silently own ordinary
file-backed data." The code did not match that decision.

`propertyAuthorityForColumn` (`src/core/utils/properties/propertyAuthority.ts`)
classified a column's storage authority as:

1. `file` for the page-title/path column,
2. `frontmatter` for columns marked `source: "frontmatter"`,
3. `computed` for `fileprop` / `aggregate` / `rollup` / `backlink`,
4. **`notidian` for everything else (the fallback).**

That fallback meant any column without a `source` marker — including an ordinary
text/number/etc. column whose frontmatter marker was never set or was lost
(corrupt MDB, a creation path that did not stamp the source, a legacy import) —
was silently treated as durable MDB-owned data. A paste, an undo replay, or a
`syncContextRow` overlay could then write or shadow file-backed metadata inside
the hidden store. This was the root cause behind several audited authority
defects (the "A1 leak", the overstated guarantee in audit finding 8, and
default-new-property MDB ownership).

Worse, the "Notidian-owned field" choice in the add-property menu encoded
ownership *implicitly*: it persisted the column **source-less** and relied on the
fallback to mean "notidian". So a deliberate Notidian-owned column and a column
that had merely lost its marker were indistinguishable.

A scan of every `.notidian/context.mdb` in the working vault found **zero**
source-less non-computed columns: every data column was `file`, `fileprop`
(computed), or explicitly `frontmatter`. The fallback was therefore unreachable
by any real durable data — it only ever fired for the dangerous, ambiguous case.

## Decision

Make Notidian-ownership of a row value **explicit**, and resolve authority
ambiguity toward the visible file layer rather than the hidden store.

`propertyAuthorityForColumn` now resolves, in order:

1. `file` — the page-title/path column.
2. `frontmatter` — `source: "frontmatter"`.
3. `computed` — `fileprop` / `aggregate` / `rollup` / `backlink`.
4. `notidian` — **only** when explicitly marked `source: "notidian"`.
5. Ambiguous (no `source` marker):
   - a **file-backed-compatible type** (`text`, `password`, `number`, `boolean`,
     `date`, `option`, `option-multi`, `link`, `image`, `tags-multi`) resolves to
     `frontmatter` — the durable, portable, visible default;
   - a **context-only type** (`context`, `object`, `flex`, and other types with
     no frontmatter representation) resolves to `notidian`, because the MDB is
     its only possible durable home.

The "Notidian-owned field" picker now persists an explicit `source: "notidian"`
marker. Combined with `defaultPropertySourceForContext` (which already defaults
folder-context properties to `frontmatter`), durable MDB ownership of a
file-backed-compatible column is now reachable **only** through that deliberate,
explicit choice. A missing or lost marker can never again be mistaken for it.

Materialization also respects explicit ownership: a column resolving to
`notidian` is never auto-converted to `frontmatter` merely because a file exposes
a same-named frontmatter key.

No data migration is required: the vault scan confirmed there is no existing
source-less durable data to convert.

## Why This Is The Best Fit

It makes the code honor the promise ADR 0001 already accepted: file-backed data
cannot silently become MDB-governed. Authority is now derived from explicit
markers, and the only *implicit* default is the safe one — the visible file
layer.

The fallback is type-aware rather than uniform so the change is surgical: it
alters behavior for exactly one case (a source-less file-backed-compatible
column, previously `notidian`, now `frontmatter`) and leaves genuinely
context-only types — relations and structured values that have nowhere else to
live — owned by the MDB exactly as before.

## Alternatives Considered

### Keep the fallback as intentional legacy compatibility, and only document it

Rejected. The fallback directly contradicts ADR 0001's accepted decision and the
vault scan showed it guarded no real data. Documenting a known authority hole
rather than closing it would leave the core promise unenforced in code.

### Resolve every source-less column to `frontmatter` (no type-awareness)

Rejected. A source-less context-only column (a relation/object) has no
frontmatter representation; defaulting it to `frontmatter` would try to serialize
relational data into YAML. The type-aware rule preserves existing behavior for
those types while fixing the ordinary-metadata case.

### Guard/reject writes to ambiguous columns

Rejected as the primary behavior. Refusing the write would silently drop user
edits on ambiguous columns. Redirecting them to the visible frontmatter layer
preserves the edit in the durable, inspectable location instead.

## Consequences

Positive consequences:

- A lost or absent `source` marker can no longer leak ordinary metadata into the
  hidden MDB; the unmarked column reflects the live file frontmatter.
- Deliberate Notidian-owned columns are distinguishable from accidental
  source-less columns, and are protected from YAML overlay and auto-conversion.
- The change is provably behavior-preserving for the working vault (no source-less
  non-computed columns exist) and for all context-only types.

Tradeoffs:

- The set of file-backed-compatible types in `propertyAuthority.ts` must stay in
  sync with the frontmatter-storable types in `propertyTypeMenu.ts`. A new
  file-backed property type added to one but not the other would, for a
  source-less column of that type, default toward `notidian`; new property types
  should be added to both (mirrors the computed-type maintenance rule).

## Implementation Notes

- `propertyAuthorityForColumn`, `shouldWriteAuthorityValueToFrontmatter`,
  `shouldPersistAuthorityValueToContext`, and the exported `notidianPropertySource`
  live in `src/core/utils/properties/propertyAuthority.ts`.
- `persistedSourceForPropertyChoice`
  (`src/core/utils/properties/newPropertyDefaults.ts`) maps the add-property
  storage picker to the persisted `source` marker; the picker is wired in
  `newSpacePropertyMenu.tsx`.
- `materializeFrontmatterBackedContextTable`
  (`src/core/utils/properties/allProperties.ts`) skips explicit-Notidian /
  context-only columns when stamping frontmatter sources.
- Regression coverage: `propertyAuthority.test.ts`, `newPropertyDefaults.test.ts`,
  and the flipped characterization test
  `__audit__/a1-sync-leak.audit.test.ts`.

This ADR refines, and does not supersede, ADR 0001.
