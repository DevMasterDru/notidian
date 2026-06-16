# ADR 0037: `DataTransformationPipeline.normalizeConfig` impurity (mutates caller `config.encoding`) + `validateConfig` throws on undefined `encoding`

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

Tracked by bd `Notidian-jko` (the two surprises were
discovered + LOCKED as characterization by the orchestrator net `Notidian-34e`,
`DataTransformationPipeline.test.ts`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blind-fixing either surprise.** Both live on the
Visualization data path (`src/core/react/components/Visualization/DataTransformationPipeline.ts`)
and one of them — the `normalizeConfig` impurity — turned out to be **load-bearing
for the live D3 render path**, not a cosmetic foot-gun, so a naive "make it pure"
fix would silently break charts. That is exactly the downstream-identity risk the
bead flagged, now confirmed concrete (see "The decisive finding" below).

## Date

2026-06-15

## Context

`DataTransformationPipeline` (the static, DOM-free orchestrator of the whole viz
data path) carries two surprises that `Notidian-34e` characterized and
**deliberately locked** so any change must consciously re-bless them:

### Surprise 1 — `normalizeConfig` is NOT pure (mutates the caller's `encoding`)

`normalizeConfig` (`DataTransformationPipeline.ts:29-97`) opens with a **shallow**
copy:

```ts
const normalizedConfig = { ...config };
```

so `normalizedConfig.encoding` **is** `config.encoding` (same reference). It then
writes the auto-detected encodings back onto that shared object:

```ts
normalizedConfig.encoding.x = Array.isArray(normalizedConfig.encoding.x) ? normalizedXEncodings : normalizedXEncodings[0];
// ...same for .y, .color, .size
```

Because `encoding` is shared, those assignments **mutate the caller's original
`config.encoding` in place** — `out.encoding === config.encoding`, and a
previously type-less `config.encoding.x[0].type` flips from `undefined` to the
inferred type. `transform()` (`:102-182`) inherits this, since it calls
`normalizeConfig` on the caller's `config`. (Note: `ensureCorrectEncodingType`,
`inferEncodingType.ts:75`, is itself non-mutating — it returns `{ ...encoding }`.
The mutation is the **assignment back** onto the shared `encoding`, not the
inference.)

This is **locked** in `DataTransformationPipeline.test.ts`:

- `:211-227` — `normalizeConfig` "MUTATES the caller's shared encoding object";
  asserts `out.encoding === original.encoding` (**same reference**) and
  `encOf(original,"x").type === "nominal"` (**original mutated**).
- `:419-424` — `transform` inherits it: after `transform([...], config)`,
  `encOf(config,"x").type === "nominal"`.
- `:201-208` — idempotency: re-running on an already-normalized config yields an
  **equal** encoding (so the mutation is at least convergent, not divergent).

### The decisive finding — the mutation is **load-bearing in `D3VisualizationEngine`**

The bead's working hypothesis was that deep-cloning the encoding is
"behavior-preserving for output." That is true for the **`transform()` return
value**, but **false for the live render path**, and this is the crux of the
decision.

`D3VisualizationEngine.tsx` runs two sibling `useMemo`s that both read the
**same `config` object**:

1. `transformedData` (`:100-104`) — calls `transform(data, config, …)`, which
   calls `normalizeConfig`, which **mutates `config.encoding.*.type`** as a
   side-effect.
2. `scales` (`:133-456`) — reads `config.encoding.x/.y/.color/.size` **directly**
   to build the D3 scales, and `switch`es on `primaryEncoding.type`.

Whether `scales` re-derives the type or relies on the mutation differs by axis and
chart type:

| read site | re-derives `type` locally? | depends on the mutation? |
| --- | --- | --- |
| X scale (`:178-181`) | **yes**, for `scatter`/`line`/`bar`/`area` (re-calls `ensureCorrectEncodingType`) | only for `pie`/`radar` (no re-derive; switches on `config.encoding.x[0].type` at `:183`) |
| Y scale (`:326-330`, `:342`) | **only** for `scatter` | **yes** for `bar`/`line`/`area`/`pie`/`radar` — switches on `config.encoding.y[0].type` at `:342` with no re-derive |
| color (`:415`), size (`:443`) | n/a — gated on `.field`, not `.type` | no |

So for a **bar/line/area** Y axis (and X/Y for **pie/radar**) with a type-less
encoding, the **only** thing that populates `config.encoding.y[0].type` before the
`scales` memo reads it is the in-place mutation performed by the `transformedData`
memo. Empirically verified (Node, 2026-06-15, isolating the mutation mechanism and
both engine read paths):

- **Current (shallow copy / mutating):** `out.encoding === original.encoding` is
  `true`; `original.encoding.y.type` becomes `quantitative`; the `scales` Y switch
  hits `case "quantitative"` → a linear Y scale is built. Chart renders correctly.
- **With a deep-clone in `normalizeConfig` (and no other change):**
  `out.encoding.y.type` is `quantitative` (the transform **output** is correct),
  but `original.encoding.y.type` stays **`undefined`**. The `scales` Y switch
  (`:342`) falls through **all** of `quantitative`/`ordinal`/`nominal`/`temporal`
  → **no Y scale is set** → the bar/line/area chart loses its Y axis. Same for the
  pie/radar X path.

This is precisely the "could change downstream identity assumptions in
D3VisualizationEngine" the bead warned about, confirmed real. The render path is
**relying on the side-effect** (the two memos communicate the inferred types
through the shared `config.encoding` object), so making `normalizeConfig` pure is
**not** a no-op — it requires the engine to be made self-sufficient (re-derive the
Y/color and pie/radar-X types locally, the way the X path already does for the
other four chart types) in the **same** change.

### Surprise 2 — `validateConfig` throws on `encoding === undefined`

`validateConfig` (`:248-323`) dereferences `config.encoding.x` (`:265`) with no
guard, so it **throws** `Cannot read properties of undefined` on a config whose
`encoding` is `undefined`. Locked in `DataTransformationPipeline.test.ts:807-815`
("THROWS when config.encoding is undefined (no guard) — internal-contract gap").

Crucially, **`validateConfig` has ZERO production callers** (full-repo grep:
definition + its own tests only; the live engine path is `transform` →
`applyRenderingTransformations`, `D3VisualizationEngine.tsx:101-103`). So today the
throw is unreachable in the running app — it is a latent robustness gap in a
public-but-unused method, not an observable chart bug. (`config.encoding === {}`
is already handled gracefully — `:682-690` — only fully-`undefined` `encoding`
throws.) This surprise is **independent** of Surprise 1: it does not touch
`normalizeConfig`, the shared-`encoding` aliasing, or the render path.

### Why a decision, not a blind fix

- The `normalizeConfig` impurity is **locked by identity** —
  `out.encoding === original.encoding` is an explicit characterization assertion
  (`:224`). Flipping it changes a render-path contract two `useMemo`s silently
  rely on; getting it wrong renders charts with no Y axis. `tsc`/`jest`/`build`
  prove the unit output but **cannot** prove the live D3 render is unbroken
  (the engine has no offline render coverage), so the all-charts-still-render
  check is an **eyes-on-vault** step.
- `validateConfig`'s throw is locked too (`:813`), and "should an unused public
  method throw or fail-soft" is a small contract call (same family as the
  fail-open/fail-closed predicate decisions in ADR 0032/0034) — cheap, but worth
  a conscious pick rather than a silent flip of a locked test.

## Decision

**Recommended: Option A — clone the encoding subtree to make `normalizeConfig`
pure AND make `D3VisualizationEngine` self-sufficient for the read sites that
currently rely on the mutation, in the same change; plus add the `validateConfig`
early-guard.** Flip the locked identity/throw assertions accordingly.

One-line why: in-place mutation of the caller's config across two `useMemo`s is a
genuine foot-gun (a config reused/compared across renders gets surprise-mutated,
and the two memos are silently coupled through a shared object), and purity is the
correct end state — but it is **only safe if the engine stops depending on the
side-effect**, so the recommendation is the *paired* change, not the clone alone.
The `validateConfig` guard is unconditional cheap hardening with no live caller to
disturb. This is the same "make it correct + re-bless the locked tests in the same
commit" posture as ADR 0025/0030/0033.

### Options

#### Option A — Clone in `normalizeConfig` + make the engine self-sufficient + guard `validateConfig` (RECOMMENDED)

- **`normalizeConfig`:** deep-copy the `encoding` subtree before writing inferred
  types (`const normalizedConfig = { ...config, encoding: structuredClone(config.encoding) }`,
  or a shallow-but-sufficient clone of `encoding` + each of `x`/`y`/`color`/`size`,
  whichever the implementing session proves minimal). Output is unchanged; the
  caller's `config` is no longer mutated; `out.encoding !== original.encoding`.
- **`D3VisualizationEngine`:** make the read sites that currently rely on the
  mutation derive the type themselves — re-call `ensureCorrectEncodingType` in the
  **Y** path for **all** chart types (today only `scatter`, `:326-330`) and in the
  **X** path for `pie`/`radar` (today only `scatter`/`line`/`bar`/`area`,
  `:178-181`). This is the pattern the X path *already* uses; extending it makes
  the `scales` memo independent of whether `transform` mutated `config`. (Cleaner
  alternative the session may prefer: feed the **normalized** config into the
  `scales` memo instead of re-deriving — but `transformedData` currently returns
  only `TransformedData`, not the normalized config, so this needs `transform`/the
  memo to also surface `normalizedConfig`; either is acceptable, the session picks
  the smaller diff.)
- **`validateConfig`:** add an early guard returning
  `{ valid: false, errors: ['No encoding configured'], warnings: [] }` when
  `config.encoding` is `undefined`, mirroring the existing empty-`rawData`
  early-return (`:257-260`).
- **Tests:** flip `:224` (`out.encoding === original.encoding` → `!==`, and drop
  the "original mutated" assertion / assert original is **unchanged**), `:419-424`
  (transform no longer mutates the caller), and `:807-815` (no longer throws;
  returns the new `{valid:false,…}` shape).
- **Pros:** eliminates a real cross-`useMemo` coupling foot-gun; `normalizeConfig`
  becomes a true pure function (idempotent **and** side-effect-free), so reasoning
  about config identity across renders holds; the engine becomes robust to *any*
  config the memo order/upstream produces, not just the mutated one. The
  `validateConfig` guard removes a latent throw from a public method for free.
- **Cons:** it is **two coupled edits**, not one — the clone is unsafe without the
  engine change, so this is not the "trivial one-liner" the surface suggests. The
  engine change touches the live render path (no offline render test), so it needs
  an **eyes-on-vault confirm** that bar/line/area/pie/radar charts with type-less
  encodings still render their axes. Requires flipping three locked
  characterization assertions.

#### Option B — Leave both as-is; document the contracts (zero behavior change)

Keep the shallow copy and the un-guarded `validateConfig`; add contract comments:
(1) on `normalizeConfig` — "NOT pure: mutates `config.encoding` in place; the
`D3VisualizationEngine` `scales` memo **relies** on this to see inferred types —
do not clone without making the engine self-sufficient"; (2) on `validateConfig` —
"callers must pass a populated `encoding`; throws on `undefined`."

- **Pros:** zero render-path risk; the load-bearing mutation is documented as
  intentional rather than removed; no eyes-on step. Honest about the coupling.
- **Cons:** preserves a genuine foot-gun — a caller that reuses or compares a
  `config` across renders gets surprise-mutated, and two memos stay silently
  coupled through a shared object (fragile to a future memo reorder or a caller
  that memoizes `config`). The `validateConfig` throw stays a latent landmine for
  the day someone wires it up. Documents the hazards instead of removing them;
  acceptable only if the owner judges the coupling stable and the value method
  permanently unused.

#### Option C — Partial: clone XOR guard (pick only one)

- **C1 (guard only):** add the `validateConfig` early-guard but **leave**
  `normalizeConfig` mutating (and the engine as-is). Lowest-risk slice — the guard
  is independent of the render path and has no live caller, so it cannot regress a
  chart; flips only `:807-815`.
- **C2 (clone only, no engine change):** clone in `normalizeConfig` **without**
  making the engine self-sufficient. **Ruled out** — the decisive finding proves
  this breaks bar/line/area Y axes and pie/radar X axes (the `scales` memo reads
  `undefined` types). Listed only to record that the bead's "(c) clone but don't
  guard" sub-option is *unsafe* in this form; a safe clone **must** include the
  engine change (that is Option A).

- **Pros (C1):** ships the uncontroversial half now with no eyes-on step; defers
  the load-bearing purity call. A reasonable middle if the owner wants the throw
  removed but isn't ready to touch the render path.
- **Cons:** C1 leaves the impurity (the larger foot-gun) unaddressed; C2 is unsafe
  and not a real option.

### Ruled out

- **A blind autonomous fix** (the autonomous loop's default-deny here): the
  `out.encoding === original.encoding` identity is a **LOCKED** characterization
  assertion, and the decisive finding shows the render path *depends* on the
  mutation it encodes — flipping it without the paired engine change renders charts
  with no Y axis, and even the paired change needs an eyes-on confirm. So this is
  routed as a decision + an eyes-on-gated implement, never a silent build.
- **C2 (clone `normalizeConfig` without the engine change)** — empirically breaks
  the live render path (above). The bead's "(c) clone but don't guard" is therefore
  not a safe partial; a safe clone is Option A.
- **Deep-cloning the *entire* config** (not just `encoding`) — unnecessary scope;
  only `encoding` is written back, so cloning the whole config copies layout/mark/
  colorScheme/etc. for no benefit. The minimal clone is `encoding` + its
  `x`/`y`/`color`/`size` members.

## Consequences

- **If A (recommended):** `normalizeConfig` becomes pure (no caller mutation;
  `out.encoding !== original.encoding`); the `D3VisualizationEngine` `scales` memo
  re-derives Y types for all chart types and X types for pie/radar, so it no longer
  depends on the `transform` side-effect; `validateConfig` fail-softs on undefined
  `encoding`. The three locked assertions (`:224`, `:419-424`, `:807-815`) are
  **deliberately flipped in the same commit**; the idempotency, dispatch,
  try/catch, rendering, and all other validateConfig pins stay green. **One
  eyes-on-vault check** (open bar/line/area/pie/radar charts with type-less
  encodings; axes/scales must render exactly as before) settles the un-gate-able
  render half. Gates (tsc/jest/build) must stay green.
- **If B:** nothing changes; both surprises persist with explicit contract
  comments (including the load-bearing-mutation warning so a future hand doesn't
  clone it blind); the bead closes as "known + accepted."
- **If C1:** `validateConfig` fail-softs (flip `:807-815`); `normalizeConfig` and
  the engine are untouched (the impurity persists, documented); no eyes-on step.
  The purity half can be revisited later.

The `normalizeConfig`/engine half is **render-path-coupled** (the engine has no
offline render coverage), so the eyes-on-vault confirm is required for Option A —
but **no default-OFF flag is proposed**: the change is not a security/authority
sink and the coupling is fully understood and locally fixable, so the
characterization-test flip + a single eyes-on chart check is the right gate, not a
runtime flag (consistent with the no-flag posture of ADR 0025/0030/0032/0033/0035
for offline-provable-logic + one eyes-on delta). The `validateConfig` half (C1) is
fully offline-provable with no live caller and needs no eyes-on step at all.
`DataTransformationPipeline.ts`, `D3VisualizationEngine.tsx`, and the pinned
`DataTransformationPipeline.test.ts` assertions are **untouched** until the owner
picks.

## Relationship to the sibling Visualization ADRs (same subtree)

- **ADR 0035** (`inferEncodingType` numeric→temporal) and **ADR 0033**
  (`intelligentCompare` non-transitivity) are the *heuristic-quality* decisions on
  this same Visualization data path; this ADR is the *purity/robustness* decision
  on the orchestrator that *calls* `inferEncodingType` (via
  `ensureCorrectEncodingType`). They are independent picks (different files,
  different surfaces) but share the house posture: current surprising behavior is
  locked as characterization, and a change is a conscious flip re-blessed in the
  same commit.
- The `validateConfig` guard is the same fail-soft-vs-throw family as ADR 0032(b)
  / ADR 0034 — and resolves the same way (a malformed/absent input should
  fail-soft with a clear error, not crash), with the added simplifier that
  `validateConfig` has **no live caller**, so the guard cannot regress anything.

## The one decision the owner needs to make

**Pick A, B, or C1.** Recommended **A**: deep-clone the `encoding` subtree to make
`normalizeConfig` pure **and** make `D3VisualizationEngine` self-sufficient
(re-derive Y types for all chart types, X types for pie/radar) in the same change,
**and** add the `validateConfig` early-guard — flipping the three locked
assertions and confirming with one eyes-on chart check that all chart types still
render their axes. The load-bearing sub-call is that **a safe purity fix is the
*paired* change** (clone + engine), never the clone alone — option C2 (clone-only)
is empirically unsafe. If you prefer to take only the free, render-safe half now,
pick **C1** (guard `validateConfig`, leave the impurity documented). If you judge
the cross-memo coupling stable and the unused method's throw acceptable, pick **B**
(document both contracts, change nothing).
