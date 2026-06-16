# ADR 0035: `inferEncodingType` value-path — numeric data infers as `temporal`, shadowing `quantitative`

## Status

Accepted.

Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c). The
recommended Option C/A hybrid is implemented in
`src/core/react/components/Visualization/utils/inferEncodingType.ts` and the
locked numeric `temporal` assertions were flipped to `quantitative` in the same
commit. The rest of this ADR is kept verbatim as the decision record.

Originally proposed (now decided); tracked by bd `Notidian-sp5` (discovered by the
characterization net `Notidian-5hs`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of changing the heuristic blind**. `inferEncodingType` is on
the **chart-encoding type path** — it decides whether a field is `quantitative`
/ `temporal` / `nominal`, which sets the D3 scale type, axis behavior, and
aggregation defaults — and a change flips **owner-visible** axis typing, so it is
a heuristic-**quality** product call, not a crash. The current `temporal`
behavior for numeric data is **explicitly locked as characterization** in
`inferEncodingType.test.ts` (the `ADVERSARIAL` block). This is the same posture
and bug family as ADR 0033 (`intelligentCompare` per-pair date/number
classification) and the date-vs-number heuristic axis of ADR 0032 — a date
heuristic that swallows numbers.

## Date

2026-06-15

## Context

### The behavior

`src/core/react/components/Visualization/utils/inferEncodingType.ts:38-62` — the
no-property-metadata **value-based** path:

```ts
// If no property metadata, try to infer from values
if (values && values.length > 0) {
  const nonNullValues = values.filter(v => v != null && v !== '');
  if (nonNullValues.length === 0) return 'nominal';

  // Check if values are dates  <-- runs FIRST
  const areDates = nonNullValues.every(v => {
    if (v instanceof Date) return true;
    const date = new Date(String(v));
    return !isNaN(date.getTime());
  });
  if (areDates) return 'temporal';

  // Check if values are numbers  <-- only reached if areDates was false
  const areNumbers = nonNullValues.every(v => {
    if (typeof v === 'number') return true;
    const num = Number(v);
    return !isNaN(num) && isFinite(num);
  });
  if (areNumbers) return 'quantitative';
}

return 'nominal';
```

The `areDates` check runs **before** `areNumbers`, and `new Date(String(n))`
returns a **valid** Date for bare numeric strings **and** for stringified real
JS numbers. Empirically (verified 2026-06-15, Node):

| input | `new Date(String(v))` | valid? |
| --- | --- | --- |
| `"2024"` | `2024-01-01T00:00:00Z` | **valid** |
| `String(1)` | `2000-12-31...` (parsed as a date) | **valid** |
| `String(2.5)` | `2001-02-04...` | **valid** |
| `String(-3)` | `2001-02-28...` | **valid** |
| `"2024-01-01"` | `2024-01-01T00:00:00Z` | valid (genuine date) |
| `"true"` | Invalid Date | invalid |

So an array of genuine numbers `[1, 2.5, -3]` or numeric strings `["2024",
"2025"]` passes `areDates.every(...)` and returns **`temporal`**, shadowing the
`quantitative` branch that can never be reached for them. The **only** value-path
that actually reaches `quantitative` is values that are numeric **but not**
date-parseable — in practice **booleans** (`Number(true) === 1`, but
`new Date("true")` is Invalid Date → `areDates` false → `areNumbers` true →
`quantitative`). That narrow surviving case is pinned in the test net.

### Blast radius — limited to metadata-less inference

Explicit property metadata of type `'number'` **still works** correctly:
`inferEncodingType` returns `quantitative` directly from the property switch
(`inferEncodingType.ts:14-15`) **before** ever reaching the value path, and the
test net pins that property metadata always wins over values. So the hazard bites
**only** when:

1. a chart encoding has **no explicit `type`** (so `ensureCorrectEncodingType`
   calls into inference), **and**
2. the field has **no `SpaceProperty` metadata** of type `number`/`date` (or has
   an unrecognized property type that falls through to the value path), **and**
3. the field's values are genuine numbers / numeric strings.

In that case a numeric axis is typed `temporal` and rendered on a time scale
instead of a continuous quantitative scale.

### Where it reaches the render path (grounds the harm)

`inferEncodingType` is wrapped by `ensureCorrectEncodingType`, which is called
across the whole D3 visualization layer to fill an unset encoding `type`:

- `D3VisualizationEngine.tsx:180,329`
- `DataTransformationPipeline.ts:47,66,78,89` (x, y, color, size encodings)
- `ScatterPlotTransformer.ts:34,40`, `LineChartTransformer.ts:31`,
  `AreaChartTransformer.ts:104`, `BarChartTransformer.ts:127`,
  `AreaChartUtility.ts:58,522,797`

`ensureCorrectEncodingType` re-infers only when `encoding.type` is unset, **or**
when a `number`/`date`/`date-multi` **property** is mistyped `nominal`/`ordinal`
(`inferEncodingType.ts:88-92`). So the value-path mis-typing surfaces for a
type-less encoding on a property-less numeric field — e.g. a quantity column
materialized without `SpaceProperty` metadata, charted without an explicit
encoding type. Such a field renders on a temporal axis (dates from
`new Date(String(n))`) instead of a numeric axis. This is observable in a real
chart and **cannot** be proven correct by `tsc`/`jest`/`build` (jest can prove
*which* branch fires; it cannot decide *which axis type is the right product
choice* for ambiguous numeric data) — hence ADR + recommendation, not a build.

### What is locked now (Notidian-5hs)

`inferEncodingType.test.ts` characterizes and **deliberately locks** the present
`temporal` behavior so a change is a conscious, reviewed flip rather than an
accident. The load-bearing locked assertions:

- `inferEncodingType.test.ts:122-126` — `["2024", "2025"]` → **`temporal`** (bare
  numeric strings).
- `inferEncodingType.test.ts:128-134` — `[1, 2.5, -3]` → **`temporal`** (real JS
  numbers).
- `inferEncodingType.test.ts:136-138` — `[1, null, 3, ""]` → **`temporal`** (gaps
  filtered, remainder date-parseable).
- `inferEncodingType.test.ts:79-85` — unknown property type + `[1,2,3]` →
  **`temporal`** (fall-through reaches the value path and the hazard applies
  there too).
- `inferEncodingType.test.ts:140-145` — `[true, false]` → **`quantitative`** (the
  only surviving value-path to quantitative).
- `inferEncodingType.test.ts:107-111` — `["2024-01-01", "2024-02-01"]` →
  `temporal` (genuine ISO date strings — this must **stay** `temporal` under any
  option below).

**Any chosen change must update these LOCKED `temporal` assertions in
`inferEncodingType.test.ts` in the SAME implementing commit** (the test net is
the regression guard; an out-of-sync flip would fail the suite). The genuine
date-string and Date-object assertions (lines 101-111) must remain `temporal`
under every option.

## Decision

**Recommended: Option C/A hybrid** — in the value-based path, treat a value as a
**date candidate only when `Number(String(v))` is `NaN`** (or `v` is a `Date`
instance), so numeric tokens prefer `quantitative` while ISO/date-string and
`Date` detection are preserved. Then flip the locked numeric `temporal`
assertions to `quantitative`.

One-line why: a column of plain numbers is **quantitative** to any reasonable
user — `new Date(String(n))` accepting numbers is a JS-coercion accident, not a
signal of temporal intent; gating date-candidacy on `Number(String(v))` being
`NaN` is the minimal, precise discriminator that fixes numbers/numeric-strings
without losing genuine date detection, and the property-metadata path (the
primary, correct path) is unaffected.

This is the same fix shape recommended in the bead's `DESIGN` field, and it is
empirically clean: `Number(String(v))` is `NaN` for `"2024-01-01"`, `"true"`,
and `"apple"` (so dates/booleans/words still reach the date or number checks as
appropriate) but **finite** for `1`, `2.5`, `-3`, `"2024"` (so they short-circuit
out of date-candidacy and fall to `quantitative`). Verified 2026-06-15.

### Options

#### Option A — Reorder / tighten the date heuristic (require a real date token)

Either run `areNumbers` **before** `areDates`, or require an explicit
date-pattern (e.g. a non-numeric date token / ISO-shaped regex / presence of `-`
or `:` separators) before declaring `temporal`.

- **Pros:** numeric data infers `quantitative`; conceptually "a date must look
  like a date." Reorder-first is a one-line move.
- **Cons:** a **bare reorder** is too blunt — `["2024", "2025"]` are *also*
  numeric, so `areNumbers`-first would type a column the user may genuinely mean
  as **years** (a temporal axis) as `quantitative`. Years-as-numbers is an
  inherent ambiguity no value-only heuristic resolves perfectly; reorder picks
  the *other* horn. A **regex/date-pattern** tightening is more correct but is a
  larger, bespoke surface (which patterns count? `2024/01`? `Jan 2024`?
  `1700000000` epoch?) — more to get wrong and to test than the recommended
  single-predicate guard. Kept as the fallback/companion shape: the recommended
  C-guard *is* a minimal form of "tighten the date heuristic."

#### Option B — Leave as-is; rely on property metadata (zero churn)

Keep the value path untouched; document that numeric **value-only** inference is
`temporal` by design and that callers should supply `SpaceProperty` metadata of
type `number` to get `quantitative`.

- **Pros:** zero behavior change; zero render-path risk; the primary
  (metadata-driven) path is already correct, so any field with proper metadata is
  unaffected. Honest about the years-as-numbers ambiguity by declining to guess.
- **Cons:** leaves a genuinely **surprising** default — a column of plain numbers
  with no metadata charts on a **time axis**, which essentially no user expects
  for `[1, 2.5, -3]`. It pushes correctness onto the caller always supplying
  metadata, when the value path exists precisely as the fallback for when they
  don't. Documents a foot-gun rather than removing it. Acceptable only if the
  owner judges the metadata path always present in practice and the value-only
  delta not worth any change.

#### Option C — Date-candidate only when `Number(String(v))` is `NaN` (RECOMMENDED, hybrid with A)

In the `areDates` predicate, treat a value as a date candidate **only** when it
is **not** a finite number (or it is a `Date` instance). Sketch:

```ts
const areDates = nonNullValues.every(v => {
  if (v instanceof Date) return true;
  // numeric tokens are NOT date candidates: prefer 'quantitative'
  if (!Number.isNaN(Number(String(v)))) return false;
  const date = new Date(String(v));
  return !isNaN(date.getTime());
});
if (areDates) return 'temporal';
// areNumbers unchanged; now reachable for numeric data
```

- **Pros:** the **minimal, precise** discriminator. Numbers/numeric-strings
  (`Number(String(v))` finite) short-circuit out of date-candidacy → fall to
  `areNumbers` → `quantitative`; genuine date strings (`"2024-01-01"` →
  `Number(...)` is `NaN`) and `Date` instances still reach and pass the date
  check → `temporal` preserved. One predicate change, no new regex surface, no
  branch reorder. The property-metadata path is untouched. Self-consistent with
  the `areNumbers` predicate already in the file (same `Number(...)` coercion).
- **Cons:** **bare numeric "year" columns** (`["2024", "2025"]`,
  `[2020, 2021, 2022]`) now infer `quantitative`, not `temporal` — the
  years-as-numbers horn. For a value-only path with no metadata this is the
  defensible default (a user who means years can set a `date` property or an
  explicit encoding type), and it matches the `quantitative` answer for all other
  numbers, but it **is** an observable axis-type change for year-like columns —
  warranting one eyes-on chart confirm. Requires flipping the locked numeric
  `temporal` assertions to `quantitative`.

### Ruled out

- **Option B (leave as-is)** — keeps a counter-intuitive default (`[1, 2.5, -3]`
  on a time axis) and only documents the foot-gun. Kept on the table solely if
  the owner deems the metadata path universal and any value-only change too risky
  to make.
- **Bare reorder (`areNumbers` before `areDates`)** under Option A — equally
  mis-handles the years-as-numbers case but in the opposite direction, and would
  also need a guard to avoid typing `"2024"` as quantitative-only without
  considering intent. The recommended C-guard achieves "numbers prefer
  quantitative" without disturbing the existing branch order or genuine-date
  detection, so it is preferred over a raw reorder.
- **A heavyweight date-pattern regex** under Option A — more correct in theory
  but a larger bespoke surface (which date shapes count?) than a single-predicate
  guard, with more to test and maintain. The C-guard is the smallest change that
  resolves the headline cases; a richer date-pattern can be a later refinement if
  real vault data shows it is needed.

## The years-as-numbers ambiguity (named, not hidden)

No value-only heuristic can perfectly separate `[2020, 2021, 2022]` meant as
**years** (temporal) from the same values meant as **counts** (quantitative) —
the values are identical; only the user's intent differs. Every option picks a
horn for the metadata-less case:

- **C (recommended):** year-like numbers → **quantitative** (numbers are numbers
  unless they carry date structure). The user expresses temporal intent via a
  `date` property or an explicit encoding type.
- **B:** year-like numbers → **temporal** (status quo), but at the cost of *all*
  numbers being temporal.
- **A (regex):** could special-case 4-digit year ranges → temporal, at the cost
  of complexity and new edge cases (is `1700` a year or a count?).

The recommendation accepts that **property metadata / explicit encoding type is
the correct place to express "these numbers are dates,"** and that the value-only
fallback should treat ambiguous numbers as quantitative (the common case) rather
than temporal (the surprising case for non-year numbers).

## Consequences

- **If C (recommended):** numeric / numeric-string value-only inference flips
  from `temporal` to `quantitative`; genuine date strings and `Date` objects stay
  `temporal`; the property-metadata path is unchanged. The locked numeric
  `temporal` assertions in `inferEncodingType.test.ts` (lines 122-126, 128-134,
  136-138, 79-85) are **deliberately flipped** to `quantitative` **in the same
  commit**; the genuine-date assertions (101-111) stay green; the boolean
  quantitative pin (140-145) stays green. One eyes-on chart confirm settles the
  axis-type delta for any year-like numeric column. Gates (tsc/jest/build) must
  stay green.
- **If B:** nothing changes; the surprising numeric-temporal default and its
  documentation debt persist; the bead can be closed as "known + accepted" with a
  contract comment on the value path rather than fixed.
- **If A (regex/reorder):** numeric data infers `quantitative` (regex) — same
  observable delta as C plus whatever the date-pattern admits/rejects; the same
  locked assertions flip; a larger test surface for the chosen date pattern.

This is **pure, offline-provable heuristic logic** (no render-path `innerHTML` /
authority surface), so **no default-OFF flag is proposed** — per the
AUTONOMOUS-REVIEW-QUEUE convention, the flag mechanism is for changes gates
*cannot* prove offline. The branch choice is fully jest-provable; the only
un-gate-able aspect is the one-time visible axis-type delta for year-like numeric
columns, which the existing characterization net plus a single eyes-on chart
check settle. `inferEncodingType.ts` and the pinned `inferEncodingType.test.ts`
assertions are **untouched** until the owner picks a direction.

## Relationship to ADR 0033 and 0032 (same family)

- **ADR 0033** (`intelligentCompare` non-transitivity) is the same root hazard on
  the comparator surface: `new Date(<numeric token>)` succeeding makes a number
  look date-like. There it corrupts a strict weak ordering (per-pair
  classification); here it corrupts encoding-type inference (date-before-number
  ordering). Both are "a date heuristic that swallows numbers" on the
  Visualization subtree, and both resolve by making numbers prefer their numeric
  identity.
- **ADR 0032** (date-filter semantics) is the date-vs-number axis on the predicate
  surface. The three are independent decisions (different files, different output
  surfaces) but share the lesson: `new Date(String(n))` is not evidence of
  temporal intent.

These need not be folded into one decision, but a consistent owner answer
("numbers are quantitative unless they carry real date structure / metadata")
ratifies all three in the same spirit.

## The one decision the owner needs to make

**Pick A, B, or C for the metadata-less value path of `inferEncodingType`**
(recommended **C** — date-candidate only when `Number(String(v))` is `NaN` or `v`
is a `Date`, so numbers/numeric-strings infer `quantitative` while genuine
date-string/`Date` detection is preserved). On a pick of **C/A**, the
implementing session applies the one-predicate guard and **flips the locked
numeric `temporal` assertions** in `inferEncodingType.test.ts` in the same commit
(genuine-date and boolean pins stay green); a single eyes-on chart check confirms
the axis-type delta for any year-like numeric column. On a pick of **B**, the
session adds a contract comment on the value path documenting the
numeric→temporal default and the metadata escape hatch; the locked assertions
stay green. The decision is whether ambiguous metadata-less **numbers** should
default to **quantitative** (C) or **temporal** (B).
