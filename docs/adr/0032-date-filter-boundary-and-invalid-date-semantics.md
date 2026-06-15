# ADR 0032: Date-Filter Boundary Semantics + Invalid-Date Behavior (`dateAfter`/`dateBefore`/`isSameDay`)

## Status

Accepted.

Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

Tracked by bd `Notidian-qbr`; queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written instead of changing the date predicates blind. The three date filter
functions are on the **table-view row-visibility path**, their current output is
**explicitly pinned as characterization** in
`src/core/utils/contexts/predicate/filter.test.ts` (Notidian-3fs, lines 367-507),
and the chosen boundary + malformed-input contract is a **product/UX decision**
(what does "before/after a date" mean to the user, and should a corrupt date be
visible?), not pure logic. The build stops here until the owner picks a direction.

## Date

2026-06-15

## Context

### The code

`src/core/utils/contexts/predicate/filter.ts` defines three date predicates,
wired into `filterFnTypes` as the `dateBefore` / `dateAfter` / `isSameDate`
operators for `date`-typed columns (`filterFnTypes.ts:71-85`):

```ts
export const dateAfter: FilterFunction = (value, filterValue) => {
  const dateValue = isNaN(Date.parse(value)) ? new Date(parseInt(value)) : new Date(value);
  const dateFilterValue = isNaN(Date.parse(filterValue)) ? new Date(parseInt(filterValue)) : new Date(filterValue);
  return dateValue.valueOf() >= dateFilterValue.valueOf();   // line 97 — INCLUSIVE >=
};

export const dateBefore: FilterFunction = (value, filterValue) => {
  const dateValue = isNaN(Date.parse(value)) ? new Date(parseInt(value)) : new Date(value);
  const dateFilterValue = isNaN(Date.parse(filterValue)) ? new Date(parseInt(filterValue)) : new Date(filterValue);
  return dateValue.valueOf() < dateFilterValue.valueOf();    // line 106 — EXCLUSIVE <
};

export const isSameDay: FilterFunction = (value, filterValue) => {
  if (!value) return false;
  const inputDate = new Date(`${value.toString().replace(".", ':')}`);
  const currentDate = new Date(`${filterValue}`);
  return inputDate.getMonth() === currentDate.getMonth()
      && inputDate.getDate() === currentDate.getDate();        // line 127 — month+date only, YEAR IGNORED
};
```

Both `dateAfter`/`dateBefore` compare at **instant (millisecond) granularity**
via `Date.parse` → `.valueOf()`. `isSameDay` compares at **calendar granularity**
but only **month + day**, never the year.

### Three concrete defects (all empirically verified)

**(1) Boundary asymmetry — `>=` vs `<` disagree on the boundary instant.**
`dateAfter` is inclusive; `dateBefore` is exclusive. So an instant **exactly equal**
to the boundary satisfies `dateAfter` but **not** `dateBefore`:

```
dateAfter ("2024-06-01T12:00:00", "2024-06-01T12:00:00")  -> true   (>= includes equal)
dateBefore("2024-06-01T12:00:00", "2024-06-01T12:00:00")  -> false  (<  excludes equal)
```

Pinned at `filter.test.ts:372` and `:393` ("DEFECT-PIN: ... asymmetric with
dateAfter"). The two operators are not complementary at the boundary, and worse,
because the comparison is at **instant** granularity while users pick a **date**,
the boundary is a single midnight point, not the whole day. A date-only filter
(`2024-06-01`) parses to **local midnight**, so:

```
filter = "2024-06-01"  (= local midnight)
dateAfter ("2024-06-01T15:00:00", "2024-06-01")  -> true   (afternoon is after midnight)
dateBefore("2024-06-01T15:00:00", "2024-06-01")  -> false  (afternoon is not before midnight)
dateAfter ("2024-06-01T00:00:00", "2024-06-01")  -> true   (midnight == midnight, inclusive)
dateBefore("2024-06-01T00:00:00", "2024-06-01")  -> false
```

So whether a row dated "on June 1" is matched by an "after June 1" / "before
June 1" filter depends on the **time of day stored in the row** — which the user
usually never set and cannot see. This is the load-bearing UX bug: "on the
boundary day" splits unpredictably.

**(2) Invalid-Date invisibility — a malformed value disappears from BOTH filters.**
An unparseable value (`Date.parse` → `NaN`, then `new Date(parseInt(value))` →
`Invalid Date`) has a `NaN` `.valueOf()`, and **every** comparison with `NaN` is
false (`NaN >= x` is false, `NaN < x` is false):

```
dateAfter ("garbage", "2024-06-01")  -> false
dateBefore("garbage", "2024-06-01")  -> false
```

Pinned at `filter.test.ts:404`. So a row whose date cell holds a typo, a free-text
note, or a partially-entered value is **invisible to both** date filters — it
silently fails out of an "after" filter and out of a "before" filter
simultaneously. Today this is **fail-closed** (a malformed date never satisfies a
date filter).

**(3) `isSameDay` ignores the year.**
`isSameDay` compares only `getMonth()` and `getDate()`, so the same calendar
month/day in **any** year matches:

```
isSameDay("2024-03-15T12:00:00", "1999-03-15T12:00:00")  -> true   (different years, "same day")
```

Pinned at `filter.test.ts:447` ("is true for the same month+day (year ignored)").
For an "on this date" filter this is almost certainly a bug: a user filtering for
"15 March 2024" does not expect rows from 15 March 1999 to match. (Note the
sibling `isSameDayAsToday` is intentionally year-agnostic — an "anniversary /
same day-of-year as today" check — and a separate concern; see below.) `isSameDay`
also returns `false` when `filterValue` is unparseable (`NaN===NaN` is false),
which is the same fail-closed posture as (2) and is reasonable.

### How the value reaches the predicate (grounds the granularity question)

The filter value is a stored **string** (`predicate.ts` `Filter.value`); the date
filter editor (`PropertyValue.tsx` → `datePickerMenu.tsx`) lets the user pick a
**date**, and the row value comes from a `date`-typed column whose stored form is a
date or date-time string. Neither side is normalized to a common granularity before
the comparison — the predicate parses both strings as-is and compares
milliseconds. So the granularity mismatch in (1) is structural: a **day** filter is
compared against a **possibly-timed** value at **instant** precision.

### Why this is a decision, not a blind fix

Every plausible fix changes **which rows the owner sees** in a date-filtered table
— observable vault behavior offline gates (tsc/jest/build) cannot prove correct,
and the current behavior is deliberately locked as characterization so a change is
a conscious, reviewed flip rather than an accident. The "right" boundary
(half-open vs day-inclusive) and the "right" malformed-input posture (invisible vs
fail-open vs empty) are genuine product calls. Hence: ADR + recommendation, not a
build.

## Decision

**Recommended:**

- **(a) Boundary — make `dateAfter`/`dateBefore` consistent and day-granular**
  (Option A1 below): normalize both the row value and the filter value to the
  **start of their calendar day** before comparing, and keep both operators
  **day-inclusive at that granularity** — `dateAfter` true when the value's day is
  **on or after** the filter day; `dateBefore` true when the value's day is **on or
  before** the filter day. "On the boundary day" then matches both, consistently,
  regardless of the time-of-day stored in the row.
- **(b) Invalid-Date — keep invisible-to-both (fail-closed)** (Option B1 below): a
  value that cannot be parsed to a real date does **not** satisfy any date filter.
  A malformed date must not silently *satisfy* a date filter (fail-open would let
  garbage pass a "before X" or "after X" filter); making it visible-to-both is the
  opposite hazard.
- **(c) `isSameDay` — also compare the year** (a real bug fix): `isSameDay` should
  match the **same calendar date including year**. Leave the intentionally
  year-agnostic anniversary behavior to `isSameDayAsToday` (rename/clarify its
  label if it ever exposes a date argument).

One-line why: these are **date** filters, so "on the boundary day" is the user's
mental model — symmetric, day-granular, inclusive boundaries are the least
surprising; a malformed date should fail closed (never silently satisfy a date
filter); and a same-month/day match across **different years** is almost certainly
unintended for an explicit "is this date" filter.

### Options

#### Boundary semantics

**Option A1 — Day-granular, both inclusive (RECOMMENDED).**
Truncate both operands to their local calendar day (e.g. compare
`startOfDay(value)` against `startOfDay(filter)`) and define:
`dateAfter` = `valueDay >= filterDay`, `dateBefore` = `valueDay <= filterDay`.

- **Pros:** matches the user's "before/after this date" mental model; the
  boundary **day** matches both operators consistently; eliminates the
  time-of-day-dependent split — a row "on June 1" behaves the same whether it was
  stored as `2024-06-01` or `2024-06-01T15:00`. Symmetric, predictable.
- **Cons:** "after June 1" now includes rows **on** June 1 (and "before June 1"
  includes rows **on** June 1) — a deliberate, documented widening from the
  current instant-`>` / instant-`<` feel. For genuine date-**time** columns
  (timestamps), day-truncation discards the time component for filtering; if the
  owner wants time-precise filtering on timestamp columns, that is a separate,
  opt-in concern (see ruled-out A3). Requires a small `startOfDay` helper and
  flipping the boundary characterization assertions.

**Option A2 — Keep instant granularity, but make the boundary consistent.**
Keep millisecond comparison; make both operators inclusive (`>=` and `<=`) or both
exclusive (`>` and `<`) so they agree on the boundary instant.

- **Pros:** smallest change; removes the `>=`/`<` asymmetry; preserves
  time-precise filtering for timestamp columns.
- **Cons:** does **not** fix the real UX bug — a date-only filter still parses to
  midnight, so "on the boundary day" still depends on the row's time-of-day. Two
  rows both "on June 1" still sort differently into before/after by the minute they
  were saved. Consistent-but-still-surprising.

**Option A3 — Keep current half-open `>=` / `<` (status quo, documented).**
Annotate the asymmetry as intended (a half-open `[filter, ∞)` / `(-∞, filter)`
interval pair that tiles the timeline without overlap) and keep the tests.

- **Pros:** zero behavior change; half-open intervals are a legitimate convention
  (they partition the timeline: every instant is in exactly one of "before" /
  "after-or-equal").
- **Cons:** the convention is invisible to users picking a *date*; the
  time-of-day-dependent same-day split remains; "before X" and "after X" are not
  complementary at the day level, which reads as a bug to anyone who isn't thinking
  in half-open instant intervals.

#### Invalid-Date behavior

**Option B1 — Invisible to both / fail-closed (RECOMMENDED, status quo).**
An unparseable value satisfies no date filter (current `NaN`-comparison behavior,
made explicit and tested).

- **Pros:** a malformed date never silently *passes* a date filter — the safe
  default for a predicate ("if I can't read this date, it doesn't match a date
  question"). Matches the established fail-closed NaN convention already documented
  for `lessThan`/`greaterThan`/`lengthEquals` in this file.
- **Cons:** a malformed value is hidden from **both** before- and after-filters, so
  a user filtering won't see their typo'd rows in either direction (they remain
  visible only with no date filter, or with an explicit `isEmpty`/`isNotEmpty`).
  Acceptable, but worth documenting so the disappearance isn't mistaken for data
  loss.

**Option B2 — Visible to both / fail-open.**
Treat an unparseable value as matching any date filter.

- **Pros:** a malformed row never silently disappears; the user notices and can
  fix it.
- **Cons:** garbage satisfies a "before X" **and** an "after X" filter — the
  predicate stops meaning anything for bad data, and a filter built to *narrow*
  rows would *keep* corrupt ones. Worse than B1 for the predicate's job.

**Option B3 — Treat unparseable as empty.**
Route a non-parseable date value through the empty/`isEmpty` semantics (a bad date
== no date).

- **Pros:** conceptually clean — "I can't read a date here, so there is no date";
  surfaces via the existing empty/not-empty filters.
- **Cons:** conflates "blank cell" with "typo'd date" (different user intents);
  requires the date predicates to special-case empty-vs-NaN; larger change than B1
  for a marginal gain. Deferred, not rejected.

#### `isSameDay` year comparison

**Option C1 — Compare year + month + day (RECOMMENDED).**
`isSameDay` matches the same full calendar date. Keep `isSameDayAsToday`
year-agnostic (anniversary/day-of-year vs today).

- **Pros:** "is 15 March 2024" stops matching 15 March 1999 — what the operator's
  label implies. A real correctness fix.
- **Cons:** flips the `filter.test.ts:447` "year ignored" characterization
  assertion; any owner who was (unknowingly) relying on cross-year same-day
  matching loses it — but that behavior is almost certainly accidental.

**Option C2 — Keep year-agnostic, document it as intended.**
Leave `isSameDay` ignoring the year and rename/relabel it as an "anniversary"
operator.

- **Pros:** zero behavior change; if the owner *wants* a day-of-year operator, this
  names it honestly.
- **Cons:** there is already `isSameDayAsToday` for the anniversary case; a generic
  "is same date as <picked date>" operator that ignores the year is surprising and
  duplicative. Recommended only if the owner explicitly wants cross-year matching.

### Ruled out

- **A2 / A3 for the boundary** — both leave the real UX bug (time-of-day-dependent
  same-day split) in place; A2 only patches the symptom (the `>=`/`<` disagreement)
  without fixing the granularity mismatch that causes it. A1 fixes the cause. A3 is
  acceptable only if the owner deliberately wants half-open instant intervals and
  accepts the day-level non-complementarity.
- **B2 (fail-open)** — lets corrupt dates satisfy date filters, defeating the
  filter's purpose; the opposite of the conservative default. B3 (treat-as-empty)
  is a reasonable alternative but conflates blank and malformed and is larger than
  B1 — deferred.
- **C2 (keep year-agnostic)** — the anniversary use case is already served by
  `isSameDayAsToday`; a year-agnostic generic "same date" is surprising. Kept only
  if the owner confirms cross-year matching is intended.

## Consequences

- **If the recommendation (A1 + B1 + C1):** date filters become day-granular and
  symmetric (a row "on the boundary day" matches both before- and after-filters
  consistently, regardless of stored time); malformed dates stay invisible to
  every date filter (fail-closed, documented); `isSameDay` matches the full date
  including year. The boundary + year-agnostic characterization assertions in
  `filter.test.ts` (lines ~372, ~393, ~404, ~447) are **deliberately flipped** to
  assert the corrected behavior, guarded by the surrounding adversarial net.
  Implementation is a small `startOfDay`-style helper plus the year comparison —
  pure, offline-provable logic; **one eyes-on vault check** confirms the visible
  boundary-inclusion delta on a real date-filtered table.
- **If A2:** only the `>=`/`<` disagreement is removed; the same-day time-of-day
  split persists.
- **If A3:** nothing changes for the boundary; the asymmetry is documented as
  intended half-open intervals.
- **If B2/B3:** malformed-date rows change visibility (visible-to-both, or routed
  through empty semantics) — a vault-observable change requiring eyes-on confirm.
- **If C1:** cross-year same-day matches stop matching (almost certainly desired).

This is a **logic** change (no render-path / `innerHTML` / authority surface), so
**no default-OFF flag is proposed** — per the AUTONOMOUS-REVIEW-QUEUE convention,
the flag mechanism is for changes gates *cannot* prove offline; these predicates
are fully jest-provable. The only un-gate-able aspect is the one-time visible
row-set delta, which the existing characterization net plus a single eyes-on vault
check settle. No code or test was changed by this ADR; `filter.ts` and the pinned
`filter.test.ts` assertions are untouched until the owner picks a direction.

### Adjacent decision the owner may want to resolve together

**Notidian-37m — `filterReturnForCol` fail-open for unknown/undefined filter fns.**
`filterReturnForCol` returns `true` (row stays visible) when `filter.fn` is
unknown, undefined, or `filter` is null — a corrupt/unrecognized predicate silently
**disables** filtering rather than failing loud or hiding rows (pinned at
`filter.test.ts:526`, `:532`, `:591`). That is the **same family of question** as
(b) here — what should a malformed predicate input do? — but at the dispatcher
level (unknown *operator*) rather than the value level (unparseable *date*). The
two have different defensible answers (fail-open is plausibly correct for an
unknown fn from a newer schema version — forward-compat — whereas fail-closed is
recommended for a malformed date), so they need not resolve the same way, but the
owner may prefer to settle the whole predicate-contract posture in one pass.
Notidian-37m is filed separately (P3) and is **not** decided by this ADR.

## The one decision the owner needs to make

Approve the recommended trio, or pick alternatives per axis:
- **(a) Boundary:** **A1** (day-granular, both inclusive — RECOMMENDED) / A2
  (consistent instant) / A3 (keep half-open, document).
- **(b) Invalid-Date:** **B1** (invisible-to-both / fail-closed — RECOMMENDED,
  status quo) / B2 (visible-to-both) / B3 (treat-as-empty).
- **(c) `isSameDay` year:** **C1** (compare year too — RECOMMENDED) / C2 (keep
  year-agnostic, relabel as anniversary).

On a pick, the implementing session applies it and **deliberately flips** the
pinned characterization assertions in `filter.test.ts`, guarded by the surrounding
adversarial net; one eyes-on vault check confirms the visible row-set delta.
Optionally fold in **Notidian-37m** (`filterReturnForCol` fail-open) for a single
predicate-contract decision.
