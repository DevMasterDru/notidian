# ADR 0045: How should `replaceDB` align the REPLACE row VALUES with the CREATE TABLE column list?

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

Tracked by bd `Notidian-k778` (a DESIGN-OPEN /
cleanup-typed bead characterized from `Notidian-xwc6` and grounded by
`Notidian-0jtp`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blindly editing `db.ts`**: the bead itself says
"Decision/cleanup, not an autonomous blind fix — flip the pinned assertion if
changed," and the current asymmetric behavior is **pinned as characterization**
in two places — the pure builder net (`db.sql-builders.test.ts:363-387`) and the
real-engine ground-truth net (`db.realengine.roundtrip.test.ts:552-614`). Both
locked assertions must be **deliberately re-blessed** as part of any change,
which is a decision posture, not a blind edit (same pattern as ADR
0025/0030/0032/0033/0043/0044, where pinned characterization assertions are
flipped only by a reviewed decision). **No code or test change is made on this
route** — the bead stays OPEN awaiting the owner's pick, and the locked
assertions are **not** flipped until then.

## Date

2026-06-16

## Context

### The asymmetry, exactly

`replaceDB` (`src/adapters/mdb/db/db.ts:433-475`) rewrites a whole table per
save. For each table it builds the column definition from a **de-duped,
falsy-filtered** field list, but emits each row's `REPLACE INTO ... VALUES` over
the **full, un-deduped** `cols` array:

```ts
const tableFields = tables[t].cols;
const fieldQuery = serializeSQLFieldNames(uniq(tableFields).
  filter(f => f).map((f) => `${quoteIdent(f)} char`));        // db.ts:439-440
const createQuery = `CREATE TABLE IF NOT EXISTS ${quoteIdent(t)} (${fieldQuery}); `
// ...
const rowsQuery = tables[t].rows.map((curr) => {
  return `REPLACE INTO ${quoteIdent(t)} VALUES (${serializeSQLValues(tableFields
    .map((c) => `'${sanitizeSQLStatement(curr?.[c] ?? "")}'`))});`;  // db.ts:452-453
});
```

So `cols = ['a','a','','b']` produces:

- `CREATE TABLE IF NOT EXISTS "t" ("a" char,"b" char);` — **2 columns**
  (`uniq` collapses the duplicate `"a"`; `.filter(f=>f)` drops the empty name).
- `REPLACE INTO "t" VALUES ('1', '1', '', '2');` — **4 values** (maps the full
  `cols` array, including the duplicate and the empty).

A 4-value `VALUES` list against a 2-column table. The CREATE field list and the
row VALUES list disagree on both **count** and **position**.

### The real-engine ground truth (not a guess)

`db.realengine.roundtrip.test.ts:552-614` pins what sql.js 1.8.0 actually does
with this exact shape — so this decision is grounded in engine truth, not
inference:

- **DIRECT** (`db.exec`): `REPLACE INTO "t" VALUES ('1','1','','2')` against a
  2-column table **THROWS** `table t has 2 columns but 4 values were supplied`.
  It is an **ERROR**, not a silent value-drop.
- **VIA `replaceDB`**: the throw is **swallowed** by `replaceDB`'s `try/catch`
  (`db.ts:467-473`) → `replaceDB` returns **`false`**, `selectDB` → **`null`**
  (no row stored). But the **TABLE SURVIVES** as a 2-column `("a","b")` table,
  because the CREATE ran as its own `db.exec` *before* the REPLACE threw
  (statements are exec'd one at a time in the loop).

So a real-world dup/empty-name `cols` array would **silently lose that table's
rows for the save** (a `false` return, no row written) — it does not corrupt
data, but it drops the write with no surfaced error.

### Why this is latent today, not an everyday break

The production `cols` come from `mdbTablesToDBTables`
(`db.ts:293-305`), which projects `tables[c].cols.map((f) => f.name)` — schema
field **names**, which are normally **unique and non-empty**. The `CONTRAST`
case (`db.realengine.roundtrip.test.ts:599-613`) proves a normal `cols` array
round-trips cleanly. So this is a **latent footgun** gated by an upstream
uniqueness/non-emptiness invariant, not an observed live failure — which is why
it is a cleanup/decision, not an urgent fix.

### The sibling verb already self-documents the same pattern

`insertIntoDB` (`db.ts:349-371`) and `updateDB` (`db.ts:374-397`) share the
same "map VALUES over the full `cols`" shape — but `insertIntoDB`'s CREATE is
done elsewhere (by `saveDBToPath`, `db.ts:534-545`), so the count-vs-CREATE
asymmetry is specific to `replaceDB`, which owns both halves in one function.
`updateDB` emits `col='val'` pairs (explicitly named), so it is already
positionally safe; only `replaceDB` (and the positional `insertIntoDB`) rely on
ordered, count-matched VALUES.

### Why this is a genuine decision, not a blind one-liner

Three credible directions exist (below). The minimal one (B) fixes the *count*
but keeps the statement **positional**; the robust one (A) makes the statement
correct **by construction** but is a larger, behavior-shaped change to the
emitted SQL (an explicit column list) that also touches the two locked
characterization nets; the do-nothing one (C) is defensible *because* the
upstream invariant currently holds. Plus any of A/B flips **two** pinned
characterizations (the builder net AND the empirical engine net) — an
owner-ratified posture, not a silent edit.

## Decision drivers

- **Correct by construction vs. correct by invariant** — should the statement be
  self-consistent regardless of what `cols` carries, or should it keep relying
  on the upstream "names are unique + non-empty" invariant from
  `mdbTablesToDBTables`?
- **Positional fragility** — a bare `REPLACE INTO t VALUES (...)` binds values to
  columns by **position**. Even with matched counts, a future caller that
  reorders `cols` vs. the created column order would mis-map values silently. An
  explicit column list removes positional coupling entirely.
- **Silent write-loss is the failure mode** — when the invariant breaks, the
  current behavior drops the table's rows for that save with only a `false`
  return (no surfaced error), the worst kind of latent footgun.
- **Smallest deliberate change to the two pinned characterizations** — both the
  builder net and the engine net lock today's asymmetry; the fix must flip them
  as a reviewed re-bless, citing this ADR.
- **No new authority/render surface** — this is pure SQL-string construction over
  a sanitized/quoted path (`quoteIdent` + `sanitizeSQLStatement`); offline
  jest-provable, no eyes-on-vault or `innerHTML` surface.

## Options

### Option A (recommended) — EXPLICIT COLUMN LIST in REPLACE, using the same uniq+filtered list

Emit the column names explicitly in the REPLACE statement, derived from the
**same** `uniq(cols).filter(f=>f)` list the CREATE uses, and map the VALUES over
that same list:

```ts
const liveCols = uniq(tableFields).filter((f) => f);
const fieldQuery = serializeSQLFieldNames(liveCols.map((f) => `${quoteIdent(f)} char`));
// ...
const colList = serializeSQLFieldNames(liveCols.map((f) => quoteIdent(f)));
const rowsQuery = tables[t].rows.map((curr) =>
  `REPLACE INTO ${quoteIdent(t)} (${colList}) VALUES (${serializeSQLValues(
    liveCols.map((c) => `'${sanitizeSQLStatement(curr?.[c] ?? "")}'`))});`);
```

- **Observable effect (the pinned case):** `cols = ['a','a','','b']` now emits
  `CREATE TABLE IF NOT EXISTS "t" ("a" char,"b" char);` AND
  `REPLACE INTO "t" ("a","b") VALUES ('1', '2');` — **count- and
  position-matched**, and the row round-trips (`replaceDB` returns `true`,
  `selectDB` returns the row) instead of silently dropping it. The normal,
  already-unique `cols = ['a','b']` case is unchanged in *effect* but now carries
  an explicit `("a","b")` column list in the emitted SQL.
- **Pros:** makes the statement **correct by construction** — self-consistent for
  any `cols` (dup, empty, or reordered), the **only** option robust to both
  dedup AND positional drift. Removes the positional coupling between the created
  column order and the VALUES order entirely; future-proofs against a caller that
  passes `cols` in a different order than the CREATE emits. A genuinely
  dup/empty-name `cols` array now **stores the row** instead of silently losing
  the save. Reuses the existing `uniq`/`filter`/`quoteIdent`/`serializeSQLFieldNames`
  primitives — no new helpers.
- **Cons:** it is a **behavior-shaped** change to the emitted SQL (every REPLACE
  now carries an explicit column list), so it must **deliberately re-bless both**
  locked nets: the builder pin (`db.sql-builders.test.ts:363-387`, the
  `REPLACE INTO "t" VALUES (...)` string and the "VALUES list length follows
  cols.length (4)" comment) AND the empirical engine pin
  (`db.realengine.roundtrip.test.ts:553-597`, which now becomes a *success*
  round-trip, not a throw/false). Slightly longer emitted SQL. (`insertIntoDB`
  is **out of scope** — it does not own its CREATE and stays positional; this ADR
  fixes only `replaceDB`.)

### Option B — MAP REPLACE VALUES OVER THE SAME uniq+filtered LIST (no explicit column list)

Keep the bare `REPLACE INTO t VALUES (...)` form, but map the VALUES over
`uniq(cols).filter(f=>f)` so the count matches the CREATE:

```ts
const liveCols = uniq(tableFields).filter((f) => f);
const rowsQuery = tables[t].rows.map((curr) =>
  `REPLACE INTO ${quoteIdent(t)} VALUES (${serializeSQLValues(
    liveCols.map((c) => `'${sanitizeSQLStatement(curr?.[c] ?? "")}'`))});`);
```

- **Observable effect:** `cols = ['a','a','','b']` emits
  `REPLACE INTO "t" VALUES ('1', '2');` — count now matches the 2-column CREATE,
  row round-trips. Normal case unchanged.
- **Pros:** **minimal** diff — one expression change, no explicit column list,
  no new emitted-SQL shape beyond the value count. Fixes the count mismatch and
  the silent write-loss. Flips the two pins by the smallest delta.
- **Cons (decisive vs. A):** still **positional** — values bind to columns by
  order, so it is **not** robust to column-order drift. If a future caller passes
  `cols` whose `uniq+filter` order differs from the created column order (or the
  CREATE order changes), values mis-map **silently** with no count error to catch
  it. It fixes the symptom (count) but leaves the deeper positional fragility A
  removes. Same primitive reuse as A, for strictly less robustness.

### Option C — KEEP + DOCUMENT the latent asymmetry (rely on the upstream invariant)

Make no code change; keep the two pinned characterizations as the canonical
record that the asymmetry is **intentional-and-bounded**, justified by the
`mdbTablesToDBTables` "names are unique + non-empty" invariant. Optionally add a
one-line code comment at `db.ts:452` pointing to this ADR.

- **Pros:** zero code/test churn; the invariant genuinely holds today (the
  `CONTRAST` case proves clean round-trips for normal `cols`); no re-bless of the
  two locked nets. Honest about present risk being low.
- **Cons (decisive):** leaves a **latent footgun** that fails by **silently
  dropping a table's save** (`false` return, no surfaced error) the moment the
  invariant is violated — by a future caller, a schema with a duplicated/empty
  field name, or a refactor of `mdbTablesToDBTables`. The invariant is **implicit
  and unenforced**: nothing in `replaceDB` checks it, and the failure is
  invisible at the call site. Rejected — A/B both close the hole cheaply with the
  existing primitives; documenting a known silent-data-loss edge instead of
  closing it is the weakest posture when the fix is this small.

## Recommendation

**Option A — emit an EXPLICIT column list in `REPLACE INTO t ("a","b") VALUES
(...)`, derived from the SAME `uniq(cols).filter(f=>f)` list the CREATE uses, and
deliberately re-bless both pinned characterizations (the builder net and the
real-engine net).** One line of why: A makes the statement **correct by
construction** even if a future caller passes duplicate, empty, or
**reordered** `cols` — it is the only option robust to both dedup AND positional
drift, whereas B fixes the count but stays positionally fragile and C leaves a
latent silent-write-loss footgun; all three cost is bounded and A reuses the
existing `uniq`/`filter`/`quoteIdent` primitives.

### Ruled out

- **Option B (map VALUES over the same uniq+filtered list, no column list)** —
  fixes the count mismatch and the silent write-loss with the smallest diff, but
  stays **positional**: values still bind to columns by order, so a future
  column-order drift mis-maps values silently with no count error to catch it. It
  fixes the symptom A fixes structurally, for strictly less robustness — the
  acceptable fallback if the owner wants the minimal change, not the
  correct-by-construction one.
- **Option C (keep + document the latent asymmetry)** — defensible only while the
  implicit, unenforced `mdbTablesToDBTables` uniqueness invariant holds; it
  leaves a footgun that fails by **silently dropping a table's save** the moment
  the invariant breaks, invisible at the call site. Weakest posture when A/B
  close it cheaply.
- **Also fixing `insertIntoDB` in the same change** — out of scope: `insertIntoDB`
  does not own its CREATE (done by `saveDBToPath`) and stays positional by the
  same convention; widening this decision to it conflates two verbs. If the owner
  wants the explicit-column-list treatment applied uniformly to the positional
  insert path too, that is a follow-up bead, recorded here as the natural
  extension of A.
- **A default-OFF runtime flag / minimal spike** — adds nothing here. The engine
  ground truth is **already empirically captured** against the real sql.js engine
  (`db.realengine.roundtrip.test.ts:552-614`): we know the exact failure
  (throw → swallowed → `false` → row dropped, table survives) and the exact fix
  shape. The change is pure, deterministic SQL-string construction over a
  sanitized/quoted path with **no render / `innerHTML` / eyes-on-vault surface**;
  its correctness is fully offline-provable by flipping the two existing jest
  nets to assert the corrected statement + a successful real-engine round-trip.
  The open question is **which alignment posture** (A/B/C) and the deliberate
  re-bless of two locked nets — neither a measurement a flag yields (same no-flag
  posture as ADR 0025/0030/0032/0033/0043/0044).

## Consequences

If the owner approves **A**, the implementing session:

1. computes `const liveCols = uniq(tableFields).filter((f) => f);` once in
   `replaceDB` (`db.ts:438-454`) and uses it for **both** the CREATE field
   definition and the REPLACE rows;
2. emits each row as
   `REPLACE INTO ${quoteIdent(t)} (${quotedColList}) VALUES (...)` mapping the
   VALUES over `liveCols` (not the raw `tableFields`);
3. **flips the locked builder pin** in `db.sql-builders.test.ts:363-387` — the
   expected statement becomes `REPLACE INTO "t" ("a","b") VALUES ('1', '2');`
   and the "VALUES list length follows cols.length (4)" comment is rewritten to
   describe the now-aligned, count-matched explicit-column form (with a comment
   citing this ADR + `Notidian-k778`);
4. **flips the locked real-engine pin** in
   `db.realengine.roundtrip.test.ts:552-614` — the `cols=['a','a','','b']` case
   now asserts `replaceDB` returns **`true`**, `selectDB` returns the stored row,
   and the table has columns `["a","b"]` (the throw/`false`/no-row
   characterization is **deliberately retired**, not regressed); the `CONTRAST`
   case stays green; the header comment is reworded to reflect the corrected
   behavior;
5. confirms the rest of the `replaceDB` nets (DROP/CREATE/index/BEGIN/COMMIT
   skeleton, hostile-ident quoting, single-quote doubling, empty-fieldQuery gate)
   stay green — only the VALUES alignment and the new explicit column list change;
6. (optional) files a follow-up bead to apply the explicit-column-list treatment
   to the positional `insertIntoDB` path if the owner wants it uniform;
7. closes `Notidian-k778`.

The change is pure, offline-provable SQL-string construction exercised through
both the fake-DB builder net and the real sql.js engine net, so the gate is
**jest** (`npm test`) + tsc + build green — **no default-OFF flag, no eyes-on
verification.** Until a pick, **no `db.ts`, `db.sql-builders.test.ts`, or
`db.realengine.roundtrip.test.ts` change is made** and the two locked
characterizations are **not** flipped.

This ADR applies to, and does not supersede, the authority/transaction model of
ADR 0001/0004/0006 — it hardens one whole-table-rewrite SQL builder so the
emitted REPLACE is correct by construction rather than by an implicit upstream
invariant.
