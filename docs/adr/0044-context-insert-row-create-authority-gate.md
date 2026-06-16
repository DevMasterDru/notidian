# ADR 0044: Should `api.context.insert` apply a per-field authority gate on row-create?

## Status

Accepted.

Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Review correction (bd `Notidian-2yh`):** the create-path MDB sink is
`addRowInTable` (an INSERT), **not** `updateValueInContext` (an UPDATE). On a
row-**create** the new path's MDB row does not exist yet — `newPathInSpace` writes
only the file + its frontmatter; the context MDB learns of the new file later, via
the async file-watcher/reload pipeline (`updateContextWithProperties` /
`addPathInContexts`, which await nothing here). `updateValueInContext`
(`context.ts`) mutates **only an existing row** (`mdb.rows.map(... === row ...)`)
and is a **silent no-op** when no row matches (`_.isEqual(mdb, newDB)` is true, so
`saveContext` never runs). Routing a context-only field through it on create would
drop the value **entirely** — persisted nowhere, strictly worse than the un-gated
behavior that at least left it in the new file's YAML. The fix uses
`addRowInTable`, which `insertRows` a fresh row carrying the path identity plus the
context fields; the later reload reconciliation (keyed on `PathPropertyName`)
**merges** frontmatter onto that row rather than appending a duplicate. The prose
below that still says `updateValueInContext` describes the original (defective)
prescription; the implemented sink is `addRowInTable`.

Awaiting an owner decision. Tracked by bd `Notidian-2yh` (a DESIGN-OPEN /
DECISION-typed bead discovered from `Notidian-e48`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blindly editing `api.ts`**: the authority-partition
semantics on row-**create** are genuinely undecided (a defensible argument exists
both ways), and the current no-gate behavior is **pinned as characterization** in
`api.authority.context.test.ts` — that assertion must be **deliberately
re-blessed** as part of any change, which is a decision posture, not a blind edit
(same pattern as ADR 0025 / 0030 / 0032 / 0033 / 0043, where pinned
characterization assertions are flipped only by a reviewed decision). **No code or
test change is made on this route** — the bead stays OPEN awaiting the owner's
pick, and the locked assertion is **not** flipped until then.

## Date

2026-06-16

## Context

### The asymmetry, exactly

Notidian has three programmatic value-write verbs. Two of them route every field
through the authority gate `apiFieldWriteTarget`
(`src/core/utils/contexts/apiValueWrite.ts`); the third — the row-**create**
verb — does not.

`api.context.update` (`src/core/superstate/api.ts:285-306`) gates each edit:

```ts
const target = apiFieldWriteTarget(
  field,
  [this.superstate.contextsIndex.get(path)?.contextTable],
  "context"
);
if (target === "skip") return;                              // computed/read-only
if (target === "frontmatter") { saveProperties(...); return; }  // file-backed
updateValueInContext(...);                                  // notidian/context-only
```

`api.path.setProperty` (`api.ts:43-69`, via `writePathProperty`) does the same
with a `"frontmatter"` default.

`api.context.insert` (`api.ts:307-334`) — the default `'files'` schema branch —
does **not**:

```ts
insert: async (path, schema, name, row) => {
  if (schema == defaultContextSchemaID) {
    newPathInSpace(this.superstate, this.superstate.spacesIndex.get(path), "md", name, true)
      .then(f => {
        if (row) {
          delete row[PathPropertyName];
          saveProperties(this.superstate, f, { ...(row ?? {}) }); // WHOLE row -> file YAML
        }
      });
  } else { /* non-default schema -> table.insert */ }
}
```

It strips only `PathPropertyName` and writes the **entire** input row to the new
file's frontmatter via `saveProperties`, with **no per-field authority gate**. A
`source:"notidian"` column, a context-only column, and a computed/read-only
column (rollup/backlink/fileprop/aggregate) all land in the new file's YAML —
exactly the three cases the gate routes elsewhere on `update`/`setProperty`.

### The characterization that pins this

`src/core/superstate/api.authority.context.test.ts` exists *specifically* to make
this asymmetry visible. Its CHARACTERIZATION case (lines 196-226) asserts:

```ts
// space defines `manual` as source:notidian and `total` as a computed rollup
await api.context.insert(spacePath, defaultContextSchemaID, "Leaky", {
  manual: "kept",
  total: "999",
});
// CURRENT behavior: BOTH fields written to frontmatter — no gate routes
// `manual` to the MDB or skips the computed `total`.
expect(saveProperties).toHaveBeenCalledWith(superstate, createdPath, {
  manual: "kept",
  total: "999",
});
expect(updateValueInContext).not.toHaveBeenCalled();
```

The file's own header (lines 12-19) flags this as the intended decision point: the
insert cases "pin the verb's current behavior ... so a future authority-gate
change to insert is a deliberate, test-visible decision rather than a silent
drift." Any change here MUST flip that assertion as a reviewed decision.

### The authority partition this question sits inside

ADR 0001 (authority-partitioned database model) and ADR 0017 (explicit Notidian
ownership) establish that a column's **durable home** is resolved by
`propertyAuthorityForColumn` (`src/core/utils/properties/propertyAuthority.ts`):

- `computed` (`fileprop`/`aggregate`/`rollup`/`backlink`) — a derived value,
  **never persisted** (`apiValueWriteTarget` -> `"skip"`).
- `frontmatter` — the visible, portable file layer (the safe default for ordinary
  metadata; ADR 0017 routes ambiguity here).
- `notidian` (explicit `source:"notidian"`) **or context-only types**
  (`context`/`object`/`flex`/...) — the **MDB is the only durable home**
  (`apiValueWriteTarget` -> `"context"`).
- `file` / unresolved column — keep the verb's pre-gate default.

The whole point of the gate (ADR 0001's core promise) is that **file-backed and
MDB-owned data must not blur**: a declared-Notidian column's value must not leak
into the visible file, and a frontmatter column's value must not leak into the
hidden store. `update`/`setProperty` were brought under this gate in
`Notidian-1da`; `insert` was left out.

### Why this is a genuine decision, not a blind one-liner

On an **update** the gate prevents a *leak from a prior value*. On a row-**create**
there is no prior value: the file is brand new (empty YAML) and the row is
caller-supplied seed input. So a defensible argument exists that insert's job is
legitimately "seed the visible file's frontmatter," and gating it is
unnecessary — which is why this is DESIGN-OPEN, not a bug with one right answer.
The counter-argument (the recommendation below) is that the durable-home partition
does not depend on *when* the write happens: seeding a declared `source:"notidian"`
column to a new file's YAML re-introduces the same frontmatter-vs-MDB split the
gate exists to prevent, and seeding a *computed* value persists a derived snapshot
(a known footgun). Plus any change flips the pinned characterization — an
owner-ratified posture, not a silent edit.

## Decision drivers

- **Authority-partition consistency** — `insert` is the one un-gated value-write
  verb; `update` and `setProperty` both gate. An authority hole on create grows as
  more columns declare `source:"notidian"`.
- **No frontmatter-vs-MDB split** — a declared-Notidian / context-only column's
  only durable home is the MDB; writing it to file YAML on create splits authority
  for that fact from the moment the row is born.
- **Never persist a derived value** — a computed column's value is recomputed at
  render; seeding a snapshot of it into frontmatter is the exact footgun
  `apiValueWriteTarget -> "skip"` guards against on every other write.
- **Smallest deliberate change to the pinned characterization** — reuse the
  existing gate; flip only the assertion that documents the un-gated behavior.
- **Preserve the legitimate seed job** — ordinary frontmatter columns and
  unresolved/file-backed fields must still land in the new file's YAML as today.
- **Re-bless the locked assertion explicitly**, never silently.

## Options

### Option A — NO GATE (status quo)

Leave `insert` writing the whole row (minus `PathPropertyName`) to the new file's
frontmatter, ungated.

- **Pros:** simplest; on a brand-new path there is no prior column value to
  *leak from*; the row is caller-supplied seed input over an empty file, and
  "seed the visible file's frontmatter" is a legitimate job. No characterization
  flip.
- **Cons (decisive):** leaves `insert` as the **one un-gated value-write verb** —
  an authority hole inconsistent with `update`/`setProperty`. A declared
  `source:"notidian"` column is seeded into file YAML, creating a
  frontmatter-vs-MDB split for that fact at row birth (the very thing ADR 0001's
  gate prevents); a computed/read-only column is seeded as a persisted derived
  snapshot. The hole **grows** as more columns declare `source:"notidian"` or use
  context-only types. Rejected.

### Option B (recommended) — FULL GATE (mirror `update`/`setProperty`)

Route each insert field through `apiFieldWriteTarget` (default `"context"`, the
same default `update` uses for the folder-context table), before/while writing the
new file:

- `"frontmatter"` field -> include it in the `saveProperties` map (the new file's
  YAML) — the seed job, preserved for ordinary metadata.
- `"context"` field (explicit `source:"notidian"` / context-only type) -> write it
  to the new path's context MDB via `updateValueInContext` (its declared durable
  home), **not** the file YAML.
- `"skip"` field (computed/read-only) -> drop it (never persist a derived value).
- unresolved / `file` field -> keep today's behavior (frontmatter / identity).

`PathPropertyName` is still stripped first. The frontmatter write keeps using
`saveProperties`; only the *partitioning* of which fields go where changes.

- **Observable effect (the pinned case):** `insert("Leaky", { manual:"kept",
  total:"999" })` with `manual` = `source:"notidian"` and `total` = rollup now
  writes `manual` to the **context MDB** and **drops** `total`; `saveProperties`
  is called with neither (or an empty map). An ordinary `{ status:"done",
  priority:"high" }` row over a schema with no such markers still lands wholly in
  frontmatter exactly as today.
- **Pros:** makes `insert` **consistent with the already-gated `update`/
  `setProperty`** path it should mirror; the durable-home partition (ADR
  0001/0014/0017) is honored from row birth — a declared-Notidian column lands in
  the MDB, a computed value is never persisted, ordinary metadata still seeds the
  visible file; closes the last un-gated value-write verb. Reuses an existing,
  tested gate (`apiFieldWriteTarget`) — no new authority logic.
- **Cons:** must **deliberately update** the `api.authority.context.test.ts`
  CHARACTERIZATION (the `manual`+`total` case) from "both -> frontmatter" to
  "`manual` -> context MDB, `total` skipped"; that is the intended re-blessing, not
  a regression. Slightly more I/O on create when notidian/context-only columns are
  present (one MDB write per such field, as `update` already does).

### Option C — PARTIAL GATE (skip computed only; still seed `source:notidian` to frontmatter)

Skip only computed/read-only fields on insert (don't persist a derived value), but
still seed `source:"notidian"` / context-only fields into the new file's
frontmatter for visibility.

- **Pros:** closes the worst case (persisting a derived value); keeps a single
  `saveProperties` write path (no MDB write added on create); a freshly-created
  row's declared-Notidian seed value is at least *visible* in the file.
- **Cons (decisive):** a **half-measure** — it still seeds an MDB-owned field into
  frontmatter, which is the **main split Option B prevents**. It creates exactly
  the frontmatter-vs-MDB divergence for `source:"notidian"` columns that the gate
  exists to stop: the field's durable home is the MDB, but its seed value lives in
  the file, so the next `update`/materialization pass must reconcile two locations
  for one fact at row birth. It also makes `insert` behave *differently from*
  `update`/`setProperty` for the same column (gate-for-computed, leak-for-notidian)
  — a third, inconsistent partition. Rejected.

## Recommendation

**Option B — FULL GATE: route each insert field through `apiFieldWriteTarget` so a
`source:"notidian"` / context-only field lands in its declared durable home (the
context MDB) and a computed/read-only field is skipped, while ordinary frontmatter
fields still seed the new file's YAML — and deliberately re-bless the
`api.authority.context.test.ts` characterization.** One line of why: the authority
partition (ADR 0001/0014/0017) makes the MDB the **only** durable home for a
declared `source:"notidian"` column, so writing it to a new file's YAML on insert
re-introduces exactly the frontmatter-vs-MDB split the gate exists to prevent (and
seeding a computed value persists a derived snapshot) — B makes `insert` consistent
with the already-gated `update`/`setProperty` verb it should mirror, at the cost of
one deliberate characterization update.

### Ruled out

- **Option A (no gate, status quo)** — leaves `insert` as the one un-gated
  value-write verb, an authority hole inconsistent with `update`/`setProperty`
  that grows as more columns declare `source:"notidian"`. A declared-Notidian
  column is seeded into file YAML (a split at row birth) and a computed value is
  persisted as a snapshot.
- **Option C (partial gate)** — a half-measure: it still seeds the MDB-owned
  field to frontmatter, the **main split Option B prevents**, and makes `insert`
  partition fields a *third* way (different from both `update`/`setProperty` and
  from A).
- **A default-OFF runtime flag** — not applicable: the gate is pure, deterministic
  routing logic with no render-path / `innerHTML` surface, and its correctness is
  fully offline-provable (the harness mocks the durable sinks and observes
  routing). The verification is jest, not eyes-on-vault — the no-flag posture of
  ADR 0025/0030/0032/0033/0043. (If the owner wants a *behavior* sample in a real
  vault before ratifying, the cheap step is the spike in **Consequences**, not a
  persisted flag.)
- **Editing `api.ts` / flipping the locked characterization now (a blind build)** —
  the create-time partition semantics are genuinely owner-open, and re-blessing a
  pinned characterization is an owner call; hence an ADR, with the bead OPEN.

## Consequences

If the owner approves **B**, the implementing session:

1. routes each field of the insert row through `apiFieldWriteTarget(field,
   [contextTable], "context")` in `api.context.insert`'s default-schema branch —
   collecting `"frontmatter"` fields into the `saveProperties` map, writing
   `"context"` fields to the new path's MDB via `updateValueInContext`, dropping
   `"skip"` fields, and keeping unresolved/`file` fields on today's path;
   `PathPropertyName` is still stripped first;
2. **flips the locked CHARACTERIZATION** in `api.authority.context.test.ts`
   (lines 196-226) from "`manual` + `total` both -> frontmatter" to "`manual` ->
   context MDB (`updateValueInContext`), `total` skipped, `saveProperties` called
   with the gated subset," and rewords the file header to describe the now-gated
   verb — with a comment noting the re-blessing and citing this ADR + `Notidian-2yh`;
3. confirms the **non-default-schema** branch and the ordinary
   all-frontmatter / empty-row cases are unchanged (the existing passing cases at
   lines 162-194, 228-259 must stay green);
4. closes `Notidian-2yh`.

The routing is pure, offline-provable logic exercised through the existing
mocked-sink harness, so the gate is **jest** (`npm test`) + tsc + build green —
**no default-OFF flag.** If the owner wants a real-vault behavior sample first,
the cheap, optional first step is a throwaway spike that *logs* (does not change)
the gate decision per insert field against the working vault's actual context
tables, to confirm no surprising column would be re-routed — but the decision
itself (gate vs no-gate) is what this ADR defers. Until a pick, **no `api.ts` or
`api.authority.context.test.ts` change is made** and the locked characterization
is **not** flipped.

This ADR applies, and does not supersede, ADR 0001 / 0014 / 0017 (it extends the
`Notidian-1da` write-surface gate to the remaining un-gated verb).
