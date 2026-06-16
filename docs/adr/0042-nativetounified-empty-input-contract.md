# ADR 0042: `nativeToUnified('')` empty-input contract — guard to a total codec vs. caller precondition

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

Tracked by bd `Notidian-ywcf` (the fix follow-up to
the characterization landed by `Notidian-8fwj`); queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written **instead of blindly editing `stickers.ts`**: the fix *looks* like a
one-line guard, but the bead explicitly frames it as a **behavior question**
(guard returning `""`/`undefined` vs. document as a caller precondition), and
there is a **LOCKED characterization assertion** in `stickers.test.ts`
(`"THROWS TypeError on empty string"`) that must be **deliberately re-blessed**
as part of any fix — that is a decision posture, not a blind edit (same pattern
as ADR 0025 / 0030 / 0033, where pinned characterization assertions are flipped
only by a reviewed decision). **LOW present-risk:** `nativeToUnified` has **no
non-test caller** today (verified below), so this is hardening the codec
contract against future/external callers and making the pair total — not fixing
a live crash. **No code or test change is made on this route** — the bead stays
OPEN awaiting the owner's pick, and the locked assertion is **not** flipped until
then.

## Date

2026-06-15

## Context

### The defect, exactly

`src/shared/utils/stickers.ts:30`:

```ts
export const nativeToUnified = (native: string) => native.codePointAt(0).toString(16);
```

For an **empty** `native` string, `''.codePointAt(0)` is `undefined`, so the
**unconditional** `.toString(16)` dereference throws
`TypeError: Cannot read properties of undefined (reading 'toString')`. This was
**characterized (not fixed)** by `Notidian-8fwj` and pinned at
`stickers.test.ts:196-201`:

```ts
it("THROWS TypeError on empty string (codePointAt(0) is undefined -> .toString)", () => {
  expect(() => nativeToUnified("")).toThrow(TypeError);
});
```

That assertion is **locked characterization** — it documents *current* behavior,
not desired behavior, and any fix MUST flip it as part of a reviewed decision.

### `nativeToUnified` is the inverse half of a codec pair

The module is a small emoji codec:

- `unifiedToNative(unified)` — `String.fromCodePoint(...)` over `-`-split hex
  parts; the forward direction (code -> glyph).
- `nativeToUnified(native)` — `codePointAt(0).toString(16)`; the inverse
  (glyph -> code of the **first** code point only — verified at
  `stickers.test.ts:190-193`, a flag's two regional indicators collapse to the
  first).
- `emojiFromString(emoji)` — the **production-facing** wrapper: `try
  { unifiedToNative(emoji) } catch { return emoji }`, i.e. on any conversion
  failure it returns the **raw input**.

A round-trip property suite (`stickers.test.ts:204-235`) pins
`nativeToUnified(unifiedToNative(x)) === x` for single-code-point inputs. **The
empty string is the one value where the pair is not total:** `unifiedToNative("")`
throws `RangeError` (pinned at `stickers.test.ts:80-81`, `Invalid code point NaN`
— `Number("0x")` is `NaN`), and `nativeToUnified("")` throws `TypeError`. So
*both* directions already fail on empty; only the wrapper smooths it over.

### Who actually calls these (verified — this is why present-risk is LOW)

A repo-wide grep over `src/**` for `nativeToUnified`:

- **The only importers are tests.** `nativeToUnified` is exported but has **zero
  production call sites** today. So `nativeToUnified("")` cannot crash a running
  Notidian right now — the hazard is **latent**: a future caller (e.g. one that
  reads back a cleared sticker glyph and asks "what code is this?"), or an
  external consumer of the exported util, would hit it.

`emojiFromString` (the wrapper) **is** used in production, at three sinks:

- `src/basics/menus/StickerMenu.tsx:100,111` — emoji command suggester; the
  render path already guards `value.unicode.length > 0 ? emojiFromString(...) :
  noResult` (`StickerMenu.tsx:99-101`), so it never even passes empty.
- `src/shared/components/StickerModal.tsx:30` — `escapeHtml(emojiFromString(...))`.
- `src/adapters/obsidian/ui/sticker.ts:22` — `escapeHtml(emojiFromString(value))`
  (vault-controlled input; the `escapeHtml` is the `Notidian-ebz` security
  contract).

**Crucially, `emojiFromString` already returns `""` for empty input** — pinned at
`stickers.test.ts:114` (`expect(emojiFromString("")).toBe("")`): the empty string
fails `unifiedToNative` with a `RangeError`, the `catch` returns the raw input,
and the raw input is `""`. So the codec family's **production face already has an
"empty -> empty" contract.** The forward util's raw failure is invisible to
callers because the wrapper absorbs it; the inverse util has no such wrapper, so
its raw `TypeError` would surface to any future direct caller.

### Why this is a decision, not a blind one-liner

1. **The bead frames the return value as an open question** — `""` vs `undefined`
   vs documented precondition. These are not equivalent: `""` keeps the codec
   total and string-typed (every call site treats the result as a string —
   `.toString(16)` output, concatenated/escaped); `undefined` changes the return
   **type** (`string | undefined`) and forces every future caller to null-check;
   a documented precondition leaves the throw in place and pushes the guard
   outward.
2. **A locked characterization assertion must be re-blessed.** Flipping
   `stickers.test.ts:200` from "throws" to "returns ''" is a deliberate behavior
   change that the owner should ratify — exactly the posture ADR 0025 / 0030 /
   0033 take for their pinned assertions.
3. **There is a same-family edge** (`unifiedToNative` RangeError on
   empty/non-hex/out-of-range) that the owner may want resolved consistently in
   the same breath — see the note below.

## Decision drivers

- **Make the codec pair total / least-surprising** for a "cleared-glyph" caller:
  empty in -> empty out, mirroring the production wrapper's existing
  `emojiFromString("") === ""` contract.
- **Don't change the return type** unless there's a reason — a `string` result
  that callers concatenate/escape should stay a `string`.
- **Don't push the same guard onto every (future) caller** — one guard in the
  total codec beats N guards at the edges.
- **Keep present-risk honest** — there is no live crash; this is contract
  hardening, so the cheapest correct fix wins.
- **Re-bless the locked assertion explicitly**, never silently.

## Options

### Option A (recommended) — guard `nativeToUnified` to return `""` on empty input

```ts
export const nativeToUnified = (native: string) =>
  native.codePointAt(0)?.toString(16) ?? "";
```

(Equivalently an explicit `if (!native) return "";` head guard — same contract.)
Then **flip the locked characterization assertion** at `stickers.test.ts:196-201`
from "THROWS TypeError on empty string" to "returns '' for empty input" as the
ratified part of this decision, and add an `expect(nativeToUnified("")).toBe("")`
positive assertion.

- **Pros:** makes the codec pair **total** on its boundary value and keeps the
  return type `string` (no caller has to null-check); **matches the existing
  production contract** — `emojiFromString("") === ""` is already pinned, so
  "empty native -> empty code" is the consistent, least-surprising mirror for a
  cleared-glyph caller; the fix is local to the one util and trivially
  unit-testable; `?.` + `?? ""` is idiomatic and reads as intent. It also
  silences the latent crash for any **future** direct caller (the actual point,
  since there is no caller today).
- **Cons:** `""` is technically ambiguous — it is also the legitimate code for
  *no first code point* vs. genuinely-empty input — but every other input has a
  non-empty hex code, and the only ambiguous antecedent (`""`) is precisely the
  one we're defining, so the ambiguity is vacuous. Requires deliberately flipping
  a locked assertion (intended — it is the decision).

### Option B — document empty as a caller precondition; guard at the call sites instead

Leave `nativeToUnified` throwing; add a JSDoc `@throws TypeError if native is
empty — callers must pass a non-empty glyph`, keep the locked "throws"
assertion as the ratified contract, and add an empty-check at each (future) call
site that could pass empty.

- **Pros:** zero change to the util's behavior or the locked test; documents the
  sharp edge; arguably "fail fast" surfaces programmer error at the boundary.
- **Cons (decisive):** **pushes the identical guard onto every caller** — and
  since `nativeToUnified` has *no* caller today, "document the precondition" means
  every *future* caller must remember to pre-check, which is exactly the trap that
  produces the next crash. It leaves the codec pair **non-total** while its
  production sibling (`emojiFromString`) is already total on the same value,
  creating an inconsistent family contract. "Fail fast" has little value for a
  pure, side-effect-free string conversion whose total form is unambiguous.
  Rejected.

### Option C — decline (keep the throw, keep the locked assertion, close nothing)

Accept the latent `TypeError` as-is; treat the characterization as the permanent
contract.

- **Pros:** zero work; the test already documents it; no caller hits it today.
- **Cons (decisive):** leaves a **latent crash** in an exported public util whose
  production sibling is already total on the same input — a future caller (a
  cleared-glyph read-back, an external consumer) inherits an avoidable
  `TypeError`. A one-line, type-preserving guard that *matches an existing
  contract* is the textbook case where "decline" is the wrong call. Rejected.

## Recommendation

**Option A — guard `nativeToUnified` to return `""` on empty input
(`native.codePointAt(0)?.toString(16) ?? ""`), and re-bless the locked
characterization assertion accordingly.** One line of why: it makes the codec
pair **total** and keeps the return type a `string`, **matches the already-pinned
`emojiFromString("") === ""` production contract** (so the family is consistent
and a cleared-glyph caller gets the least-surprising empty-in/empty-out result),
and removes a latent crash with the smallest possible, idiomatic change — where
B pushes the same guard onto every future caller and C leaves the crash in place.

### Ruled out

- **Option B (document as caller precondition)** — pushes the identical guard onto
  every (future) caller and leaves the pair non-total while its production sibling
  is already total on the same value; the inconsistency *is* the next bug.
- **Option C (decline)** — leaves a latent `TypeError` in an exported util that a
  one-line, type-preserving, contract-matching guard removes cleanly.
- **Returning `undefined` instead of `""`** — changes the return type to
  `string | undefined` and forces a null-check on every future caller, for no
  benefit over `""`; `""` is the value the production wrapper already returns and
  the value every call site can consume unchanged. (Considered and rejected as a
  sub-variant of A.)
- **A default-OFF runtime flag** — not applicable: this is a pure, offline-
  provable string conversion with no render/authority/`innerHTML` surface; there
  is nothing a runtime flag de-risks (the no-flag posture of ADR
  0032/0033/0034/0036/0039). The verification is jest, not eyes-on-vault.
- **Editing `stickers.ts` or flipping the locked assertion now (a blind build)** —
  the return value (`""` vs `undefined` vs precondition) and the re-blessing of a
  pinned characterization assertion are owner calls; hence an ADR, with the bead
  OPEN.

## Same-family note: `unifiedToNative` RangeError on empty/non-hex/out-of-range

The **forward** direction has a parallel, deliberately-different posture. `unifiedToNative`
throws `RangeError` on empty (`Number("0x")` -> `NaN`), non-hex (`"zzz"`), and
out-of-range (`"110000"` -> `Invalid code point 1114112`) input — all pinned at
`stickers.test.ts:80-98`. Today this is **caught only by `emojiFromString`'s
try/catch** (which returns the raw input — the `Notidian-ebz` security contract,
where a non-emoji payload survives verbatim and the obsidian/modal sinks
`escapeHtml` it). Any **raw** `unifiedToNative` caller is unguarded, but — like
its inverse — `unifiedToNative` has **no raw production caller** (only
`emojiFromString` and tests).

If the owner takes Option A, they should decide whether to apply a **symmetric**
guard to `unifiedToNative` (e.g. return `""` on empty input, before
`String.fromCodePoint`). **Recommended: yes, but narrowly — guard only the empty
case** (return `""`), to make the pair total on its boundary value and keep
`nativeToUnified('') -> '' -> unifiedToNative('') -> ''` a clean round-trip.
**Do NOT** broaden `unifiedToNative` to swallow non-hex / out-of-range input: that
RangeError is **load-bearing** — it is exactly what `emojiFromString`'s catch
relies on to return the raw payload verbatim (the `Notidian-ebz` security
behavior). Silently returning `""` for `"zzz"`/`<img ...>` would change
`emojiFromString`'s output and could mask malformed/hostile input. This is the
same-family-but-defensibly-different posture ADR 0034 takes (value-level malformed
date fails closed; operator-level unreadable constraint fails open): here the
**empty** boundary is made total, but **malformed/out-of-range** stays loud so the
security catch keeps working.

## Consequences

If the owner approves **A**, the implementing session:

1. edits `src/shared/utils/stickers.ts:30` to
   `native.codePointAt(0)?.toString(16) ?? ""` (return type stays `string`);
2. **flips the locked characterization assertion** at `stickers.test.ts:196-201`
   from "THROWS TypeError on empty string" to a positive
   `expect(nativeToUnified("")).toBe("")`, with a comment noting the re-blessing
   and citing this ADR + `Notidian-ywcf`;
3. optionally (if the same-family sub-decision is also approved) adds the narrow
   `unifiedToNative('') -> ''` empty guard **without** touching the
   non-hex/out-of-range RangeError, and adds a round-trip assertion
   `nativeToUnified(unifiedToNative("")) === ""`, leaving the `RangeError`
   assertions for non-hex/out-of-range untouched (the `Notidian-ebz` security
   contract);
4. closes `Notidian-ywcf`.

Everything is pure, offline-provable string logic (no render/authority/`innerHTML`
surface), so the gate is **jest** (`npm test`) + a green
`npm run verify:source` — **no eyes-on-vault step and no default-OFF flag.** Until
a pick, **no `stickers.ts` or `stickers.test.ts` change is made** and the locked
assertion is **not** flipped.
