# ADR 0026: `jsonWithUnquoted` Frame-Payload Parsing — Wrapper Convention + Tolerant Tokenizer

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

(Historical framing below retained as the record.) This ADR refuses to harden
the parser blind: both open items are on the **frame-execution trust boundary**
([ADR 0018](0018-makemd-fork-debt-scope-and-frame-trust-boundary.md) /
bd Notidian-vke), so a "right-looking" change to the parser is also a change to
*what becomes executable code* on the always-on render path. It frames the
options, recommends one for each, and explicitly folds the implementation into
the existing **default-OFF `hardenFrameExecution`** flag. **Nothing in the parser
or the runtime render path changes here**, and **no new runtime flag is added**
(the autonomous review queue's flag-cap is already at its working limit — see
`docs/AUTONOMOUS-REVIEW-QUEUE.md`).

## Date

2026-06-15

## Context

`src/shared/utils/jsonWithUnquoted.ts` parses the JSON-ish payloads the frame
system uses for **button/node actions** — objects like `{"command": $abc,
"parameters": {...}}` where some values are intentionally *unquoted* (a `$`
expression, a dotted property access, a backtick template) so they evaluate as
code rather than string literals. bd Notidian-d4u fixed four documented
round-trip defects here and pinned the surface with a characterization +
adversarial suite (`jsonWithUnquoted.test.ts`). Two items were deliberately
**deferred** as design-open, because resolving them is not an offline correctness
fix — it changes the frame-execution contract.

### Why this module is on the trust boundary (verified)

The parser's output is not inert data; it is the **action payload that is later
compiled and executed**:

1. `ButtonSubmenu.tsx` builds a command object and serializes it with
   `stringifyJsonWithUnquoted(commandObject, { command: true, parameters: true })`,
   storing the **string** into `node.actions[propName]`
   (`ButtonSubmenu.tsx:151-169`).
2. On render/interaction, `runner.ts` compiles that stored code:
   `executeCodeBlocks(node, 'actions', execActions, …)` →
   `codeBlockStore[key].call(results.state)` → `executeCode` →
   **`new Function("with(this) { … }")`** with `$api` bound
   (`runner.ts:267, 270-283, 339-379`).
3. Reading the payload back into the editor runs it through
   `parseJsonWithUnquoted` (`ButtonSubmenu.tsx:59`); the `unquotedFields` markers
   it returns decide which values stay **unquoted (code)** vs **quoted (string)**
   on the next re-serialize.

So the parser/serializer pair is the boundary between *stored text* and
*executed code*. Per ADR 0018, **`SpaceOuter` always frame-renders** and frame
code (props/styles) runs under the trust boundary; **actions keep `$api`** because
they are user-triggered (`runner.ts:262-267`). A parser that interprets *more*
inputs as well-formed action objects, or that flips a value between
quoted-string and unquoted-code, therefore directly changes what executable
payload the runtime accepts. That is why this is a decision, not a refactor.

### The two open items

**(5) Double-quote-wrapped vs single-quote-wrapped asymmetry.**
`parseJsonWithUnquoted` tries `JSON.parse` first (the fast-path, line 25). For
the input `'"{\"a\":1}"'` — a double-quote-wrapped object — that string *is*
itself valid JSON (a JSON string), so the fast-path succeeds and returns the
**inner STRING** `'{"a":1}'`; the wrap-stripping at lines 46-49 never runs. For
`'\'{"a":1}\''` — single-quote-wrapped — the input is **not** valid JSON, so it
falls through to `parseWithUnquotedStrings`, the outer quotes are stripped, and
it returns the parsed **OBJECT** `{a:1}`. Same intent ("a wrapped payload"), two
different result *types*. This is pinned today as intentional characterization in
`jsonWithUnquoted.test.ts` (the `BUG(Notidian-d4u): double-quote-wrapped … STRING`
case, left unflipped). The decision: **which wrapper convention is canonical**,
and what a wrapped payload should deterministically return.

**(TOKENIZER) The lossy regex parser.** The fallback parser hinges on a single
regex, `/(\w+)\s*:\s*([^,}\]]+)/` (line 53). The value class `[^,}\]]+` stops at
the first `,`, `}`, or `]`, so any value that legitimately contains one of those
characters (a stray `}`, an embedded comma, a nested literal) truncates the
value, produces unbalanced JSON, and the whole object **silently degrades to
`{}`** (pinned by adversarial tests: `a}b`, `a]b`, embedded-comma cases). A
tolerant, brace/bracket/quote-aware **tokenizer** is the correct long-term fix —
but a tokenizer that accepts *more* shapes is, on this boundary, a tokenizer that
turns *more* stored text into executable action payloads. So it must be a
deliberate design under the trust model, gated where it changes render-path
behavior — not a speculative rewrite.

## Decision 1 — Canonical wrapper convention (item 5)

**Options:**

- **(1a) OBJECT-returning convention is canonical; normalize the
  double-quote-wrapped case to match (recommended).** Define the contract as:
  *a wrapped frame payload (single- **or** double-quote wrapped) parses to the
  inner OBJECT.* Implementation: before the `JSON.parse` fast-path, detect the
  "string that wraps an object/array literal" shape and unwrap it once, so
  `"{...}"` and `'{...}'` both reach the same object-parse path. The action
  consumer already wants an object (`ButtonSubmenu.tsx:60` checks
  `typeof parsed === "object"` and reads `parsed.command`), so the object is the
  load-bearing shape; a bare inner-string return is a dead end for every real
  caller. This removes a type-ambiguity at the *input* to the
  stored-text→executable-code boundary, which is the safer direction (a
  deterministic object is easier to validate than "sometimes a string, sometimes
  an object").

- **(1b) STRING-returning fast-path is canonical; make single-quote-wrapped match
  it.** Treat any wrapped payload as a string; require callers to re-parse. This
  is closer to raw `JSON.parse` semantics, but it pushes a second parse onto every
  caller, and the only caller treats a returned string as "not a JSON object" and
  drops it (`ButtonSubmenu.tsx:60,72`) — so this convention loses real payloads.
  Rejected.

- **(1c) Leave the asymmetry; keep both as characterization.** Zero risk, zero
  cost, but the ambiguity stays on the trust boundary: the same authored intent
  yields a string in one path and code-bearing object in another, which is
  exactly the kind of "depends how it was quoted" gap that makes the boundary hard
  to reason about. Acceptable only if the owner judges the surface too low-traffic
  to touch.

## Decision 2 — Tolerant tokenizer (item TOKENIZER)

**Invariant (non-negotiable, inherited from ADR 0018 / vke):** the parser must
**never widen what becomes executable** without the owner opting in. A tokenizer
that recovers more inputs increases the set of stored strings that resolve to a
runnable action payload; on a boundary where actions execute with `$api`, that is
a security-relevant behavior change, not a pure bugfix — even though it *reads*
like "just parse better."

**Options:**

- **(2a) Tolerant tokenizer, gated behind the existing default-OFF
  `hardenFrameExecution` flag (recommended).** Replace the lossy regex with a
  small, explicit, brace/bracket/quote-aware tokenizer that tracks nesting depth
  and string state, so embedded `,`/`}`/`]` inside a value no longer truncate it.
  Crucially, **the tokenizer path is only taken when `hardenFrameExecution` is
  ON** — when OFF, the current regex behavior is byte-for-byte preserved (the
  owner's vault is unchanged until they enable + live-verify the boundary). This
  reuses the *exact* flag and review-gate that already governs the
  frame-execution sink (vke), so it adds **no new runtime flag** and rides the
  same single live-verify the owner already owes for vke. The tokenizer ships with
  the existing adversarial corpus flipped from "degrades to `{}`" to "recovers the
  value," plus property tests asserting it never emits invalid JSON and never
  returns a polluted object (the injection contract from the current suite).

- **(2b) Tolerant tokenizer, shipped unconditionally (no flag).** Cleanest code,
  but it changes the always-on render-path behavior of a boundary module with no
  offline way to prove the render output is unchanged, and it widens the
  executable-payload set the moment it merges. Rejected: violates the "do not
  widen execution without owner opt-in" invariant and the autonomous-loop rule
  that render-path changes ship default-OFF.

- **(2c) New dedicated flag for the tokenizer (`tolerantFrameParser`).** Most
  granular rollout, but the autonomous review queue's flag-cap is already at its
  working limit, and a separate flag fragments the *one* trust decision the owner
  is already making for vke into two correlated toggles. Rejected: the tokenizer's
  risk surface **is** the vke boundary; it should ride the vke flag, not spawn a
  sibling.

- **(2d) Keep the regex; only document the degradation.** Zero risk, but leaves
  the silent `{}` data-loss path in a load-bearing serializer. Acceptable only as
  a "not now" — kept as the fallback if the owner does not want any tokenizer
  work.

## Recommendation

**Decision 1: adopt (1a)** — make the **OBJECT-returning convention canonical**
and normalize the double-quote-wrapped case to it. One line: every real caller
wants the object, so a deterministic object removes a type-ambiguity at the input
to the executable-code boundary instead of leaving "string or object, depending
how you quoted it."

**Decision 2: adopt (2a)** — implement the **tolerant tokenizer as a later
implement-bead, gated behind the existing default-OFF `hardenFrameExecution`
flag**, with the regex path preserved when the flag is OFF. One line: the
tokenizer's only real risk is that it widens the executable-payload set on the
vke trust boundary, so it must ride the *same* flag and the *same* live-verify
the owner already owes for vke — never a blind, always-on rewrite, and never a
new flag.

This pairing folds the whole item into the **Notidian-vke frame-hardening line**:
the wrapper convention is settled now as offline-provable parser semantics (it can
land with the d4u-style characterization-flip discipline once approved), and the
tokenizer is deferred to ride the vke flag the owner must enable and keep ON
anyway.

## Alternatives Considered / Ruled Out

- **(1b) STRING-canonical wrapper convention.** Rejected: the only caller drops a
  returned string as "not a JSON object," so it loses real action payloads.
- **(1c) Keep the wrapper asymmetry.** Not recommended (kept as a "too
  low-traffic to touch" fallback): leaves a quote-dependent type ambiguity on the
  boundary.
- **(2b) Unconditional tokenizer.** Rejected: widens the executable-payload set on
  the always-on render path with no offline render proof and no owner opt-in.
- **(2c) Dedicated `tolerantFrameParser` flag.** Rejected: duplicates the vke
  trust decision into a second correlated flag and breaches the review-queue
  flag-cap; the tokenizer's risk *is* the vke boundary.
- **(2d) Document-only, keep the regex.** Not recommended (fallback if no
  tokenizer work is wanted): leaves the silent `{}` data-loss path in place.
- **Rewrite the parser to a full JSON5/relaxed-JSON dependency.** Rejected: pulls
  a general permissive parser onto the trust boundary (maximally widening the
  accepted shape) and adds supply-chain surface to a security-relevant sink, for a
  tiny, well-characterized grammar a ~50-line tokenizer covers.

## Why no spike was shipped here

A throwaway default-OFF spike cannot de-risk either decision without committing
to the design choice this ADR defers to the owner: the wrapper convention is a
semantics call (1a vs 1b is a contract, not a measurement), and the tokenizer's
whole risk is that it changes the *executable-payload set* on the vke boundary —
which is precisely what the owner must live-verify under the existing
`hardenFrameExecution` flag, not under a new throwaway one. Per the bead, **the
parser code is untouched and no new runtime flag is added**; this is a decision
artifact only.

## Consequences

- Decision 1 (1a), when implemented, makes a wrapped frame payload return a
  deterministic object regardless of quote style — removing a quote-dependent
  type ambiguity at the input to the executable-code boundary. It is
  offline-provable (the characterization assertion in `jsonWithUnquoted.test.ts`
  flips from "STRING" to "OBJECT" in the same change), so it does **not** need a
  flag — but it stays unbuilt until the owner picks a direction.
- Decision 2 (2a), when implemented, fixes the silent `{}` data-loss on
  embedded-delimiter values **only when `hardenFrameExecution` is ON**, so the
  owner's current vault is unchanged until they enable + live-verify the vke
  boundary. It adds **no new flag** and creates **no new live-verify obligation**
  beyond the one vke already owns.
- This ADR changes **no parser code and no runtime render path**, and adds **no
  runtime flag**. Nothing ships until the owner picks 1a/1b/1c and 2a/2b/2c/2d.
