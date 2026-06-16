# ADR 0038: `AreaChartTransformer` throws on a missing x encoding — alone among the six transformers

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

Resolved as **Option A** (the recommendation): `AreaChartTransformer.transform`
now early-returns the empty `AreaChartData` contract when there is no usable x
encoding (`!xEncodings[0]?.field`), and the two locked `KNOWN DEFECT`
`toThrow` assertions were flipped to expect that empty contract in the same
commit. The remainder of this ADR is preserved as the decision record.

Originally awaiting an owner decision. Tracked by bd `Notidian-drp` (the divergence was
discovered + **LOCKED as a `KNOWN DEFECT`** characterization by the orchestrator
net `Notidian-kxq`, `AreaChartTransformer.test.ts`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blind-fixing the throw**, because the repair changes
owner-visible chart output (an error-state render vs an empty chart) and the
characterization deliberately pins the current throw.

## Date

2026-06-15

## Context

`AreaChartTransformer.transform` (`src/core/react/components/Visualization/transformers/AreaChartTransformer.ts:86`)
is the pure `rawData -> AreaChartData` data layer for the D3 area renderer. It is
one of **six** sibling transformers (Bar / Pie / Line / Scatter / Radar / Area)
on the same Visualization data path (ADR 0033 / 0035 / 0037 subtree).

### The defect (verified offline, locked as characterization)

`AreaChartTransformer.transform([{ a: 1 }], cfg-with-no-x-encoding)` **THROWS**
`TypeError: Cannot read properties of undefined (reading 'type')` instead of
returning the documented empty contract
`{ data: [], series: [], xDomain: [], yExtent: [0, 0], stacked: false }`. The
same throw fires for `x: []` (empty array).

**Root cause.** When `config.encoding.x` is `undefined` (or `[]`),
`xEncodings = Array.isArray(config.encoding.x) ? config.encoding.x : [config.encoding.x]`
(`:95`) evaluates to `[undefined]`. The function then guards the *first* x read
correctly:

```ts
// :108 — GUARDED (optional chaining)
if (xEncodings[0]?.type === 'temporal' && !xEncodings[0].timeUnit) { … }
```

and all three per-branch helpers guard correctly and early-return
`[]`/skip (`transformSingleSeries` `:461`, `transformWithColorGrouping` `:343`,
`transformMultipleYFields` `:240/:243`). But the **main-body temporal-fill block**
dereferences `xEncodings[0].type` with **no** guard:

```ts
// :154 — UNGUARDED — throws when xEncodings[0] === undefined
if (xEncodings[0].type === 'temporal' && xEncodings[0].timeUnit && allXValues.size > 0) { … }
```

so with `xEncodings = [undefined]`, line 154 throws. It is a single missing `?.`
relative to its own guarded sibling at `:108`.

This is **LOCKED** in `AreaChartTransformer.test.ts` (describe
`"KNOWN DEFECT: throws on missing x encoding"`, `:83-95`): two assertions pin
`toThrow(TypeError)` for the absent-x and empty-array-x cases on non-empty data.
The same file already asserts the **safe** cases return the empty contract:
missing *y* (`:52`), x-object-present-but-field-missing (`:58`), and empty/null
`rawData` (`:40/:46`). So Area is robust everywhere **except** the one unguarded
main-body line. (18 characterization tests, all green.)

### Area alone diverges — the five siblings return the safe empty contract

Every sibling returns an empty/zero result for a missing-x encoding; **none**
throws (verified by reading each):

| transformer | missing-x behavior | where |
| --- | --- | --- |
| **Bar** | early-return `{ data: [], categories: [] }` | `if (!xEncoding?.field …) return` (`:119-121`) |
| **Line** | wraps the **entire** fill block in `if (xEncodings[0])`, so a missing x just **skips** fill and returns the (empty) data | `:86` |
| **Radar** | early-return empty radar result | `if (!xEncoding?.field) return {…}` (`:51-52`) |
| **Pie** | early-return `{ data: [], total: 0 }` | `:27` |
| **Scatter** | `!xEncoding?.field` triggers a default-field fallback; never throws | `:47-` |
| **Area** | **THROWS** `TypeError` at the unguarded `:154` | this defect |

**Line is Area's architectural twin** — same multi-Y / color-grouped /
single-series structure, same temporal date-range fill, same
`generateDateRange`/`groupDateByTimeUnit` helpers. The *only* structural
difference on this path is that **Line guards the fill block** (`if (xEncodings[0])`,
`LineChartTransformer.ts:86`) and **Area does not**. So the recommended repair for
Area is literally "match your own twin's guard."

### What the owner actually sees — sharper than "throw vs empty"

The throw does **not** crash the app unhandled. `DataTransformationPipeline.transform`
(`DataTransformationPipeline.ts:127-181`) wraps the per-type dispatch in a
`try/catch`; on a throw it returns
`{ type: 'area', data: null, error: <message> }` (`:175-181`). So the
**owner-visible** difference is:

- **Area today (throw):** the pipeline catches the `TypeError` and surfaces an
  **error-state render** — `data: null` + an error string ("Cannot read
  properties of undefined…"). The chart area shows an error / no chart.
- **The five siblings (empty contract):** `data: []` flows through to the engine,
  which renders an **empty chart** (axes/frame, no series).

This case **is reachable**, not theoretical: `normalizeConfig`
(`DataTransformationPipeline.ts:37`) only normalizes `encoding.x` *if it exists* —
it does **not** synthesize one — so an area chart configured **before the user has
picked an X field** (a common authoring intermediate state, or a saved config
whose x field was later removed) passes a missing-x config straight through to
`AreaChartTransformer.transform` and hits the throw. The Bar/Line/Pie/Radar/
Scatter equivalents of that same half-configured state render an empty chart.

### Why a decision, not a blind fix

- The throw is **explicitly locked** as `KNOWN DEFECT` characterization
  (`:84/:90`, `toThrow(TypeError)`). Flipping it is a deliberate re-bless of a
  pinned test, not a silent change — the house posture (ADR 0025 / 0030 / 0032 /
  0033 / 0035) is that locked behavior changes consciously, in the same commit
  that flips the assertion.
- The repair changes **owner-visible** render output for a half-configured area
  chart (error message vs empty chart). `tsc`/`jest`/`build` can prove the
  transform now returns the empty contract, but **which presentation is correct**
  (a leading "pick an X field" error vs a silent empty frame) is a product call.
  (The eyes-on delta is tiny — see Consequences — but the choice itself is the
  owner's.)

## Decision

**Recommended: Option A — mirror the sibling guard.** Add an early-return of the
empty `AreaChartData` contract when there is no usable x encoding (`!xEncodings[0]?.field`),
so Area matches the dominant missing-encoding contract of its five siblings; then
flip the two `toThrow` assertions in the `KNOWN DEFECT` block to expect the empty
contract.

One-line why: five of six transformers (including Area's structural twin, Line)
already return the safe empty contract for a missing-x encoding; Area's lone throw
is a one-missing-`?.` divergence on a render-path that turns a half-configured
chart into an error message instead of an empty frame — uniformity + crash-removal
is the right end state, and it is the *exact* `KNOWN DEFECT`-flip posture of ADR
0033/0035 on this same subtree.

### Options

#### Option A — Mirror the sibling guard: Area returns the empty contract (RECOMMENDED)

- **Code:** at the top of `transform`, after computing `xEncodings`/`yEncodings`,
  add the sibling-style early return when no usable x field is present, e.g.

  ```ts
  if (!xEncodings[0]?.field) {
    return { data: [], series: [], xDomain: [], yExtent: [0, 0], stacked: false };
  }
  ```

  (placed alongside the existing empty-`rawData` early-return at `:91-93`).
  Equivalently — and even closer to the twin — wrap the main-body fill blocks in
  `if (xEncodings[0]) { … }` the way `LineChartTransformer.ts:86` does, which also
  removes the throw. Either is a guard, not a logic change; the implementing
  session picks the smaller, more sibling-consistent diff. (The early-return is
  preferred: it also short-circuits the now-pointless per-branch work and matches
  Bar/Radar/Pie's explicit-empty shape, not just Line's skip-the-fill shape.)
- **Tests:** flip the two `toThrow(TypeError)` assertions in the
  `"KNOWN DEFECT: throws on missing x encoding"` block (`AreaChartTransformer.test.ts:84,90`)
  to assert the empty contract (`out.data === []`, `out.yExtent === [0,0]`,
  etc.), matching the already-present safe-case assertions at `:52/:58`. Optionally
  rename the describe from `KNOWN DEFECT` to the empty/guard-contract group.
- **Pros:** removes a render-path crash; gives all six transformers **one uniform
  missing-encoding contract** (empty result), so a half-configured chart renders an
  empty frame regardless of chart type instead of Area uniquely surfacing a
  `TypeError` string; the change is a single guard that matches Area's own twin
  (Line) and the dominant sibling shape (Bar/Radar/Pie); fully offline-provable.
- **Cons:** flips two locked characterization assertions (by design); the
  half-configured area chart now renders empty instead of showing an error message
  — if the owner *wants* a loud "pick an X field" signal there, that is Option B's
  territory (but the empty frame is what every other chart type already does, so A
  is the consistency-preserving pick).

#### Option B — Make the contract loud everywhere: ALL six transformers throw on missing-x

Keep Area's throw and change the **five siblings** to also throw on a missing-x
encoding (a deliberate loud-fail contract: a chart asked to render with no X field
is a configuration error, surfaced as such).

- **Pros:** also uniform, in the opposite direction — a missing-x chart always
  surfaces an error rather than a silent empty frame, which is arguably more honest
  about a misconfiguration.
- **Cons:** much larger blast radius — it changes **five** transformers (and their
  characterization tests, which currently pin the empty contract) plus the
  owner-visible output of Bar/Line/Pie/Radar/Scatter, turning today's empty
  half-configured charts into error states across the board. It optimizes for the
  rarer case (a chart that *should* error) at the cost of the common case (a chart
  mid-authoring), and it is the minority of the current behavior (1 of 6), so it
  inverts five working contracts to match one defect. Only choose this if the owner
  affirmatively wants every not-yet-configured chart to read as an error.

#### Option C — Keep as-is; document the divergence

Leave Area throwing; add a contract comment on `:154` ("`xEncodings[0]` may be
`undefined` when no x encoding is configured; this throws and is caught by
`DataTransformationPipeline`'s try/catch, surfacing an error-state render — by
design, see ADR 0038") and on the `KNOWN DEFECT` test block.

- **Pros:** zero behavior change; no test flip; documents that the throw is
  caught (so it is an error render, not a crash) and consciously accepted.
- **Cons:** preserves the inconsistency (Area alone differs from its five
  siblings) and the latent foot-gun (the `:154` guard gap is one refactor away
  from being copied or from escaping the try/catch if a future caller invokes the
  transformer directly without the pipeline wrapper). Documents the hazard instead
  of removing a one-line crash. Acceptable only if the owner judges the
  error-state render *preferable* for a half-configured area chart and is willing
  to keep the divergence.

### Ruled out

- **Blind autonomous adoption of Option A** (the autonomous loop's default-deny
  here): the empty-vs-throw choice is **owner-visible** render output and the
  characterization **deliberately pins the throw** as `KNOWN DEFECT`. Flipping a
  locked assertion + changing what a half-configured chart shows is a conscious
  product call, so it is routed as a decision, not a silent build — even though the
  fix itself is a one-line guard once the direction is picked.
- **A default-OFF flag spike.** Not warranted. The change is a 1-line guard on
  pure, offline-provable transform logic with **no** security/authority/`innerHTML`
  sink, and the throw is already contained by the pipeline try/catch — so there is
  nothing a runtime flag de-risks that the characterization-test flip + a single
  eyes-on chart check do not already cover. This matches the no-flag posture of ADR
  0025/0030/0032/0033/0035 for offline-provable logic with at most one eyes-on
  delta. (The flag mechanism is reserved for changes gates *cannot* prove — e.g.
  the frame-execution sinks of ADR 0018/0022/0026.)
- **Guarding only `:154` without flipping the locked tests.** Incoherent — silently
  making the pinned `toThrow` tests fail is exactly the "blind flip of a locked
  characterization" the house posture forbids. A guard and its re-blessed
  assertion ship together (Option A) or not at all (Option C).

## Consequences

- **If A (recommended):** `AreaChartTransformer.transform` returns the empty
  `AreaChartData` contract for a missing-x encoding, matching all five siblings;
  the render-path `TypeError` is removed; a half-configured area chart renders an
  empty frame (like every other chart type) instead of an error string. The two
  `KNOWN DEFECT` `toThrow` assertions are **deliberately flipped** to the empty
  contract in the **same commit**; the other 16 characterization tests stay green.
  Gates (tsc/jest/build) must stay green. **One small eyes-on-vault check**
  settles the visible delta: open an area chart with **no X field selected** (or
  remove the X field from an existing one) — it should now show an empty
  chart/frame rather than an error message; a fully-configured area chart must be
  byte-for-byte unchanged.
- **If B:** five transformers + their characterization tests change to throw on
  missing-x; every chart type surfaces an error (not an empty frame) when its X
  field is absent — a broad owner-visible shift requiring an eyes-on pass across
  all six chart types.
- **If C:** nothing changes; the divergence + the unguarded `:154` are documented
  as accepted, the `KNOWN DEFECT` block stays green as-is, and the bead closes as
  "known + accepted."

`AreaChartTransformer.ts` and the locked `AreaChartTransformer.test.ts` assertions
are **untouched** until the owner picks.

## Relationship to the sibling Visualization ADRs (same subtree)

- **ADR 0033** (`intelligentCompare` non-transitivity), **ADR 0035**
  (`inferEncodingType` numeric→temporal), and **ADR 0037** (`DataTransformationPipeline`
  purity + `validateConfig` guard) are the other open decisions on this same
  Visualization data path. This ADR is the **robustness/uniformity** decision on
  one transformer's missing-encoding contract; they are independent picks
  (different files/surfaces) sharing the house posture: surprising behavior is
  locked as characterization and any change is a conscious flip re-blessed in the
  same commit.
- The empty-vs-throw question is the **same fail-soft-vs-fail-loud family** as ADR
  0032(b) (malformed date → fail-closed/invisible) and ADR 0034 (`filterReturnForCol`
  unknown fn → fail-open). Here the recommendation is **fail-soft** (return the
  empty contract) — consistent with the dominant five siblings and with "a
  half-configured view should degrade gracefully, not crash the render path."
- Note: ADR 0035's mention of `AreaChartTransformer` is an **unrelated** sibling
  citation (it lists Area among the transformers fed by `ensureCorrectEncodingType`)
  — it is **not** about this missing-x throw. This ADR is the first to own the
  missing-x-encoding contract.

## The one decision the owner needs to make

**Pick A, B, or C.** Recommended **A**: add the sibling-style guard so
`AreaChartTransformer` returns the empty `AreaChartData` contract for a missing-x
encoding (matching its five siblings, including its twin Line), and flip the two
locked `KNOWN DEFECT` `toThrow` assertions to expect the empty contract — settled
with one eyes-on check that a no-X-field area chart now renders empty (not an error)
and a fully-configured one is unchanged. If you instead want a **loud** contract —
every chart type erroring when its X field is absent — pick **B** (change all five
siblings to throw too). If you prefer the half-configured area chart to keep
surfacing an error message and accept the divergence, pick **C** (document, change
nothing).
