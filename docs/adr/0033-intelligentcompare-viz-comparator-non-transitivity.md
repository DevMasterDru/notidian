# ADR 0033: `intelligentCompare` (Visualization sortingUtils) — Non-Transitivity vs Observable Chart Ordering

## Status

Proposed.

Awaiting an owner decision. Tracked by bd `Notidian-0id` (discovered by the
characterization net `Notidian-dx5`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written instead of changing the comparator blind. `intelligentCompare` is
**load-bearing** (it orders chart axes and categories on the D3 render path), its
current output is **explicitly locked as characterization, not correction** in
`src/core/react/components/Visualization/utils/sortingUtils.test.ts`, and a fix
changes **owner-visible** rendered ordering — so "fix the comparator" is a
product/behavior call, not pure logic. This is the same family as ADR 0025
(`array.ts` order comparators); both are the `Notidian-e8e` non-reflexive/
non-transitive comparator bug class on different surfaces.

## Date

2026-06-15

## Context

### The defect

`src/core/react/components/Visualization/utils/sortingUtils.ts:37-65`:

```ts
export const intelligentCompare = (a: any, b: any): number => {
  const aStr = String(a);
  const bStr = String(b);
  if (isDateLike(aStr) || isDateLike(bStr)) {          // <-- branch chosen per-PAIR
    const dateA = new Date(aStr);
    const dateB = new Date(bStr);
    if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
    if (isNaN(dateA.getTime())) return 1;
    if (isNaN(dateB.getTime())) return -1;
    return dateA.getTime() - dateB.getTime();
  }
  const numA = parseFloat(aStr), numB = parseFloat(bStr);
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB; // numeric branch
  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
};
```

`Array.prototype.sort` requires its comparator to be a **strict weak ordering**:

- reflexive — `cmp(x, x) === 0`
- antisymmetric — `sign(cmp(a, b)) === -sign(cmp(b, a))`
- transitive — `cmp(a,b) <= 0 && cmp(b,c) <= 0 => cmp(a,c) <= 0`
  (and the `==0` equivalence must itself be transitive)

`intelligentCompare` is **reflexive** and **antisymmetric over most of the
domain** (verified over a mixed domain in the test net) but has **two** locked
strict-weak-ordering defects: it is **NON-TRANSITIVE** (the headline defect,
below) and **NON-REFLEXIVE on `"Infinity"`** — `parseFloat("Infinity") ===
Infinity` passes the numeric guard, so `cmp("Infinity","Infinity")` takes the
numeric branch and returns `Infinity - Infinity === NaN`, not `0`. A NaN
comparator return is itself an SWO violation and gives `Array.prototype.sort` an
**undefined contract** (strictly worse than the non-transitivity). `"-Infinity"`
and overflow literals like `"1e999"` (`parseFloat` -> `±Infinity`) share this
defect. It is pinned by a dedicated `KNOWN DEFECT` test; the reflexivity /
antisymmetry "law HOLDS" assertions iterate `LAW_DOMAIN` (`MIXED_DOMAIN` minus
`"Infinity"`) and the test's `sign` helper now THROWS on NaN instead of
laundering it to `0`. The transitivity root cause is that the
date/number/string branch is selected **per comparison pair** —
`isDateLike(aStr) || isDateLike(bStr)` — rather than by a stable per-value
classification. The same value is therefore treated as a *different type*
depending on which value it is compared against. Concrete, reproducible triple
(locked in the test as a `KNOWN DEFECT`):

```
a = "2024-01-01",  b = "",  c = "10"

cmp(a, b) = -1   // b is date-like? no; a is -> date path. new Date("") is NaN -> a (valid) before -> -1
cmp(b, c) = -1   // neither date-like -> string path. localeCompare("","10") = -1
cmp(a, c) = +1   // a is date-like -> date path. BOTH parse: new Date("10") = year 2001 < new Date("2024-01-01")=2024 -> +1

=> a < b, b < c, but a > c   (transitivity violated)
```

The bare string `"10"` is treated as the **number 10** when compared against `""`
(numeric/string branch), but as the **Date "year 2001"** when compared against a
date-like value. The test net pins that the violation count is `> 0` over the
18-value mixed domain (it is 416 today, counted NaN-tolerantly — the exact figure
is not load-bearing, only that it is nonzero); a self-consistent sub-domain
(all-dates, all-numbers, or all-strings) provably **does** obey the full triad —
confirming the breakage is the cross-branch mixing, not the per-branch logic.

### Why this matters (the harm)

`intelligentCompare` is fed **directly** to `Array.prototype.sort` to order chart
axes/categories:

- `D3VisualizationEngine.tsx:205,388` — `scaleBand().domain(sortUniqueValues(...))`
- `LineChartUtility.ts:173,600` — `.sort((a,b) => sortByEncodingType(...))` (which
  falls back to `intelligentCompare` for nominal/ordinal without option/scale order)
- `Bar/Line/Area/RadarChartTransformer` — category + series ordering via
  `sortUniqueValues` -> `intelligentCompare`.

A non-transitive comparator makes `Array.prototype.sort` produce
**V8-version-dependent, unstable, or outright-wrong** orderings: for an input that
mixes dates, bare numbers, and free text (exactly the uncontrolled nominal/ordinal
field data that flows in), the rendered axis order is an artifact of TimSort
internals, not a defined contract. A Node/V8 upgrade or a change in array size can
silently reorder a chart's categories.

### Caller-dependence (grounding the decision)

No caller depends on the **broken** (non-transitive) property — they all just want
a sensible, stable ordering of axis categories. But every caller renders **whatever
order the comparator emits**, so changing the comparator changes the **visible**
order of chart categories/axes for mixed-type data. That output change is
owner-visible in the vault and cannot be fully validated by `tsc`/`jest`/`build`
(jest can prove the *laws* hold; it cannot decide which *product* ordering is
"right" for a date/number/text mix). This is precisely the ADR-0025 situation:
offline-provable logic whose *fix* is a behavior decision.

### What is locked now

`sortingUtils.test.ts` (Notidian-dx5) characterizes and **deliberately locks** the
present behavior so a change is a conscious, reviewed decision:

- reflexivity + antisymmetry asserted **green over `LAW_DOMAIN`** (`MIXED_DOMAIN`
  minus `"Infinity"`) — they hold there; the `sign` helper THROWS on NaN so a
  regression that introduces a new NaN return cannot pass silently;
- the **`"Infinity"` NaN return** asserted as its own **`KNOWN DEFECT`** — the test
  asserts `cmp("Infinity","Infinity")` (and `"-Infinity"`, `"1e999"`) returns NaN
  (on the RAW comparator output, not via `sign`). When the fix lands this flips to
  "reflexivity holds" and `"Infinity"` folds back into `LAW_DOMAIN`;
- transitivity asserted as a **`KNOWN DEFECT`** — the test asserts a violation
  *exists* (a concrete triple + a domain-wide violation count `> 0`, counted with a
  NaN-tolerant `sortSign` since the full domain includes the NaN-returning
  `"Infinity"`). When the fix lands these flip to "the law holds / violation count
  `=== 0`";
- the self-consistent sub-domains are asserted to obey the full triad (proving the
  per-branch logic is sound);
- a malformed-comparator `sort()` is asserted only to terminate and return a
  permutation (the safety floor) — never a specific order, because none is defined
  until the comparator is fixed.

## Decision

**Recommended: Option B** — replace `intelligentCompare` with a comparator that
**classifies each value's type ONCE (per-value, not per-pair)** and only compares
values within the same type bucket, with a fixed, deterministic ordering across
buckets. Then flip the locked `KNOWN DEFECT` assertions to assert the laws hold.

One-line why: the comparator-law triad is the contract `Array.prototype.sort`
demands; per-value classification is the minimal change that makes the ordering a
real total order (removing the V8/TimSort hazard at its source), and the existing
property net already guards every per-branch behavior so the fix is regression-safe
offline — leaving only a one-time eyes-on confirm of the (now stable) category
ordering in a real chart.

### Options

#### Option A — Keep + document the quirk (zero churn)

Leave `intelligentCompare` as-is; expand the comment and the bead/ADR trail; keep
the characterization tests with the `KNOWN DEFECT` locks.

- **Pros:** zero behavior change; zero risk to the render-path callers; no
  re-verify needed.
- **Cons:** leaves a **latent sort-stability hazard** on every chart with
  mixed-type categories — a future Node/V8 upgrade or input-size change can
  silently reorder axes. Documentation annotates the hazard; it does not remove it.
  Keeps a non-comparator masquerading as one in a reused viz util.

#### Option B — Per-value classification -> real strict weak ordering (RECOMMENDED)

Classify each value **once** into a stable bucket and compare within-bucket; order
buckets deterministically. Sketch:

```ts
type Bucket = 0 | 1 | 2; // 0=date, 1=number, 2=string  (cross-bucket order is fixed)
const classify = (s: string): { bucket: Bucket; date?: number; num?: number } => {
  if (isDateLike(s)) {
    const t = new Date(s).getTime();
    if (!isNaN(t)) return { bucket: 0, date: t };   // valid date
    // date-shaped but invalid: fall through to number/string so it is stable
  }
  const n = parseFloat(s);
  if (!isNaN(n) && /* whole string is numeric, not "10abc" */ s.trim() !== "" && isFinite(n))
    return { bucket: 1, num: n };
  return { bucket: 2 };
};
```

then compare buckets first, then within-bucket by `date`/`num`/`localeCompare`.
Key change: a value's bucket no longer depends on its partner, so the relation is
transitive by construction. (Exact bucket-order and the "is the whole string
numeric" predicate are sub-choices to settle in implementation; the test net
pins the per-branch expectations the fix must preserve.)

- **Pros:** real total order; removes the TimSort hazard at the source;
  comparator becomes a reusable, correct util; the risky per-branch behavior is
  already property-locked, so regressions are caught offline.
- **Cons:** the rendered category/axis order **changes** for any chart whose
  values mix types (e.g. a date-shaped-but-invalid token, or a bare number next to
  a date) — observable in the vault, so it warrants one eyes-on confirm even though
  offline gates pass. Requires flipping the `KNOWN DEFECT` assertions.

#### Option C — Correct comparator behind a default-OFF flag (staged rollout)

Ship the Option B comparator gated by a `stableVizComparator` setting (default
`false`); keep the legacy path; live-verify, then flip.

- **Pros:** zero default-behavior change until the owner enables it; lets the owner
  A/B the new ordering in a real chart before committing.
- **Cons:** a comparator is **pure, offline-testable logic** — the flag-gate
  mechanism (per AUTONOMOUS-REVIEW-QUEUE) is for changes gates *can't* prove. The
  laws are fully jest-provable; the only un-gate-able aspect is the one-time visible
  ordering delta a single eyes-on check settles. Permanently forking the comparator
  over-engineers the rollout of a logic fix. Ruled out in favour of B's "flip +
  one eyes-on confirm" (same reasoning as ADR-0025 Option C).

### Ruled out

- **Option A** — documenting a non-comparator does not remove the latent
  V8-dependent sort-stability hazard on the chart render path. Acceptable only if
  the owner judges any visible category-order change too risky to make at all.
- **Option C** — the change is pure, offline-provable logic; a default-OFF flag is
  the mechanism for *un*-provable render-path changes. Kept on the table only if the
  owner wants to eyeball the ordering delta in-vault before it becomes the default —
  but B already gives that via review-before-merge.

### Adjacent (NOT decided here) — `Notidian-dox` robustness gaps

Three pure robustness gaps in the same file (pinned as characterization in
`sortingUtils.test.ts`, filed as `Notidian-dox`):

1. `getOptionsOrder` **throws** when `parsed.options` is a truthy non-array
   (it calls `.filter` unguarded). A safe Q1 hardening (`Array.isArray` guard ->
   `[]`) with **no** valid-data behavior change — can land independently of this
   ADR.
2. `getOptionsOrder` filters options via the truthy `opt?.value`, dropping a
   legitimate option whose value is `0` / `""` / `false`.
3. `getUniqueSortedValues` uses `String(d[field] || "")`, so a real `0` field
   value collapses to `""` (category data loss).

(2) and (3) change observable output for edge data, so they are decision-adjacent
(same posture as this ADR); (1) is a safe hardening. Tracked separately so this
ADR's scope stays "comparator transitivity."

## Consequences

- **If B (recommended):** chart category/axis order changes for mixed-type values;
  the comparator becomes a correct, reusable util; the `KNOWN DEFECT` assertions
  flip to assert the laws hold; one eyes-on vault confirm closes the loop. Gates
  must stay green; the per-branch property net is the regression guard.
- **If A:** nothing changes; the hazard and documentation debt persist; the bead
  can be closed as "known + accepted" rather than fixed.
- **If C:** a settings field + dual code path lands; the owner enables and
  live-verifies before flipping the default; the legacy path is later removed.

## The one decision the owner needs to make

**Pick A, B, or C for `intelligentCompare`** (recommended **B** — per-value
classification into a real strict weak ordering, then flip the locked `KNOWN
DEFECT` assertions). On a pick, the implementing session/loop applies it; the
per-branch property net guards the change, and a single eyes-on chart check
confirms the category-order delta. The `Notidian-dox` robustness gaps can proceed
in parallel (gap 1 immediately; gaps 2/3 with this decision's posture).
