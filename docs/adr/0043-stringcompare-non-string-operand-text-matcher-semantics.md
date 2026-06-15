# ADR 0043: TEXT-matcher semantics for a non-string non-nullish operand (`stringCompare` `.toLowerCase()` TypeError on number `0` / boolean `false`)

## Status

Proposed.

Awaiting an owner decision. Tracked by bd `Notidian-9i9i` (the fix follow-up to
the characterization landed by `Notidian-u8yx`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blindly editing `filter.ts`**: the fix *looks* like a
one-line guard, but the bead explicitly frames it as a **behavior question**
("DECISION NEEDED before fix... coercing with `String(value ?? "")` changes
observable behavior"), and there is a **LOCKED DEFECT-PIN assertion** in
`filterFnTypes.test.ts` that asserts the matcher `toThrow(TypeError)` — that
assertion must be **deliberately re-blessed** as part of any fix, which is a
decision posture, not a blind edit (same pattern as ADR 0025 / 0030 / 0032 /
0033 / 0034 / 0042, where pinned characterization assertions are flipped only by
a reviewed decision). **No code or test change is made on this route** — the bead
stays OPEN awaiting the owner's pick, and the locked assertion is **not** flipped
until then.

## Date

2026-06-15

## Context

### The defect, exactly

`src/core/utils/contexts/predicate/filter.ts:63-70` — the text "contains"
matcher behind the `include` / `notInclude` filter operators:

```ts
export const stringCompare: FilterFunction = (value, filterValue): boolean => {
  return (value ?? "")
    .toLowerCase()
    .includes((filterValue ?? "").toLowerCase());
};
```

The `(value ?? "")` guard catches `null`/`undefined` but **not** a non-string
non-nullish primitive. A `number 0` or a `boolean false` passes the `??` guard
unchanged and then hits `.toLowerCase()`, which numbers/booleans do not have:

```
stringCompare(0, "abc")    -> TypeError: (value ?? "").toLowerCase is not a function
stringCompare(false, "")   -> TypeError: ...
stringCompare(true, "tr")  -> TypeError: ...
stringCompare(42, "4")     -> TypeError: ...
```

(All four reproduced empirically against the exact source.) This is
**characterized (not fixed)** by `Notidian-u8yx` and pinned in
`filterFnTypes.test.ts` as a **DEFECT-PIN** in two places, accessed *through the
dispatch map* (the real surface):

```ts
// filterFnTypes.test.ts:185-188 (the named DEFECT-PIN)
expect(() => include(0 as any, "abc")).toThrow(TypeError);
expect(() => include(false as any, "")).toThrow(TypeError);
expect(() => notInclude(0 as any, "abc")).toThrow(TypeError);
expect(() => notInclude(false as any, "")).toThrow(TypeError);

// filterFnTypes.test.ts:373-394 (the load-bearing null-safety net)
const throwsTypeError = (key, v) =>
  (key === "include" || key === "notInclude") && (v === 0 || v === false);
//   -> asserts entry.fn(v, f) `.toThrow(TypeError)` for those cells.
```

Those assertions are **locked characterization** — they document *current*
behavior, not desired behavior, and any fix MUST flip them as part of a reviewed
decision.

### Why this is a LIVE crash, not a latent one

`filterReturnForCol` (`filter.ts:140-157`) has **no try/catch**, and it is on the
table-view row-visibility hot path with three production call sites
(`linkContextRow.ts:372,378`, `treeHelpers.ts:224`,
`ContextEditorContext.tsx:681`). So a single throwing cell crashes the **whole
filter pass** for that table, not just one row.

The reachable scenario is a **flex** cell. `filterReturnForCol:152` reads a flex
cell's value as `parseFlexValue(row[filter.field])?.value`, and `parseFlexValue`
(`parseFieldValue.ts:62-73`) returns `safelyParseJSON(dataString).value` — i.e. a
**real JSON `number 0` or `boolean false`**, not a string. If that flex column is
configured with a text-style type (so `include`/`notInclude` are offered —
`filterFnTypes.ts:16-25` declare `type: ["text","file","link","image"]`) and the
stored value is `0`/`false`, the matcher throws and the filter pass dies. (A
numeric **string** `"0"` is fine — it is a string, so the guard path holds;
pinned `filterFnTypes.test.ts:190-191`.)

### The gap is SHARED across the TEXT matchers — but with TWO distinct failure modes (verified)

The bead asks whether the sibling text matchers need the same treatment. They do
share the `(value ?? "")` non-string gap, but it manifests **differently**, and
the distinction is decision-relevant (verified empirically against the exact
source):

| matcher | code | non-string `0`/`false` result | dispatched? |
| --- | --- | --- | --- |
| `stringCompare` (`filter.ts:67`) | `(v ?? "").toLowerCase().includes(...)` | **THROWS** (`.toLowerCase` not a fn) | **YES** — `include`/`notInclude` |
| `startsWith` (`filter.ts:18`) | `(v ?? "").startsWith(f)` | **THROWS** (`.startsWith` not a fn) | **NO** (exported, no dispatch entry) |
| `endsWith` (`filter.ts:25`) | `(v ?? "").endsWith(f)` | **THROWS** (`.endsWith` not a fn) | **NO** (exported, no dispatch entry) |
| `lengthEquals` (`filter.ts:37`) | `(v ?? "").length == parseInt(f)` | **silently `false`** (`(0).length` is `undefined`, `undefined == NaN/n` is false) | **NO** (exported, no dispatch entry) |
| `empty` (`filter.ts:60`) | `(v ?? "").length == 0` | **silently `false`** (`undefined == 0` is false) | **YES** — `isEmpty`/`isNotEmpty` |

Two corrections to the bead's framing fall out of the evidence and *change the
blast-radius picture* (which is why this matters, not pedantry):

1. **`startsWith`/`endsWith` DO throw on `0`/`false`** (Number/Boolean have no
   `.startsWith`/`.endsWith` at all) — they are not "spared" by a missing method;
   they are spared only because **they are not wired into the dispatch table**
   (`grep` of `filterFnTypes.ts` finds zero references). So their throw is
   genuinely **latent** (no live caller reaches them via the table filter), unlike
   `stringCompare`.
2. **`lengthEquals`/`empty` fail closed *by accident*** — they call `.length`
   (which is `undefined` on a number/boolean), so the comparison is just `false`.
   `empty` **is** dispatched (`isEmpty`/`isNotEmpty`), so today a `0`/`false`
   flex cell reads as **non-empty** (which is arguably correct — `0` is a real
   value), via an accidental coercion path rather than an intended one.

So the only **live crash** is `stringCompare`; `startsWith`/`endsWith` are latent
crashes one dispatch-wire away; `lengthEquals`/`empty` are accidentally-OK but
**semantically inconsistent** (relying on `undefined.length` evaluating falsey
rather than an explicit contract). The decision below applies one explicit,
uniform rule so the family stops depending on coincidence.

### The established house convention this aligns with

The predicate family already has a documented, repeatedly-ratified
**fail-closed** convention for an operand that does not belong to a matcher's
type — a non-matching operand must **never spuriously match**, and must never
throw:

- `lessThan`/`greaterThan` (`filter.ts:79-90`): "a non-numeric operand parses to
  NaN and `NaN < x` / `x < NaN` is false, so a non-numeric value never satisfies a
  numeric `<`/`>`" — and the `OrEqual` derivatives inherit it.
- `lengthEquals` (`filter.ts:32-37`, Notidian-0lo): "a non-numeric filterValue
  parses to NaN and `length == NaN` is always false, so a non-numeric operand
  makes every length fail (fail-closed) — mirrors the NaN convention."
- `dateAfter`/`dateBefore` (ADR 0032(b), `filter.test.ts:404-408`): an
  unparseable date is Invalid Date / NaN and is **invisible to both** filters
  (fail-closed) — a malformed value must not silently satisfy a date filter.

There is exactly one **defensibly-different** sibling: ADR 0034 chose **fail-open**
for an *operator-level* unreadable constraint (`filterReturnForCol` keeps a row
visible for an unknown `fn`). That is the *operator* axis (a corrupt predicate
should not hide the owner's own data). This ADR is the *value* axis (a
non-matching cell value), where the whole family already fails **closed** — so
the consistent answer here is fail-closed, matching ADR 0032(b)'s value-level
posture rather than ADR 0034's operator-level one.

### Why this is a decision, not a blind one-liner

1. **The bead frames the semantics as the open question** — fail-closed-empty vs
   coerce-to-string are **not** equivalent (option B silently makes a `0` cell
   substring-match the text `"0"`, a `false` cell match `"false"` — a behavior
   change the owner gets no signal about), and the bead also asks whether the
   sibling matchers get the same treatment.
2. **A locked DEFECT-PIN assertion must be re-blessed.** Flipping
   `filterFnTypes.test.ts:185-188` and `:373-394` from `toThrow(TypeError)` to
   "does not throw" is a deliberate behavior change the owner should ratify —
   exactly the posture ADR 0025 / 0030 / 0032 / 0033 / 0042 take.

## Decision drivers

- **Remove the uncaught throw** that crashes the entire table-view filter pass —
  the load-bearing fact (`filterReturnForCol` has no try/catch).
- **Obey the established value-level fail-closed convention** — a non-matching
  operand must never spuriously match (lessThan/greaterThan/lengthEquals/date),
  and never throw.
- **Don't invent surprising cross-type matching** — a text "contains" filter on a
  numeric/boolean cell silently matching `"0"`/`"false"` is a footgun with no user
  signal.
- **Make the smallest deliberate change to the pinned characterization** — flip
  the throw, nothing more.
- **Stop relying on coincidence** — make the sibling matchers' non-string
  behavior explicit and uniform instead of "happens to be false because
  `undefined.length`".
- **Re-bless the locked assertion explicitly**, never silently.

## Options

### Option A (recommended) — FAIL-CLOSED-EMPTY, applied uniformly to the shared non-string gap

Coerce a non-string non-nullish operand to `""` **only** when it is non-string —
i.e. treat a numeric/boolean cell as an empty cell *for the purposes of a text
matcher*. Apply the **same** guard uniformly across the shared non-string gap:
`stringCompare`, `startsWith`, `endsWith`, `empty`, `lengthEquals`. Concretely, a
shared helper:

```ts
// non-string non-nullish -> "" (an empty cell, for a TEXT matcher);
// strings & null/undefined behave exactly as today.
const asText = (v: any): string => (typeof v === "string" ? v : "");
```

then `stringCompare` becomes `asText(value).toLowerCase().includes(...)`,
`startsWith`/`endsWith` use `asText(value)`, and `empty`/`lengthEquals` measure
`asText(value).length`. (For `empty`/`lengthEquals` this is behavior-preserving —
they already evaluate falsey on a non-string today; the change just makes the
fail-closed result *intentional* instead of an `undefined.length` accident.)

Then **flip the locked DEFECT-PIN assertions** at `filterFnTypes.test.ts:185-188`
and `:373-394` from `toThrow(TypeError)` to "does not throw", with positive
assertions: `include(0,"abc") === false`, `include(0,"") === true` (an empty cell
contains the empty filter — same as `include(null,"")`), `notInclude(0,"abc") ===
true`, etc., each citing this ADR + `Notidian-9i9i`.

- **Observable matching effect:** a text `include "0"` filter on a numeric `0`
  cell returns **false** (the cell is treated as empty); an `isEmpty` filter on a
  `0` cell continues to return **false** (a `0` is a real value — preserved). No
  numeric/boolean cell ever spuriously matches a text substring.
- **Pros:** removes the uncaught throw with the **smallest** deliberate change to
  the pinned characterization; **matches the established `(value ?? "")` sibling
  convention** and the documented value-level fail-closed convention
  (lessThan/greaterThan/lengthEquals/date — a non-matching operand never
  spuriously matches); does **not** invent surprising cross-type matching; makes
  the whole family's non-string behavior **explicit and uniform** (no more
  `undefined.length` coincidence); pure, offline-provable predicate logic.
- **Cons:** for the *latent* matchers (`startsWith`/`endsWith`/`lengthEquals`,
  not currently dispatched) this is defensive hardening, not a live fix — but it
  is the same one-line helper and prevents the next crash if they are ever wired
  in. Requires deliberately flipping locked assertions (intended — it *is* the
  decision).

### Option B — COERCE-TO-STRING via `String(value ?? "")`

Replace `(value ?? "")` with `String(value ?? "")` so a non-string operand is
stringified before `.toLowerCase()`.

- **Observable matching effect:** a numeric `0` cell now **substring-matches** a
  text `include "0"` filter; a `boolean false` cell matches `include "false"`;
  `42` matches `include "4"`. The filter pass no longer throws, but a text
  "contains" filter starts matching numeric/boolean columns by their rendered
  digits/words.
- **Pros:** also removes the throw with a one-character-class change; arguably
  "shows the value as the user sees it" for someone deliberately running a text
  filter over a numeric column.
- **Cons (decisive):** this is a **behavior change with no user signal** — a user
  filtering a column by text "contains" suddenly gets numeric cells matching on
  their digits (`include "1"` matches `1, 10, 11, 100, ...`), which is a classic
  footgun and diverges from the whole family's fail-closed value convention
  (lessThan/greaterThan/lengthEquals/date all make a non-matching operand
  **fail**, not coerce-and-match). It conflates "this text appears in the cell"
  with "this digit appears in the number's decimal rendering". Rejected.

### Option C — ROUTE-BY-TYPE at the dispatch layer (a numeric/boolean cell never reaches a TEXT matcher)

Gate the dispatch in `filterFnTypes.ts` / `filterReturnForCol` so that a
numeric/boolean column value is never handed to a text matcher in the first place
(e.g. coerce or short-circuit based on `col.type`, or refuse the operator for the
column type).

- **Pros:** the most *correct* long-term shape — a TEXT matcher only ever sees
  text; strict type-routing makes the throw structurally impossible and is the
  cleanest mental model.
- **Cons (decisive for now):** **largest blast radius** — it touches the shared
  dispatch table that every operator flows through, and the column-type ->
  operator contract (`type: [...]` arrays) which is also consulted by the filter
  UI. The `flex` case is exactly where type is *ambiguous* (a flex column can hold
  a number while offering text operators), so "route by `col.type`" has to define
  flex behavior anyway — re-introducing the same question one layer up. Higher
  risk for a problem Option A already closes with a one-line value guard. **Not
  rejected as a direction** — recorded as the eventual target if the owner wants
  strict type-routing; just heavier than warranted to remove this crash now.

## Recommendation

**Option A — FAIL-CLOSED-EMPTY, applied uniformly to the shared non-string gap
across `stringCompare` / `startsWith` / `endsWith` / `empty` / `lengthEquals`
(`typeof v === "string" ? v : ""`), and re-bless the locked DEFECT-PIN assertions
accordingly.** One line of why: it is the **smallest deliberate change** that
removes the uncaught throw while **matching the established value-level
fail-closed convention** (a non-matching operand never spuriously matches, never
throws — lessThan/greaterThan/lengthEquals/date), without **inventing surprising
cross-type matching** the way B does and without the dispatch-wide blast radius C
carries.

### Ruled out

- **Option B (coerce-to-string `String(value ?? "")`)** — silently making a `0`
  cell substring-match `"0"` and a `false` cell match `"false"` is a footgun and
  an observable behavior change with **no user signal**, diverging from the
  family's value-level fail-closed convention.
- **Option C (route-by-type at the dispatch layer)** — most correct long-term but
  heavier (touches the shared dispatch table + column-type/operator contract), and
  the flex ambiguity re-creates the same question one layer up. **Recorded as the
  eventual direction** if the owner wants strict type-routing; not the way to
  remove this crash today.
- **A default-OFF runtime flag** — not applicable: this is pure, offline-provable
  predicate logic with no render/authority/`innerHTML` surface; there is nothing a
  runtime flag de-risks (the no-flag posture of ADR 0032/0033/0034/0036/0042). The
  verification is jest, not eyes-on-vault.
- **Editing `filter.ts` or flipping the locked DEFECT-PIN now (a blind build)** —
  the matching semantics (fail-closed-empty vs coerce-to-string vs route-by-type)
  and the re-blessing of a pinned `toThrow` characterization are owner calls;
  hence an ADR, with the bead OPEN.

## Consequences

If the owner approves **A**, the implementing session:

1. adds a shared `asText`-style helper (`typeof v === "string" ? v : ""`) in
   `filter.ts` and routes `stringCompare`, `startsWith`, `endsWith`, `empty`,
   `lengthEquals` through it in place of bare `(value ?? "")` — strings and
   `null`/`undefined` behave **exactly** as today; only non-string non-nullish
   primitives change (now treated as an empty cell instead of throwing /
   accidentally-falsey);
2. **flips the locked DEFECT-PIN assertions** at `filterFnTypes.test.ts:185-188`
   and `:373-394` from `toThrow(TypeError)` to "does not throw", adds positive
   verdict assertions (`include(0,"abc") === false`, `include(0,"") === true`,
   `notInclude(0,"abc") === true`), and removes the `throwsTypeError` special-case
   so the null-safety net asserts no-throw for **every** entry incl. `0`/`false`
   — with a comment noting the re-blessing and citing this ADR + `Notidian-9i9i`;
3. adds (or confirms) positive coverage in `filter.test.ts` for the previously
   un-exercised `0`/`false` operands on `startsWith`/`endsWith`/`lengthEquals`
   (the latent siblings) so the uniform contract is pinned, not just `stringCompare`;
4. closes `Notidian-9i9i`.

Everything is pure, offline-provable predicate logic (no
render/authority/`innerHTML` surface), so the gate is **jest** (`npm test`) + tsc
+ build green — **no eyes-on-vault step and no default-OFF flag.** Until a pick,
**no `filter.ts` or `filterFnTypes.test.ts` change is made** and the locked
DEFECT-PIN assertions are **not** flipped.
