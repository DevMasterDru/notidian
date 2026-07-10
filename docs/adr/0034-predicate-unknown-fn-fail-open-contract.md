# ADR 0034: `filterReturnForCol` fail-open contract for unknown/undefined filter `fn`

> Filename note: this ADR was scoped under bd `Notidian-37m`, which named it
> `0033-...`. Number `0033` was already taken by
> [0033-intelligentcompare-viz-comparator-non-transitivity.md](0033-intelligentcompare-viz-comparator-non-transitivity.md)
> before this was written, so it lands as **0034** (next free number). The
> decision is unchanged.

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** — the recommended **Option A** (keep the dispatcher fail-open +
document the contract, paired with a one-time validate-loud unknown-fn guard in
`cleanPredicateType`/`validatePredicate`) shipped in `8780259` under the
use-driven-realignment doctrine (`cb2d74c`); bd `Notidian-37m` CLOSED. Dispatcher
behavior is unchanged — the fail-open output is now documented as an intentional
contract rather than read as a latent defect, so the pinned characterization was
**not** flipped (there was no defect to correct, only a decision to ratify).

Originally written **instead of changing the dispatcher blind**. `filterReturnForCol`
is on the **table-view row-visibility path**; its fail-open output was
**explicitly pinned as characterization** in
`src/core/utils/contexts/predicate/filter.test.ts` (Notidian-3fs, lines 526, 532,
591), and whether a corrupt/unrecognized predicate should keep the user's rows
**visible** or **hide** them was a **product/safety decision** (what is the worse
failure mode for a single-user vault?), not pure logic. That decision has since
been made: Option A shipped as noted above, and the pinned characterization
stayed as-is (documented, not flipped).

## Date

2026-06-15

## Context

### The code

`src/core/utils/contexts/predicate/filter.ts` defines the per-row filter
dispatcher (`filter.ts:140-159`):

```ts
export const filterReturnForCol = (
  col: SpaceTableColumn,
  filter: Filter,
  row: DBRow,
  properties: Record<string, any>
) => {
  if (!col) return true;                                  // line 141 — null col -> visible

  const filterType = filterFnTypes[filter?.fn];           // line 143 — lookup by fn name
  let result = true;                                      // line 144 — DEFAULT: visible
  if (filterType && filterType.fn) {                      // line 145 — only run a KNOWN fn
    const value = (filter.fType == 'property') ? properties[filter.value] : filter.value;
    const rowValue = col.type == 'flex' ? parseFlexValue(row[filter.field])?.value : row[filter.field];
    result = filterType.fn(rowValue, value);              // line 149 — real predicate result
  }

  return result;                                          // line 152
};
```

The load-bearing line is `let result = true` (line 144). When `filter` is `null`,
or `filter.fn` is `undefined`, or `filter.fn` names an operator that is **not** a
key in `filterFnTypes`, the lookup `filterFnTypes[filter?.fn]` is `undefined`, the
`if` is skipped, and `result` returns its initial `true`. **A row stays visible
when the predicate cannot be understood.** This is the **fail-open** contract.

`filterFnTypes` (`filterFns/filterFnTypes.ts`) is the closed registry of ~25 known
operators (`is`, `include`, `dateBefore`, `isAnyInList`, …). Anything outside it is
"unknown".

### Pinned current behavior (Notidian-3fs)

`filter.test.ts` locks all three unknown-input paths as **characterization** so a
change is a deliberate, reviewed flip rather than an accident:

- `filter.test.ts:526` — `"DEFECT-PIN: an unknown filter fn passes through as
  visible (returns true)"`: `{ fn: "noSuchFn", … }` -> `true`.
- `filter.test.ts:532` — `"DEFECT-PIN: a missing/undefined fn passes through as
  visible (returns true)"`: a filter with no `fn` at all -> `true`.
- `filter.test.ts:591` — `"DEFECT-PIN: filter.fn undefined keyed against
  filterFnTypes is a passthrough, not a throw"`: `filter === null` -> `true`.

The end-of-file follow-up note (`filter.test.ts:631`) records the same fact as
defect candidate (6): *"filterReturnForCol returns true (row visible) for
unknown/undefined fns, so a corrupt predicate silently disables filtering rather
than failing."*

### How predicates reach the dispatcher — the upstream guard already exists

A persisted/loaded predicate does **not** reach `filterReturnForCol` with an
unknown `fn`, because `validatePredicate` already strips them. `predicate.tsx`
runs every saved predicate through `cleanPredicateType`:

```ts
// predicate.tsx:38 — drops any filter whose fn is not a known operator
export const cleanPredicateType = (type, definedTypes) =>
  type.filter((f) => Object.keys(definedTypes).find((g) => g == f.fn));

// predicate.tsx:57-59 — applied to filters on every validate
filters: Array.isArray(prevPredicate.filters)
  ? (cleanPredicateType(prevPredicate.filters, filterFnTypes) as Filter[])
  : [],
```

`validatePredicate` is invoked on the predicate edit/save path
(`ContextEditorContext.tsx:1153`, `:1189`). So **at write/load time, an unknown
operator is removed from the predicate entirely** — it never becomes an active
filter. The fail-open passthrough in `filterReturnForCol` is therefore the
**defensive backstop** for the residual cases that bypass `validatePredicate`: a
predicate held in memory before validation, a programmatically constructed filter,
or a filter object passed straight to the dispatcher.

### Where the dispatcher is called — call sites also fail open

Every production caller already wraps the dispatcher in a `col ? … : true`
fail-open of its own, and combines results with `every`/`some`/`reduce`:

- `linkContextRow.ts:372` (OR group) and `:378` (AND group):
  `return col ? filterReturnForCol(col, filter, row, properties) : true;`
- `ContextEditorContext.tsx:681`: folds `filterReturnForCol` over
  `predicate.filters` with `reduce(..., true)`.
- `treeHelpers.ts:214` (export tree): same dispatcher call.

So the fail-open posture is consistent end-to-end: an unrecognizable filter is a
**no-op** (does not constrain the row set), not a row-hider and not a throw.

### Why this is a decision, not a blind fix

The three plausible postures (keep visible / hide / throw-or-log) change **which
rows the owner sees** in a filtered table — or, for the throw option, can crash
the row-visibility pass on the core render path. Offline gates (tsc/jest/build)
cannot prove which is *correct*; it is a safety/UX call about the worst failure
mode for a single-user vault. The current behavior is deliberately locked as
characterization so any change is a conscious, reviewed flip. Hence: ADR +
recommendation, not a build.

## Decision

**Recommended: Option A — keep fail-open + document the contract; pair it with an
upstream validate-loud warning (Option C-lite) so unknown fns are surfaced once.**

One-line why: a corrupt or *future* predicate should never silently **hide** the
user's own rows — for a single-user vault, vanishing data with no signal is the
worse failure mode than an under-constrained (too-visible) table the user can see
and fix; validate-loud belongs **upstream** (`validatePredicate`, write/load time,
once) not at the per-row read hot path.

### Options

**Option A — Keep fail-open (row stays visible on unknown/undefined fn); document
the contract (RECOMMENDED).**
Leave `filter.ts:144` (`let result = true`) and the three pinned assertions as-is.
Add a contract comment on `filterReturnForCol` stating the fail-open intent and
pointing at this ADR. Optionally pair with the **validate-loud upstream warning**
below so unknown fns are not *silently* dropped.

- **Pros:**
  - **Forward-compatible.** A newer schema/predicate version can emit an operator
    this build does not yet know. Fail-open degrades that filter to a no-op (the
    table shows *more* rows than intended) instead of hiding rows the user owns.
    Hiding data on an unrecognized operator is the worse outcome for a single-user
    vault — the user cannot tell "filtered out" from "lost".
  - **Defense-in-depth, not the primary guard.** `validatePredicate` already
    *removes* unknown fns at write/load (`cleanPredicateType`, `predicate.tsx:38`),
    so in normal operation an unknown fn never reaches the dispatcher. Fail-open is
    the backstop for the un-validated edge (in-memory pre-validate predicates,
    programmatic filters); it should be lenient, since validation is the loud layer.
  - **Consistent end-to-end.** Every call site already fails open
    (`linkContextRow.ts:372/:378`, `ContextEditorContext.tsx:681`,
    `treeHelpers.ts:214` all use `col ? … : true` / `reduce(…, true)`). Keeping the
    dispatcher fail-open matches the surrounding contract; flipping only the
    dispatcher would create an inconsistent two-layer posture.
  - **Hot-path safe.** No work added to the per-row pass; no exception risk on the
    render path.
- **Cons:**
  - A genuinely corrupt predicate that *bypasses* validation silently stops
    constraining rows — the user may not notice the filter is doing nothing. The
    paired validate-loud warning (below) mitigates this by surfacing the dropped fn
    **once**, at the layer that already drops it.

**Validate-loud pairing (recommended companion to A, "C-lite").** In
`cleanPredicateType` / `validatePredicate`, when a filter is dropped for an unknown
`fn`, emit a **single** dev-console warning (or `superstate.ui.notify`) naming the
operator. This surfaces the unrecognized operator **once at validation time**, not
silently and not per-row. It does not change visibility and does not touch the
hot path. (Small, offline-provable; can ship with the owner's "approve A" and is
the only code this ADR would add.)

**Option B — Fail-closed (hide the row when `fn` is unknown/undefined).**
Change `filter.ts:144` to `let result = false` (or return `false` for the
unknown-fn branch) so an unrecognizable filter **excludes** the row.

- **Pros:** a corrupt filter cannot silently let *unwanted* rows through; "if I
  can't evaluate this constraint, treat it as unsatisfied" is the conservative
  reading for a constraint whose job is to *narrow*.
- **Cons (ruled out):** **data the user owns vanishes with no signal.** An unknown
  fn from a newer schema version, or a single corrupt predicate, would hide rows —
  and in a single-user vault the user cannot distinguish "correctly filtered out"
  from "my notes disappeared". For a personal database, silently hiding the
  owner's own data is the strictly worse failure mode than showing too much.
  Inconsistent with the fail-open `col ? … : true` posture every call site already
  has. **Ruled out.**

**Option C — Throw / log loud at the dispatcher (per-row).**
Make `filterReturnForCol` throw or `console.warn` when `fn` is unknown.

- **Pros:** an unknown operator is impossible to miss.
- **Cons (ruled out for the per-row pass):** the dispatcher runs **once per row
  per filter** on the core render path (`linkContextRow.ts`,
  `ContextEditorContext.tsx:667-689` reduces over every filter for every row). A
  **throw** there would crash row-visibility / render for the whole table on a
  single bad predicate — a far worse UX than a no-op filter. A **per-row log**
  would spam the console once per row (thousands of identical warnings) and still
  costs work in the hot path. **Ruled out for the per-row pass** — but its valid
  intent (surface the unknown fn) is preserved by moving the warning **upstream**
  to `validatePredicate`, which sees each unknown fn **once** (the C-lite pairing
  recommended with A).

## Relationship to ADR 0032 (date-filter Invalid-Date) — same family, resolves oppositely

This is the **same family of question** as ADR 0032's axis (b)
([0032-date-filter-boundary-and-invalid-date-semantics.md](0032-date-filter-boundary-and-invalid-date-semantics.md)):
*what should a malformed predicate input do?* ADR 0032 recommends **fail-closed**
for a malformed **date value** (B1: an unparseable date is invisible to every date
filter — a malformed date must not silently *satisfy* a date filter). This ADR
recommends **fail-open** for an unknown **operator**. They defensibly resolve
**oppositely**, and the difference is principled:

- **ADR 0032 is value-level.** A malformed *value* inside a *known, intended*
  filter: the user explicitly asked "show rows before date X". A garbage value that
  silently *passed* that filter would let corrupt data masquerade as matching — so
  fail-closed (don't satisfy the constraint) is correct: the filter's intent is
  honored, the bad value just doesn't match.
- **ADR 0034 (this) is operator-level.** An unknown *operator* means the *entire
  constraint is uninterpretable* — there is no "intent to honor", because the
  system cannot tell what was asked. Hiding rows would impose a constraint nobody
  can read; fail-open degrades the unreadable constraint to a no-op and keeps the
  user's data visible (and fixable). Forward-compat with newer-schema operators
  reinforces this: an operator this build doesn't know yet is a *capability gap*,
  not corrupt user intent.

In short: **a malformed value should not satisfy a real constraint (fail-closed);
an unreadable constraint should not delete data (fail-open).** ADR 0032 already
flagged Notidian-37m as adjacent and explicitly noted "the two have different
defensible answers … so they need not resolve the same way" and that it is "filed
separately (P3) and is **not** decided by this ADR" (ADR 0032, lines 308-321).
The owner **may** prefer to settle the whole predicate-contract posture in one
pass; this ADR keeps the two decisions separable.

## Consequences

- **If the recommendation (A + validate-loud pairing):** the fail-open dispatcher
  contract is **documented** (a comment on `filterReturnForCol` + this ADR) so it
  reads as intended, not as the latent "DEFECT-PIN" the test currently labels it.
  The three pinned characterization assertions (`filter.test.ts:526, :532, :591`)
  **stay green unchanged** (the contract is reaffirmed, not flipped). The only code
  added is the upstream one-time warning in `cleanPredicateType`/`validatePredicate`
  — pure, offline-provable, no visibility change, no hot-path cost. The test
  pin's defect-candidate (6) note is reframed from "defect" to "documented
  fail-open contract". No vault-observable row-set change; **no eyes-on check
  needed** (visibility is unchanged).
- **If B (fail-closed):** rows with an unknown/corrupt operator that bypassed
  validation become **hidden** — a vault-observable change requiring an eyes-on
  confirm, and the three pinned assertions are **deliberately flipped** to assert
  `false`. Carries the silent-data-loss hazard above.
- **If C (throw/log per-row):** introduces render-crash risk (throw) or console
  spam (log) on the hot path; not recommended for the per-row pass.

This is a **logic / contract** change (no render-path `innerHTML` / authority
surface), so **no default-OFF flag is proposed** — per the AUTONOMOUS-REVIEW-QUEUE
convention, the flag mechanism is for changes gates *cannot* prove offline. The
recommended A + validate-loud companion is fully jest-provable and changes no
visible row set, so it needs the owner's **decision** (ratify the contract) rather
than a flag + live-verify. No code or test was changed by this ADR; `filter.ts`
and the pinned `filter.test.ts` assertions are untouched until the owner picks a
direction.

## The one decision the owner needs to make

**Should `filterReturnForCol` keep returning `true` (row stays visible) when
`filter.fn` is unknown/undefined or `filter` is null?**

- **A** (keep fail-open + document the contract; pair with an upstream
  validate-loud warning — **RECOMMENDED**) /
- **B** (fail-closed — hide rows on unknown fn) /
- **C** (throw/log loud at the per-row dispatcher).

On a pick of **A**, the implementing session adds the contract comment on
`filterReturnForCol` and the one-time upstream warning in
`cleanPredicateType`/`validatePredicate`; the three pinned characterization
assertions stay green. On a pick of **B**, the session flips `filter.ts:144` and
the three pinned assertions, then one eyes-on vault check confirms the visible
row-set delta. Optionally fold this in with **Notidian-qbr / ADR 0032** for a
single predicate-contract decision (noting they defensibly resolve oppositely:
value-level fail-closed vs operator-level fail-open).
