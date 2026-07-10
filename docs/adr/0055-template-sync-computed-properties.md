# ADR 0055: Template Sync — Computed Properties with Cross-DB Resolution

## Status

**Superseded by ADR 0058.** ADR 0058 (Accepted 2026-07-02) resequences this design
as Data Integrity Program Wave 4 rather than a standalone build — do **not** build
from the original 3-phase plan below (it reproduces the D1 stored-copy-drift bug).
Epic `Notidian-v341` closed superseded-by-sequencing. Retained for the decision trail.

**Proposed** — design ratified by owner 2026-06-30; awaiting sessionized build.
Replaces the reverted grouping island header (mx0k.2) with a general-purpose
mechanism.

## Date

2026-06-30

## Context

### The problem the island solved narrowly

When a table is grouped by a foreign key (e.g. `board_id: 2`), the group header
shows the raw FK value — meaningless without the target record's context. The
reverted island (mx0k.2) resolved target fields at render time and joined them
with separators. This was:

- Narrow: only worked in group headers, nowhere else
- Inflexible: no template formatting (the owner wants
  `{2} 🌎 Fill, Tap and Other Sols (DC-) SSR 32CH`, not `2 · Fill... · SSR`)
- A maintenance surface: 800+ lines of island-specific code + tests + config UI

### What the owner wants instead

A general-purpose **template sync layer** that:
1. Computes a formatted display string from a template over a row's own fields
2. Can pull fields from related records via FK (key-match) resolution
3. Writes the result to frontmatter so it's available for grouping, sorting, and
   filtering without special rendering code
4. Syncs reactively (two-way: changes on either side of a FK trigger recomputation)
5. Is reusable across any database and any property

### What already exists

- **Key-match FK resolver** (mx0k.1, kept): `resolveKeyMatch()` resolves a plain
  frontmatter value against a target database's matching field, returning matched
  file paths. Pure, read-only, 96 lines, 314 tests passing.
- **Rollup runtime**: `computeRowRollup()` aggregates target-record fields.
  Template sync reuses the same resolution path but returns a formatted string
  instead of an aggregate.
- **Indexer**: processes file changes reactively, maintains `pathsIndex` and
  `contextsIndex`. Natural home for sync triggers.

## Decision

### D1: Template syntax — simple interpolation, not a formula engine

Template strings use `{fieldName}` for local field substitution and
`{fkField->TargetFolder.targetKey:displayField}` for cross-DB lookups.
Literal text (braces, parens, emoji, spaces) is preserved as-is.

Example — Board Registry `display` template (local fields only):
```
{{{slave}}} {emoji} {board_name} ({electricity_type}) {board_type} {channels}
```
Produces: `{2} 🌎 Fill, Tap and Other Sols (DC-) SSR 32CH`

Example — Sensor `board_display` template (cross-DB lookup):
```
{board_id->Board Registry.board_id:display}
```
Produces: `{2} 🌎 Fill, Tap and Other Sols (DC-) SSR 32CH` (pulled from the
Board Registry row whose `board_id` matches this sensor's `board_id`)

**Ruled out:** A full formula engine (conditionals, functions, arithmetic). The
template is pure string interpolation. If formula support is needed later, it
can layer on top without changing the template-field contract.

### D2: Computed value storage — frontmatter

The computed value is written to the row's YAML frontmatter as a regular
property. This makes it:
- Available for grouping, sorting, filtering, and search by any tool
- Visible in the YAML (transparent, not hidden state)
- Independent of Notidian running (the value persists)

The property is marked as `source: "notidian"` in the column config so Notidian
knows it owns the write. Manual edits are overwritten on the next sync cycle.

**Ruled out:** MDB-only storage. The owner wants to group by the computed value,
and while MDB columns are groupable within Notidian, frontmatter storage is more
interoperable and survives plugin-disable.

### D3: Sync trigger — Indexer event, debounced

Sync fires when the Indexer processes a file change:
1. **Local deps**: if a row has template fields referencing its own properties,
   and any of those properties changed, recompute and write back.
2. **Cross-DB deps**: if a target-database row changed, find all source rows
   whose templates reference that target, recompute and write back.
3. **FK change**: if a source row's FK value changed, re-resolve the cross-DB
   reference and recompute.

Sync is debounced to avoid write storms during bulk edits.

### D4: Two-way semantics — reactive propagation, not reverse parsing

"Two-way sync" means changes propagate reactively in both directions across a
FK relationship:
- **Forward**: Board Registry field changes -> Board Registry `display`
  recomputes -> all Sensors referencing that board recompute their
  `board_display`
- **Re-resolution**: Sensor's `board_id` changes -> `board_display` re-resolves
  against the new Board Registry row

**Not supported**: editing the computed value to update source fields (reverse
parsing). Template formatting is lossy — the string `{2} 🌎 Fill, Tap...`
cannot unambiguously decompose back to `slave=2, emoji=🌎, board_name=Fill...`.
To edit constituent fields, edit them directly on the source row.

### D5: Cycle detection — reject at config time

Template fields cannot reference other template fields on the same row (no
self-referential cycles). Cross-DB cycles (A references B which references A)
are detected at config time and rejected with a user-visible error. The
dependency graph is a DAG.

### D6: Template field configuration — column config in MDB schema

The template string is stored in the column's `value` JSON in the MDB schema,
alongside existing rollup/relation configs. This is consistent with how rollup
definitions are stored (ADR 0029 B1) and avoids a separate config surface.

```json
{
  "template": "{{{slave}}} {emoji} {board_name} ({electricity_type}) {board_type} {channels}",
  "type": "local"
}
```

For cross-DB templates:
```json
{
  "template": "{board_id->Board Registry.board_id:display}",
  "type": "lookup",
  "keyMatch": {
    "sourceField": "board_id",
    "targetFolder": "Gidi/Hardware/Board Registry",
    "targetField": "board_id"
  }
}
```

## Consequences

### Positive
- General-purpose: any database can have computed display fields
- No special rendering code for group headers — just group by the computed field
- Frontmatter storage makes the value tool-agnostic
- Reactive sync means the owner never manually updates display names
- Key-match resolver (mx0k.1) is reused, not duplicated

### Negative
- Writes derived data to frontmatter (extra properties in YAML)
- Sync engine is more code than the island (~300-500 lines vs 113)
- Cross-DB sync needs a dependency tracker (new infrastructure)
- Debounced writes mean a brief window where values are stale after a change

### Risks
- Write storms: changing a Board Registry row could trigger writes to many
  sensor files. Mitigated by debouncing and batched writes.
- Stale values: if Notidian is disabled, computed values freeze at their last
  state. Acceptable — the values are correct as of the last sync.
- Frontmatter pollution: computed properties are visible in YAML. Mitigated by
  `source: "notidian"` marking and clear naming convention.

## Implementation Plan

Sessionized as window-sized issues under a new epic:

**Phase 1 — Template engine + local-field sync** (~150 LOC)
- Template parser: extract `{fieldName}` references
- Template evaluator: substitute values from frontmatter
- Save-time hook: recompute on field change, write to frontmatter
- Config UI: template field definition in property type menu
- Use case: Board Registry `display` field

**Phase 2 — Cross-DB lookup sync** (~200 LOC)
- Cross-DB template syntax: `{fk->DB.key:field}`
- Key-match resolution integration (reuse mx0k.1 resolver)
- Dependency tracker: Map<targetPath -> sourcePaths>
- Reactive cross-DB sync via Indexer events
- Use case: Sensor `board_display` pulled from Board Registry

**Phase 3 — Cascade + performance** (~150 LOC)
- Multi-hop propagation (Board Registry -> Sensors in one Indexer cycle)
- Debounced batch writes for bulk changes
- Cycle detection at config time
- Performance characterization tests

## Related

- ADR 0029: Frontmatter-link relations + rollups (foundation)
- ADR 0017: Explicit Notidian ownership (authority model for computed properties)
- Reverted: commit `206f710` (group island header, mx0k.2) — replaced by this
- Kept: commit `a6044ae` (key-match FK resolver, mx0k.1) — reused by this
