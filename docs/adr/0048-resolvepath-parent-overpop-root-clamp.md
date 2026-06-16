# ADR 0048: `resolvePath('../…')` over-pop past root — explicit root clamp vs. keep+document the graceful degradation

## Status

Accepted.

Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c). Resolved
to **Option B (recommended)** — keep the current graceful behavior and name the
contract; no behavior change. `path.ts` and the locked test comments were
upgraded to ratify the over-pop graceful root-clamp as the defined contract; no
assertion values were flipped. Option A (explicit `if (sourceParts.length > 0)`
guard) remains an available readability-only follow-up.

Tracked by bd `Notidian-ircw` (the fix follow-up to
the characterization landed by `Notidian-iuiw`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blindly editing `path.ts`**: the bead explicitly frames it
as a **behavior question** ("this is a behavior change, so characterize-then-decide
rather than fix blind"), and there are **LOCKED characterization assertions** in
`resolvePath.test.ts` (the over-pop block at `:264-289` and the
"`../` never produces a leading-slash dup" property at `:355-365`) that must be
**deliberately re-blessed** as part of any fix — that is a decision posture, not a
blind edit (same pattern as ADR 0025 / 0030 / 0033 / 0042, where pinned
characterization assertions are flipped only by a reviewed decision). **LOW
present-risk:** the current degradation is **graceful and property-safe** — it
never throws, never emits a leading `/` or `//` duplication, and the bare-leaf
output it produces is *already equal* to what a POSIX `path.resolve` would yield
(minus the leading slash the repo invariant forbids). **No code or test change is
made on this route** — the bead stays OPEN awaiting the owner's pick, and the
locked assertions are **not** flipped until then.

## Date

2026-06-16

## Context

### The defect, exactly

`src/core/superstate/utils/path.ts:31-40` (the `'../'` branch):

```ts
} else if (path.indexOf('../') == 0 && source) {
    const sourceParts = source.split('/');
    const pathParts = path.split('/');
    sourceParts.pop();                 // drop the source's own leaf
    while (pathParts[0] === '..') {
        sourceParts.pop();             // <-- keeps popping after the array is empty
        pathParts.shift();
    }
    return [...sourceParts, ...pathParts].join('/');
}
```

When the number of `..` segments **exceeds the source depth**, the `while` loop
keeps calling `sourceParts.pop()` on an **already-empty** array.
`Array.prototype.pop()` on `[]` returns `undefined` with **no throw and no
mutation**, so the loop simply spins down `pathParts` without ever clamping at
root. The observable results (pinned at `resolvePath.test.ts:273-289`):

- `resolvePath('../../../a.md', 'A/B.md', noSpace)` → **`'a.md'`** (rootless: pop
  the leaf `B.md` → `['A']`; the first `..` pops `A` → `[]`; the next two `..`
  pop `undefined` twice, array stays `[]` → `[] + ['a.md']` → `'a.md'`).
- `resolvePath('../a.md', 'B.md', noSpace)` and
  `resolvePath('../../a.md', 'B.md', noSpace)` → **`'a.md'`** (bare leaf).
- `resolvePath('../../', 'A/B.md', noSpace)` → **`''`** (when `..` consumes the
  *whole* path: `['..','..','']` → both `..` shift out → `['']`; sourceParts
  drained to `[]` → `[''].join('/')` → `''`). Likewise
  `resolvePath('../../..', 'A/B/C/D.md', noSpace)` → `''`.

This was **characterized (not fixed)** by `Notidian-iuiw` and locked at
`resolvePath.test.ts:264-289`, plus a property at `:355-365` that asserts the
**key invariant the degradation respects**: over-popping **never** produces a
leading `/` nor a `//` duplication. So today's behavior is *graceful* (no crash,
no slash artifact) but it does **not** clamp at root the way a POSIX-style
resolver does.

### What "POSIX intuition" actually means here (sharpens A vs. B)

The bead calls Option A "closest to POSIX/`path.resolve` intuition." That is true
but worth pinning precisely, because Node's two relevant primitives **disagree**:

```text
path.posix.resolve('/A', '../../../a.md')   === '/a.md'        // clamps at root
path.posix.normalize('A/../../../a.md')     === '../../a.md'   // keeps leftover ..
path.posix.join('A', '../../../a.md')       === '../../a.md'   // keeps leftover ..
```

`path.resolve` operates against an **absolute root** and **clamps** over-pop to
`/a.md`. `normalize`/`join` operate on a **relative** base and **preserve** the
leftover `..` segments. Notidian's vault paths are root-relative *without* a
leading slash, and the repo-wide invariant (enforced by the property test and the
`'./'`-resolution fix in `Notidian-2i5k`) is that resolved paths **never carry a
leading `/`**. Under that invariant, `path.resolve`'s `/a.md` minus its mandatory
leading slash is **exactly `a.md`** — i.e. **the current over-pop output already
equals `path.resolve`'s clamped result for the bare-leaf case.** The current code
is *accidentally* root-clamping (an empty array can't pop further, so extra `..`
are absorbed), not `..`-preserving like `normalize`. So:

- For the common over-pop case (`'../../../a.md'`), **Option A and the current
  behavior return the same string** (`'a.md'`). The difference is whether that is
  a **defined contract** (A) or an **emergent accident** (current/B).
- The **only** input where A and B's *outputs* genuinely diverge is the
  **path-consuming collapse** (`'../../'`, `'../../..'`) that currently returns
  **`''`** — a clamped resolver would instead return the cleaned remainder
  (root, i.e. `''` for a pure `..` walk with no tail too — so even here a careful
  clamp lands on `''`). In practice the outputs are near-identical; what is really
  on the table is **a defined contract + an explicit guard**, not a different
  set of resolved keys.

### `resolvePath` is an identity-critical lookup-key primitive

`resolvePath` (the **only** pure export of `path.ts`) turns a link/relation target
(`'./x'`, `'../x'`, `'x|Alias'`, `'http…'`) plus a *source* path into a concrete
vault path that is then used **directly as a lookup KEY** into
`pathsIndex`/`spacesIndex`. Markdown file paths own row identity and default
titles (ADR 0014 / ADR 0016), so a wrong resolution silently re-points a link or
relation at the **wrong row — or no row** — without throwing. ~56 non-test call
sites consume the result (verified by repo grep): `linkContextRow.ts` (6 sites),
`relationResolver.ts`, `context.ts`, `tableRowTree.ts`, `api.ts`,
`ContextEditorContext.tsx`, the Frame `EditorNodes` (`Flow`/`View`/`Context`
node views), `PathCrumb`, `LinkCell`/`ContextCell`, etc.

### How the over-pop result is consumed (this is why present-risk is LOW)

Almost every production caller routes through the **`spaceManager.resolvePath`
wrapper** (`src/core/spaceManager/spaceManager.ts:115-120`):

```ts
public resolvePath(path: string, source?: string) {
  const resolvedPath = resolvePath(path, source, (p) => this.superstate.spacesIndex.has(p));
  if (resolvedPath !== path) return resolvedPath;        // (1) over-pop changed it -> return as-is
  if (this.superstate.pathsIndex.has(path)) return path; // (2) only reached if unchanged
  return this.primarySpaceAdapter.resolvePath(path, source) ?? path; // (3) Obsidian link index fallback
}
```

For an over-pop input the pure resolver **changes** the string (`'../../../a.md'`
→ `'a.md'`), so branch **(1)** fires and the wrapper returns the bare-leaf
**immediately** — it does **not** re-check `pathsIndex` or fall back to Obsidian's
link index. The bare-leaf key is then looked up downstream:

- **Relations** (`relationResolver.ts:22-25`,
  `makeRelationLinkResolver = … superstate.spaceManager.resolvePath(link, sourcePath) ?? link`):
  the resolved key is matched against `pathsIndex`. A malformed over-pop link that
  resolves to a non-existent `'a.md'` simply **fails to match** and stays a stable,
  non-matching key — the same "dangling link stays a stable non-matching key"
  contract that resolver was *designed* for (its own header comment). It does
  **not** crash or collapse to a different real row unless a real top-level
  `a.md` happens to exist.
- The **`''` collapse** edge: `resolvePath('../../', src)` → `''`. In the wrapper,
  `'' !== '../../'` so branch (1) returns `''`; in `uriByString`
  (`spaceManager.ts:121-129`) `if (!uri) return null` treats it as no-link;
  `makeRelationLinkResolver` returns `'' ?? link` → `''` (not nullish), a benign
  empty key that matches no row. No crash, no mis-route to a real row.

So the present hazard is **latent and benign**: over-pop requires a **malformed
link** (more `../` than the source has depth) to even reach this path, and when it
does, the result is a non-matching/empty key, not a silent re-point to the wrong
real row (the bare leaf would only collide if a genuine top-level file of that
name exists — a narrow, malformed-input-gated coincidence).

### Why this is a decision, not a blind one-liner

1. **It is a behavior change to a 56-caller identity primitive.** Even though A's
   *output* equals the current output for the common case, defining the contract
   (and changing the `''`-collapse edge's *meaning*) touches a primitive whose
   wrong answer silently re-points row identity. That warrants a reviewed,
   ratified change — not a quiet edit.
2. **Locked characterization assertions must be re-blessed.** Flipping the
   over-pop block (`:273-289`) and re-blessing the leading-slash property
   (`:355-365`) is a deliberate behavior decision the owner should ratify —
   exactly the posture ADR 0025 / 0030 / 0033 / 0042 take for their pinned
   assertions.
3. **The benefit is real-but-low-value and the risk is asymmetric.** A clamp's
   only behavioral payoff is making an *already-graceful* edge a *defined* edge;
   its risk is silently re-pointing a malformed link to a (real) root file vs.
   today's "drops to a non-matching key." For an edge that needs malformed input
   to reach, that trade is not obviously worth a semantic change to the identity
   primitive.

## Decision drivers

- **Protect the identity primitive** — `resolvePath` keys row identity for ~56
  callers; changes must be deliberate and reviewed, never emergent.
- **Honor the no-leading-slash invariant** — whatever the contract, it must keep
  the property the suite locks (no leading `/`, no `//`).
- **Match least-surprise where it is cheap** — a defined root-clamp contract reads
  as more principled than "an empty array can't pop further."
- **Weigh benefit vs. blast radius honestly** — the benefit is contract clarity on
  a malformed-input edge; the cost is re-blessing locked tests + auditing whether
  any caller leans on today's exact bare-leaf/`''` output.
- **Avoid over-engineering a pure offline question** — this is deterministic string
  logic with no render/authority/`innerHTML`/eyes-on surface; a runtime flag buys
  nothing.

## Options

### Option A — clamp at root (stop popping when `sourceParts` is empty)

Make the root-clamp **explicit and intentional** rather than an accident of
`pop()`-on-`[]`:

```ts
} else if (path.indexOf('../') == 0 && source) {
    const sourceParts = source.split('/');
    const pathParts = path.split('/');
    sourceParts.pop();                       // drop the source's own leaf
    while (pathParts[0] === '..') {
        if (sourceParts.length > 0) sourceParts.pop(); // clamp: don't pop past root
        pathParts.shift();
    }
    return [...sourceParts, ...pathParts].join('/');
}
```

Then **flip the locked over-pop assertions** (`resolvePath.test.ts:273-289`) to
the clamped contract and re-bless the leading-slash property (`:355-365`) with a
comment citing this ADR + `Notidian-ircw`. Note: for the bare-leaf case the
asserted **values do not change** (`'../../../a.md'` over `'A/B.md'` is still
`'a.md'`) — what changes is the **comment/intent** (deliberate clamp, not
over-pop accident) and, for the `''`-collapse cases, the contract is now "clamp to
root remainder" rather than "drained array + empty pathPart."

- **Pros:** makes the resolver's over-pop behavior a **defined contract** that
  matches `path.resolve`'s absolute-root clamp (the most principled mental model
  for "resolve against the vault root"); removes the subtle reliance on
  `pop()`-on-`[]` being a silent no-op (a reader-trap and a latent footgun if the
  surrounding code is ever refactored to assert on array length); keeps the
  no-leading-slash invariant intact (the clamp can never under/overflow into a
  slash artifact). Low diff.
- **Cons:** it is a **behavior change to a 56-caller identity primitive** for an
  edge that needs **malformed input** (over-many `../`) to reach — the benefit is
  contract clarity, not a fixed live bug (the current output already equals
  `path.resolve`'s for the common case). It introduces an **asymmetric risk**: a
  malformed over-pop link now deterministically resolves to a **root-relative
  leaf** (`'a.md'`), which **silently matches a real top-level `a.md` if one
  exists** — arguably *worse* than today's "stays a non-matching key" for a link
  the author clearly malformed. Requires re-blessing locked assertions and an
  audit that no caller depends on today's exact `''`-collapse string.

### Option B (recommended) — keep the current graceful behavior + document the invariant

Make **no code change.** Instead, ratify today's behavior as the intended contract:
upgrade the over-pop block's comment in `path.ts` (and the locked test comments) to
state explicitly that **over-pop degrades gracefully to a rootless leaf and never
emits a leading-slash artifact**, that this is *equivalent to `path.resolve`'s
clamp under the no-leading-slash invariant*, and that **over-pop only arises from
malformed links** (more `../` than the source's depth). Keep the locked
characterization assertions exactly as the ratified contract.

- **Pros:** **zero behavior change** to a 56-caller identity primitive; the
  degradation is **already graceful and property-safe** (no crash, no leading
  `/`/`//`), and its bare-leaf output **already equals** `path.resolve`'s clamped
  result for the common case — so there is **no defect to fix**, only a contract to
  name. **No caller is shown to be harmed** (the wrapper returns the bare-leaf as a
  non-matching key; relations were *designed* to keep a dangling link as a stable
  non-matching key). **No locked assertion is flipped**, so no review-debt
  re-bless. It explicitly **avoids the asymmetric risk** of A (a malformed link
  deterministically re-pointing to a real root file). Cheapest correct posture for
  an edge that needs malformed input to reach.
- **Cons:** the root-clamp stays an **emergent property** of `pop()`-on-`[]`
  rather than an explicit guard — a future refactor that, say, asserts
  `sourceParts.length` invariants could reintroduce a sharp edge (mitigated by the
  locked property test + the upgraded comment). Leaves the `''`-collapse edge as a
  slightly unusual "empty path" output (benign — treated as no-link everywhere it
  flows).

### Option C — clamp behind a default-OFF flag

Ship the Option A clamp gated by a settings flag (default OFF), flip the locked
tests only under the flag.

- **Pros:** lets the owner toggle the new contract without committing.
- **Cons (decisive):** **over-engineers a pure, offline, deterministic string
  question.** A runtime flag de-risks a behavior whose *correctness is in question*
  or whose effect needs **eyes-on-vault** to judge; here the behavior is fully
  jest-provable, has no render/authority/`innerHTML` surface, and the two outcomes
  (A vs. B) are *already* characterized and near-identical. A flag adds settings
  surface, a branch in an identity-hot primitive, and a doubled test matrix for
  **zero** measurement payoff — the open question is a one-time **contract pick**
  (A or B), not a runtime A/B. Same no-flag posture as ADR 0032 / 0033 / 0034 /
  0036 / 0039 / 0042 for pure offline logic. **Discouraged / rejected.**

## Recommendation

**Option B — keep the current graceful behavior and document the invariant (no
code change).** One line of why: the over-pop degradation is **already graceful
and property-safe** (never a leading-slash artifact, output already equal to
`path.resolve`'s clamp for the common case), **no caller is shown to be harmed**
(the wrapper hands back a non-matching/empty key, which is precisely the
dangling-link contract the relation resolver was built around), and **Option A is
a real-but-low-value semantic change to a 56-caller identity primitive** whose
asymmetric risk (silently re-pointing a *malformed* link to a real root file vs.
today's "drops to a non-matching key") **outweighs the benefit** for an edge that
**needs malformed input to reach** — so name the contract instead of changing it.

If the owner later wants the explicit guard for code-readability reasons (a fair
preference — A removes the `pop()`-on-`[]` reader-trap), Option A is a clean,
low-diff follow-up; it is **not wrong**, just low-value-and-slightly-riskier than
naming the existing contract. The recommendation is the **resting posture**, not a
veto on A.

### Ruled out

- **Option C (default-OFF flag)** — over-engineers a pure, offline, deterministic
  string question with no eyes-on/render/authority surface; a flag adds settings +
  branch + a doubled test matrix for zero measurement payoff. The open question is
  a one-time contract pick, not a runtime A/B. (Same posture as ADR
  0032/0033/0034/0036/0039/0042.)
- **A `normalize`/`join`-style contract (preserve leftover `..`)** — i.e. make
  over-pop return `'../../a.md'` like `path.posix.normalize`. Rejected: it would
  emit a path with a **leading `..`**, which is neither a valid vault key nor
  consistent with the no-leading-slash root-relative model; the vault has **no
  parent of root**, so preserving `..` is meaningless here. The clamp model
  (`path.resolve`) is the only coherent one for a rooted vault. (Considered and
  rejected as a sub-variant.)
- **Editing `path.ts` or flipping the locked assertions now (a blind build)** — the
  contract (clamp-explicit vs. keep-as-graceful) and the re-blessing of pinned
  characterization assertions on a 56-caller identity primitive are owner calls;
  hence an ADR, with the bead OPEN.

## Consequences

If the owner picks **B (recommended):** the implementing session makes **no
behavior change** — it upgrades the over-pop comment in `path.ts:31-40` and the
locked test comments (`resolvePath.test.ts:264-289`, `:355-365`) to **name** the
contract (graceful root-equivalent clamp, no leading-slash artifact, arises only
from malformed links, equivalent to `path.resolve` under the no-leading-slash
invariant), optionally adds a `bd remember` that A is an available
readability-only follow-up, and closes `Notidian-ircw`. **No assertion values are
flipped.**

If the owner picks **A:** the implementing session adds the
`if (sourceParts.length > 0) sourceParts.pop();` guard at `path.ts:36`, re-blesses
the over-pop block and the leading-slash property with comments citing this ADR +
`Notidian-ircw` (the bare-leaf *values* are unchanged; the `''`-collapse cases are
re-blessed as "clamp to root remainder"), runs a quick grep-audit confirming no
caller depends on the exact `''`-collapse output, and closes `Notidian-ircw`.

Everything is pure, offline-provable string logic (no render / authority /
`innerHTML` surface), so the gate is **jest** (`npm test`) + a green
`npm run verify:source` — **no eyes-on-vault step and no default-OFF flag.** Until
a pick, **no `path.ts` or `resolvePath.test.ts` change is made** and the locked
assertions are **not** flipped.
