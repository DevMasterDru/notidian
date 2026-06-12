# Type Profiles From Hub Notes (Notidian-5qr)

Date: 2026-06-12
Bead: Notidian-5qr
Status: approved by user (interactive brainstorm, this session)

## Problem

Atlas Method ADR-0008: each database's adjacent hub note carries
`schema_type: notidian_type_profile` + a `fields:` map — the hub IS the
schema source. Notidian has a pure schema planner (ADR-0015) but nothing
reads Type Profiles, so hub schemas and table columns drift independently.
Depends on the 7oj adjacency fix: `space.notePath` now resolves to the real
hub note.

## Decisions (user-approved)

1. **Auto-apply on space load**: opening a database whose hub declares a
   profile materializes missing fields as frontmatter-backed columns
   (planner-backed, no row writes) and refreshes select options.
2. **Two-way sync**: Notidian schema writes (column add, canonical
   frontmatter-key rename, select option add) mirror back into the hub's
   `fields:` map. Mirror fires only when the space already declares a
   profile; Notidian never creates a profile uninvited.
3. **Kinds v1**: text, select(options), date, number, checkbox, link/url;
   `password` parses but maps to text until Notidian-k6e. Unknown kinds
   degrade to text columns with a visible warning issue, never an error.
4. **Select options**: hub options seed/refresh the column on apply
   (hub-first order, table-local extras kept); in-table option additions
   write back to the hub (two-way resolution of the seed-vs-drift tension).

## Design

### Pure module `src/core/utils/contexts/typeProfile.ts`

- `parseTypeProfile(frontmatter)` → `{ database?, fields: TypeProfileField[],
  issues: TypeProfileIssue[] } | null` (null when `schema_type` is not
  `notidian_type_profile`). Field: `{ name, kind, type (mapped MDB type),
  options?, required?, value? }`. Tolerates `fields` as object map or
  JSON-stringified object (Obsidian metadata cache may stringify nested
  YAML).
- `planTypeProfileApply(profile, table)` → `{ changed, cols }`: adds missing
  fields as columns with `source: "frontmatter"`; refreshes option columns'
  option lists (hub-first, keep table-local extras); strict no-op when the
  table conforms.
- Implementation amendment (live-verified): the profile owns the kind for
  frontmatter-backed columns — a column auto-materialized from observed row
  values (e.g. `status` inferred as text) is retyped to the profile's mapped
  type (`option`, `date`, …) before option seeding. Multi-variants
  (`option-multi`) and non-frontmatter-backed columns are left untouched.
- `planFieldsMirror(profile, change)` where change is
  `{ kind: "add-column", name, type } | { kind: "rename-key", oldName,
  newName } | { kind: "add-option", name, option }` → `{ changed, fields }`
  preserving unknown field attributes and map order; `changed: false` when
  equivalent (loop/echo prevention).
- MDB type → profile kind reverse map for mirroring (option→select,
  boolean→checkbox, etc.).

### Hub → table (auto-apply)

In the primary-table load path next to the existing
`materializeFrontmatterBackedContextTable` materialization: read the hub
profile (space `notePath` frontmatter via `spaceManager.readProperties`),
apply `planTypeProfileApply`, persist through the existing
`_.isEqual`-guarded `saveContext` so unchanged tables write nothing.
Applies to the default context schema (primary table) only.

### Table → hub (mirror)

Hook the three schema-write paths (column add; `Rename Frontmatter Key`;
select option persistence). After the table write succeeds, load the
profile; if present and `planFieldsMirror` reports a change, write the new
`fields` map to the hub via `spaceManager.saveProperties(notePath, ...)`.
Only the `fields` key is written; all other hub frontmatter is untouched.

## Error handling

- Unreadable/absent hub frontmatter → no profile → both directions no-op.
- Malformed `fields` entries produce issues and are skipped, never thrown.
- Mirror failures must not roll back the table write; they surface as a
  console warning (hub file may be open/locked).

## Testing

- Jest: parser matrix (kinds, unknown kind degradation, stringified fields,
  missing schema_type, malformed entries).
- Jest: apply-plan (missing columns, option refresh order, conformant
  no-op).
- Jest: mirror-plan (add/rename/option, echo suppression, unknown-attr
  preservation).
- Gates: full Jest, tsc, build; live check on the Reviews database (profile
  columns appear; adding an option writes back to Reviews.md).

## Out of scope

- Membership predicate (`database: <slug>`), required-field validation UI,
  deletion sync (column deletion remains blocked), per-DB templates.
