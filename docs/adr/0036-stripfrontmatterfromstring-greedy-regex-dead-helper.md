# ADR 0036: `stripFrontmatterFromString` greedy/unanchored regex — fix, replace, or delete a dead helper

## Status

Accepted.

Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

Tracked by bd `Notidian-2zs`; queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of changing `fm.ts` blind**. `stripFrontmatterFromString`'s
regex `/---(.|\n)*---/` is greedy + unanchored and provably over-strips body
prose; its current behavior is **explicitly pinned as characterization** in
`src/adapters/obsidian/filetypes/frontmatter/fm.stripFrontmatterFromString.test.ts`
(Notidian-bey). A non-greedy/anchored rewrite **changes what is removed from a
note body** — but the load-bearing finding here is that **the function has zero
production callers**, so the real question is not "what should it strip" but
"should this helper exist at all." That is a deliberate scoping call, not pure
logic. The build stops here until the owner picks a direction; the pinned
characterization is **untouched** until then.

## Date

2026-06-15

## Context

### The code

`src/adapters/obsidian/filetypes/frontmatter/fm.ts:30`:

```ts
export const stripFrontmatterFromString = (string: string) => {
  return string.replace(/---(.|\n)*---/, "");
};
```

The regex `/---(.|\n)*---/` is **greedy** (`*`) and **unanchored** (no `^`). Two
consequences, both empirically pinned in the characterization test:

1. **Over-strip (body content LOST).** The greedy `*` makes the match span from
   the **first** `---` to the **last** `---` anywhere in the document. A real
   leading frontmatter block followed by a body horizontal-rule `---` causes the
   match to run past the closing fence and eat the intervening prose:
   `"---\ntitle: Hi\n---\nIntro\n\n---\n\nAfter rule"` -> `"\n\nAfter rule"` —
   `"Intro"` and the first fence both disappear (test line 91-93). Multiple fenced
   blocks collapse to the last fence (`"...\nmid\n---\nb: 2\n---\nend"` -> `"\nend"`,
   `mid` eaten — test line 100-101).
2. **Unanchored.** A frontmatter-like block is matched even when it is **not** at
   the start of the document (`"lead\n---\nk: v\n---\ntail"` -> `"lead\n\ntail"` —
   test line 110). A leading newline after the closing fence is also left behind
   (test line 51).

### The decisive finding: this helper has **no production callers**

A full-repo audit (symbol grep across `*.ts`/`*.tsx`/`*.js`, including re-exports
and barrels) finds `stripFrontmatterFromString` referenced in **exactly two
places**: its own definition (`fm.ts:30`) and its characterization test. There is
**no call site in any production module.**

Git history confirms it was *once* called and the call is long gone:

- Commit `58bc881` introduced the function **and** a caller — but the caller was
  **already commented out** even when added: a `/* ... */` block in a "preview"
  cell that did
  `const fc = stripFrontmatterFromString(await app.vault.cachedRead(file));` to
  feed a frontmatter-stripped body into a file-preview cache (`setCache`).
- Commit `b38b417` ("latest source code") removed that file/region entirely. Since
  then the function is **dead code** — defined and exported, never invoked.

So the over-greedy strip has not run on a real note body in the current codebase.
The historical caller (a preview renderer over `vault.cachedRead`) is exactly the
surface where over-stripping body prose **would** be owner-visible harm — which is
why the bead correctly classified this characterize-then-decide — but that caller
no longer exists.

### The repo already has two CORRECT frontmatter strippers, both in use

This is the part that reshapes the options. Notidian does not need
`stripFrontmatterFromString` to strip frontmatter — it already does it correctly,
twice, on live paths:

1. **`stripFrontmatter` (`src/core/utils/spaceNoteBody.ts:4`)** — an
   **anchored, lazy, CRLF-aware, single-block** regex:

   ```ts
   export const stripFrontmatter = (content: string): string => {
     if (!content) return "";
     const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
     return match ? content.slice(match[0].length) : content;
   };
   ```

   It is `^`-anchored (only a *leading* block), `*?` lazy (stops at the *first*
   closing fence, so a body `---` is safe), handles `\r\n`, and consumes the
   trailing newline. It is used by `isNoteBodyEmpty` (the space-note-region
   emptiness check, Notidian-7oj) and tested in `spaceNoteBody.test.ts`. It is the
   exact correct behavior the broken helper lacks.

2. **Obsidian `frontmatterPosition` offset slice** — the metadata cache's
   *authoritative* parse, already used on real paths:
   `markdownAdapter.ts:335` does
   `contents.slice(fCache.frontmatterPosition?.end.offset ?? 0, 1000)` and
   `Explorer.tsx:322` reads `fCache.metadata.frontmatterPosition.end` to strip the
   fence by byte offset. This is the most correct of all (it uses Obsidian's own
   YAML parser boundary), at the cost of needing a `CachedMetadata` for the file.

In short: the project's house answer for "give me the body without the leading
frontmatter fence" is **already** `stripFrontmatter` (string-only) or
`frontmatterPosition` (cache-backed). The broken `stripFrontmatterFromString` is a
third, defective, *unused* duplicate.

### Why this is a decision, not a blind fix

Two reasons the autonomous loop refused to just rewrite the regex:

1. **Authority/behavior.** `stripFrontmatterFromString` produces a
   "body-without-the-property-fence" view; frontmatter is the canonical owner of
   editable properties (ADR 0014/0017). Any rewrite **changes what is removed** —
   if the helper were ever re-wired to a render/preview path, the chosen semantics
   (lazy-anchored vs greedy) decide whether owner prose survives. That is a
   product call, not pure logic, and the current output is deliberately locked as
   characterization so a change is a conscious flip.
2. **Scoping.** Because the function is **dead**, "fix the regex" silently ratifies
   keeping a redundant third stripper alongside two correct ones. The honest choice
   set therefore includes **delete**, not just **fix**. Picking delete vs fix vs
   replace-with-the-canonical-helper is the owner's call about the codebase's
   surface area, which tsc/jest/build cannot make.

## Decision

**Recommended: Option C — delete the dead `stripFrontmatterFromString` helper (and
its characterization test), since it has zero production callers and the repo
already has two correct, in-use frontmatter strippers (`stripFrontmatter` /
`frontmatterPosition`).**

One-line why: a defective function that nothing calls is pure liability — deleting
it removes the over-strip hazard outright, eliminates a duplicate of a problem the
codebase already solved correctly twice, and cannot regress any behavior (nothing
observes its output); if a future caller needs body-minus-frontmatter, it should
reach for the existing correct `stripFrontmatter` (string) or `frontmatterPosition`
(cache), not a resurrected broken one.

### Options

**Option A — Fix in place: anchored + lazy regex.**
Replace the body with the anchored/lazy form (essentially the existing
`stripFrontmatter`): `/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/`, slicing off the match.
Keep the function and re-point the characterization test to assert the corrected
(non-over-stripping, anchored, single-block) behavior.

- **Pros:**
  - Smallest diff if the export must be preserved for an external/plugin consumer.
  - Makes the helper *correct* so a future caller that imports it is safe.
- **Cons (ruled out as the primary choice):**
  - **Ratifies a duplicate.** It would leave the repo with *three* leading-
    frontmatter strippers, two of which (`stripFrontmatter`, `frontmatterPosition`)
    are already correct and in use. Fixing the third to match the first is busywork
    that grows surface area instead of shrinking it — directly against the project's
    de-duplication posture (cf. ADR 0031's "the project already has the house
    answer" reasoning for CSV header dedup).
  - It "fixes" code that nothing exercises — the fix is unverifiable in situ (no
    caller, no eyes-on surface) beyond the unit test, which Option C also satisfies
    by removal.

**Option B — Replace call sites (n/a) / re-route to the canonical helper.**
If a caller existed, the right move would be to delete `stripFrontmatterFromString`
and switch the caller to `stripFrontmatter` (string-only) or, where a
`CachedMetadata` is in hand, `frontmatterPosition`. **There is no caller**, so this
collapses into Option C (delete) — listed only to record that the *replacement
target already exists* and no new code would be written even if a caller surfaced.

- **Pros:** would converge on one correct stripper; reuses tested code.
- **Cons:** moot today (no caller). Kept as the documented recipe for *any future
  need*: prefer `frontmatterPosition` (authoritative Obsidian parse) when a cache
  is available, else `stripFrontmatter` (anchored/lazy/CRLF-safe string form).

**Option C — Delete the dead helper + its characterization test (RECOMMENDED).**
Remove `stripFrontmatterFromString` from `fm.ts` (and the
`fm.stripFrontmatterFromString.test.ts` net that pins its defective behavior).
Nothing imports it, so the build is unaffected.

- **Pros:**
  - **Removes the hazard outright** — there is no greedy regex left to over-strip
    if a future contributor copies or re-wires it.
  - **Cannot regress behavior** — zero callers means zero observable output; the
    full suite + tsc + build stay green by construction.
  - **Shrinks surface area** and collapses three strippers to the two correct,
    in-use ones. Future "strip frontmatter" needs route to `stripFrontmatter` /
    `frontmatterPosition` (recorded in Option B).
  - Honest: the characterization test exists to *pin a defect pending a decision*;
    once the decision is "this code should not exist," the pin is retired with the
    code, not converted into a green test for a function nobody uses.
- **Cons:**
  - If an **out-of-tree** consumer (a downstream fork, a plugin importing this
    module directly) relies on the export, deleting it is a breaking change. Given
    this is a personal fork with the symbol unused in-tree and its only historical
    caller already deleted upstream, this risk is judged negligible — but it is the
    owner's call, which is why this is Proposed, not applied. If the owner wants the
    export retained for safety, fall back to **Option A** (fix, don't delete) so any
    such importer gets the *correct* behavior rather than a missing symbol.

### Why C over A

Both remove the defect. A keeps a correct-but-unused duplicate; C removes the
duplicate. For a single-developer fork with no in-tree caller and two correct
strippers already carrying the load, the lower-surface-area choice (C) is strictly
better unless an external importer must be preserved — in which case A is the
fallback. Either way the over-greedy regex stops being a latent trap. The only
choice that is *wrong* is leaving it as-is: a known-defective, exported helper that
silently over-strips is a copy-paste hazard even while dead.

## Consequences

- **If the recommendation (Option C — delete):** `stripFrontmatterFromString` and
  `fm.stripFrontmatterFromString.test.ts` are removed. The export disappears; no
  in-tree code changes (nothing imported it). The over-strip hazard is gone. Full
  suite + tsc + build stay green (verified locally that the only references are the
  definition and its own test). **No vault-observable change; no eyes-on check
  needed** (the function never ran on a note body in the current codebase). The
  `fm.ts:17-29` hazard comment is removed with the function.
- **If Option A (fix in place):** the regex becomes anchored/lazy/CRLF-aware
  (matching `stripFrontmatter`); the characterization test is **deliberately
  re-pointed** from the pinned over-strip behavior to the corrected behavior
  (Intro/mid preserved, leading-only, single-block, trailing newline consumed).
  The export is preserved for any external importer, now with safe semantics.
  Still no in-tree behavior change (no caller), so no eyes-on check needed.
- **If left as-is (rejected):** the known-defective greedy/unanchored helper stays
  exported as a copy-paste trap; the only guard is the hazard comment and the
  defect-pinning test.

This is a **dead-code / logic** change (no render-path `innerHTML`, no authority
write surface, no currently-observable row/body output), so **no default-OFF flag
is proposed** — per the AUTONOMOUS-REVIEW-QUEUE convention, the flag mechanism is
for changes gates *cannot* prove offline. Both C (delete) and A (fix) are fully
jest/tsc/build-provable and change no vault-observable behavior, so this needs the
owner's **decision** (scope call: delete vs fix), not a flag + live-verify. No code
or test was changed by this ADR; `fm.ts` and the pinned
`fm.stripFrontmatterFromString.test.ts` are untouched until the owner picks.

## The one decision the owner needs to make

**`stripFrontmatterFromString` has no production callers and the repo already has
two correct frontmatter strippers (`stripFrontmatter`, `frontmatterPosition`) —
should the dead, defective helper be deleted, or fixed in place?**

- **C** (delete the helper + its characterization test — **RECOMMENDED**; lowest
  surface area, removes the hazard, cannot regress) /
- **A** (fix in place to an anchored/lazy regex and re-point the test — choose this
  only if the export must be preserved for an out-of-tree importer) /
- (leave as-is — **not recommended**: keeps a known copy-paste hazard).

On a pick of **C**, the implementing session deletes the function from `fm.ts`
(and the `fm.ts:17-29` hazard comment) and removes
`fm.stripFrontmatterFromString.test.ts`; full suite + tsc + build confirmed green.
On a pick of **A**, the session replaces the regex with the anchored/lazy form and
**deliberately re-points** the pinned characterization assertions to the corrected
behavior in the same commit. Either way, any *future* need for a
body-minus-frontmatter view should use the existing `stripFrontmatter` (string) or
`frontmatterPosition` (cache), not a new bespoke regex.
