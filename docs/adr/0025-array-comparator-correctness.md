# ADR 0025: array.ts Order Comparators — Correctness vs Caller-Dependence (and uniqCaseInsensitive Casing)

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** — the recommended Option B (stable, reflexive, non-mutating
comparators) plus the folded-in `uniqCaseInsensitive` first-seen-casing fix
shipped in `0e04749` under the use-driven-realignment doctrine (`cb2d74c`); bd
`Notidian-e8e` (folds in `Notidian-9v6`) CLOSED.

(Historical framing below retained as the record.) This ADR was written instead
of changing the comparators blind. The two comparators are **load-bearing**
(column ordering and space/row ordering on the core cache path); their output
**was locked as characterization, not correction** in
`src/shared/utils/array.test.ts:29`, and the live callers may have depended on
the present quirks — so "fix the comparator" was a product/behavior call, not
pure logic. Those locked assertions were flipped in the same commit that
implemented Option B.

## Date

2026-06-15

## Context

### The defect

`src/shared/utils/array.ts:49-90` defines two sibling comparators:

```ts
export const orderStringArrayByArray = (array: string[], order: string[]) =>
  array.sort(function (a, b) {
    const A = order.indexOf(a), B = order.indexOf(b);
    if (A > B) {
      if (A != -1 && B == -1) return -1;   // a absent, b present -> a after... wait, returns -1
      return 1;
    } else {
      if (B != -1 && A == -1) return 1;    // b present, a absent -> a after b
      return -1;                            // <-- ELSE FALLS HERE EVEN WHEN A === B
    }
  });

export const orderArrayByArrayWithKey = (array, order, key) => /* identical on a[key] */;
```

Three properties a correct comparator must have are violated:

1. **Non-reflexive.** When `a === b`, `A === B`, so `A > B` is false; the `else`
   branch returns `-1`. A comparator must return `0` for equal elements —
   `cmp(x, x) === -1` here.
2. **Non-transitive / not a total order.** Two items *both absent* from `order`
   (`A === B === -1`) also take the `else -1` branch, so the comparator claims
   "a before b" regardless of which is which. This is not a consistent ordering;
   the observed result is an artifact of V8's TimSort merge/insertion-sort
   thresholds, **not** a defined contract. It is stable in practice today only
   because of those engine specifics.
3. **In-place mutation.** `array.sort(...)` sorts and returns *the caller's own
   array*. Both comparators mutate the argument and return the same reference.
   `cacheParsers.ts` and `superstate.ts` pass arrays they may reuse.

### Observable, currently-locked behavior

`array.test.ts` (Notidian-u3u) characterizes — and **deliberately locks** — the
present output so any change is a conscious, reviewed decision (`array.test.ts:29`,
"IMPORTANT — characterization, not correction"):

- Items present in `order` come first, in order-sequence (the one invariant
  callers actually want — property-tested at `array.test.ts:388`).
- Items **absent** from `order` emerge in **REVERSED input order**
  (`array.test.ts:358`).
- The sort runs **in place** and returns the same reference
  (`array.test.ts:352`, `:468`).
- Duplicates in the input are **not** deduped (`array.test.ts:378`).

### What the live callers actually do (grounding the options)

There are exactly two callers (plus the test):

**Caller 1 — `cacheParsers.ts:85-88` (column/row-path ordering).** Verified
empirically (Node repro):

```ts
const contextPaths = materializedContextTable?.rows?.map(f => f[PathPropertyName]) ?? [];
const missingPaths = paths.filter(f => !contextPaths.includes(f));
const newPaths = [...orderStringArrayByArray(paths ?? [], contextPaths), ...missingPaths];
```

`orderStringArrayByArray(paths, contextPaths)` already tail-appends the
absent-from-`contextPaths` items (reversed). Then `missingPaths` — which is
*exactly that same absent set* — is appended **again** (in input order). So:

```
paths        = [row1, row2, newA, newB]
contextPaths = [row2, row1]
order output = [row2, row1, newB, newA]   // present-ordered + absent-reversed
missingPaths = [newA, newB]
newPaths     = [row2, row1, newB, newA, newA, newB]   // newA, newB DUPLICATED
```

`newPaths` feeds `paths: newPaths` into the cached space state
(`cacheParsers.ts:126`). The reversed-absent tail of the comparator is therefore
**redundant garbage** the caller never wanted — the caller's own `missingPaths`
append is the intended way to place new paths. The quirk doesn't help this
caller; it actively duplicates entries. (Whether the duplication is benign
downstream — i.e. de-duped elsewhere — is a render-path question gates can't
fully answer, but the comparator is plainly not relied on for the absent tail
here.)

**Caller 2 — `superstate.ts:814-822` (space ordering for `allSpaces(true)`).**

```ts
return orderArrayByArrayWithKey([...this.spacesIndex.values()], this.spaceOrder(), 'path');
```

`spaceOrder()` is `this.focuses.flatMap(f => f.paths)` — the user's pinned/focus
ordering. Spaces **not** in any focus are absent and currently surface in
reversed-`spacesIndex`-insertion order. There is no product reason for spaces to
appear *reversed*; "stable, in index order" is at least as defensible and is the
less surprising default. The input is already a fresh `[...spread]`, so in-place
mutation of it is harmless here (it mutates the throwaway copy).

**Net:** neither caller has a demonstrated dependence on *reversed* absent
ordering; one caller is actively harmed by the comparator's absent tail
(duplication). The single contract both rely on — "present items first, in
order-sequence" — is preserved by every option below and is property-tested.

### The folded-in sub-decision — `uniqCaseInsensitive` casing (Notidian-9v6)

Same file, `array.ts:20-22`:

```ts
export const uniqCaseInsensitive = (a: string[]) =>
  [...new Map(a.map((s) => [s.toLowerCase(), s])).values()];
```

`new Map(pairs)` preserves the **first-insertion position** of a key but
**overwrites the value** on a duplicate key — so a casing collision keeps the
**LAST-seen** casing (`['a','A'] -> ['A']`). The Notidian-u3u bead description and
the apparent intent at `PropertiesView.tsx:83` (frontmatter-key dedup) expected
**FIRST-seen** casing. Locked as characterization at `array.test.ts:232`.

Callers: `PropertiesView.tsx:83` and `RemoteMarkdownHeaderView.tsx:29` — both
build a **display** list of property-key column names from frontmatter keys. The
effect is purely which casing is shown for a property name that appears in mixed
case. Low-risk, display-only, no persistence of the chosen casing as authority.

## Decision

**Recommended: Option B** — replace both comparators with a stable, reflexive,
non-mutating comparator; update the two callers to expect stability; flip the
locked characterization assertions to assert the corrected behavior. **Fold in
the `uniqCaseInsensitive` first-seen-casing fix** as a same-file, low-risk
sub-change.

One-line why: the property net in `array.test.ts` already guards the only
invariant callers actually depend on ("present items first, in order-sequence"),
the reversed-absent quirk is depended on by *neither* caller (and *duplicated
into garbage* by one), and a stable total order is the safer invariant that
removes the latent TimSort-specific sort-stability hazard at its source.

### Options

#### Option A — Keep + document the quirk (zero churn)

Leave both comparators and `uniqCaseInsensitive` as-is; expand the comment block
and the bead/ADR trail; keep the characterization tests.

- **Pros:** zero behavior change, zero risk to the two render-path callers, no
  re-verify needed.
- **Cons:** leaves a **latent sort-stability hazard** — the absent-item ordering
  is an undefined-contract artifact of V8 TimSort; a future Node/V8 upgrade or a
  refactor that changes input sizes could silently reorder columns/spaces.
  Leaves the `cacheParsers` duplication in place. Keeps a non-comparator masquer-
  ading as one in a shared util that *will* be reused. Documentation does not
  remove the hazard, only annotates it.

#### Option B — Replace with a stable, reflexive, non-mutating comparator (RECOMMENDED)

Rewrite both as:

```ts
export const orderStringArrayByArray = (array: string[], order: string[]) =>
  [...array].sort((a, b) => {
    const A = order.indexOf(a), B = order.indexOf(b);
    if (A === -1 && B === -1) return 0;   // both absent -> stable (preserve input order)
    if (A === -1) return 1;               // a absent -> after present b
    if (B === -1) return -1;              // b absent -> before
    return A - B;                          // both present -> by order-index (0 if equal)
  });
```

(`orderArrayByArrayWithKey` identical on `a[key]`/`b[key]`.) `Array.prototype.sort`
is guaranteed stable (ECMAScript 2019+, every supported runtime), so returning `0`
for both-absent / equal items preserves their **relative input order**. Spreading
the input first makes the function **non-mutating**. Then:

- Update `array.test.ts` characterization assertions: absent items keep **input**
  order (not reversed); functions return a **new** array (not the same reference);
  property tests already cover the present-first invariant unchanged.
- Update callers for the (now removed) in-place behavior: `cacheParsers.ts` does
  not need the same reference; `superstate.ts` already passes a throwaway copy.
  Optionally simplify `cacheParsers.ts:88` to drop the now-redundant absent tail
  duplication (the comparator no longer reverse-appends garbage; `missingPaths`
  stays the single source of new-path placement) — flagged as a follow-up so the
  ADR's scope stays "comparator correctness," not a cache-path refactor.

- **Pros:** real total order; removes the TimSort-specific hazard; non-mutating
  (no spooky-action-at-a-distance for future callers); makes the `cacheParsers`
  duplication legible/fixable. The risky part (the present-first contract) is
  already property-locked, so regressions are caught offline.
- **Cons:** absent-item display order **changes** (reversed -> input order) for
  any column/space not in the order list — observable in the vault, so it warrants
  one eyes-on confirm even though offline gates pass. Requires editing two callers
  + flipping ~5 locked assertions. This is the only option that changes what the
  owner sees, which is exactly why it is queued for review rather than
  auto-merged.

#### Option C — Correct comparator behind a default-OFF flag (staged rollout)

Ship the Option B comparator gated by a `stableOrderComparators` setting
(default `false`); keep the legacy path as the default; live-verify, then flip.

- **Pros:** zero default-behavior change until the owner enables it; lets the
  owner A/B the absent-ordering change in their real vault before committing.
- **Cons:** a comparator is **pure, offline-testable logic** — the whole point of
  the flag-gate mechanism (per AUTONOMOUS-REVIEW-QUEUE) is for changes that
  *cannot* be proven offline. A stable sort can be fully proven by the existing
  jest property net; gating it adds two code paths, a settings field, and a
  permanent fork in a 4-line util for a change whose only un-gate-able aspect is a
  cosmetic display-order delta a single eyes-on check settles. Over-engineering
  the rollout of a logic fix. Ruled out in favour of B's "flip + one eyes-on
  confirm."

### Ruled out

- **Option A** — documenting a non-comparator does not remove the latent
  V8-dependent sort-stability hazard, and leaves the `cacheParsers` absent-path
  duplication in place. Acceptable only if the owner judges any visible
  absent-order change too risky to make at all; the recommendation is that the
  hazard outweighs the churn, since the churn is guarded by existing property
  tests.
- **Option C** — the change is pure, offline-provable logic; a default-OFF flag is
  the mechanism for *un*-provable render-path changes (frame execution, MKit
  removal). Using it here permanently forks a 4-line util to defer a one-time
  cosmetic confirm. Kept on the table only if the owner wants to eyeball the
  absent-order delta in-vault *before* it becomes the default — but B already
  gives that via review-before-merge.

### Folded-in sub-decision: `uniqCaseInsensitive` casing (Notidian-9v6)

**Recommended:** switch to **first-seen** casing, e.g.

```ts
export const uniqCaseInsensitive = (a: string[]) => {
  const seen = new Set<string>();
  return a.filter((s) => {
    const k = s.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
};
```

One-line why: it is **display-only** (property-key column labels in
`PropertiesView`/`RemoteMarkdownHeaderView`), matches the stated intent in the
Notidian-u3u bead, and mirrors `uniq`'s first-seen semantics for consistency.
Flip the `array.test.ts:232` "LAST-seen casing" characterization assertions to
first-seen. This rides along with Option B (same file, same review). If the owner
prefers Option A (no change), this sub-fix can still land independently since it
carries effectively no caller risk — but the recommendation is to do both
together.

## Consequences

- **If B (recommended):** absent columns/spaces render in input order instead of
  reversed; the comparators become reusable, correct, non-mutating utilities; the
  `cacheParsers` duplication becomes a clean follow-up; one eyes-on vault confirm
  closes the loop. Tests, tsc, build must stay green; the present-first property
  net is the regression guard.
- **If A:** nothing changes; the hazard and the documentation debt persist; the
  bead can be closed as "known + accepted" rather than fixed.
- **If C:** a settings field + dual code path lands; the owner enables and
  live-verifies before flipping the default; the legacy path is later removed.
- The `uniqCaseInsensitive` sub-fix changes only displayed property-key casing for
  mixed-case duplicates (first-seen instead of last-seen).

## The one decision the owner needs to make

**Pick A, B, or C for the two comparators** (recommended **B** — replace with a
stable, reflexive, non-mutating comparator and flip the locked assertions),
**and** confirm the folded-in `uniqCaseInsensitive` switch to **first-seen**
casing (recommended **yes**, rides with B). On a pick, the implementing
session/loop applies it; the present-first property net guards the change, and a
single eyes-on vault check confirms the cosmetic absent-order delta.
