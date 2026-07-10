# ADR 0040: `emojiBox.ts` dead, unsanitized SVG/HTML injection sink — delete vs sanitize-and-keep

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** — the recommended **Option A** shipped in `c6773d6` under the
use-driven-realignment doctrine (`cb2d74c`); bd `Notidian-k6a5` CLOSED:
`src/shared/utils/emojiBox.ts` was **deleted entirely**, along with every one
of its exports (`createExactEmojiBox`, `emojiBoxStyles`,
`calculateOptimalEmojiFontSize`, `supportsColorEmoji`).

Originally written **instead of touching `emojiBox.ts` blind**. The module's
`createExactEmojiBox` built raw SVG/`<span>` HTML strings by interpolating
caller input (`${emoji}`, `${size}`, `class="${options?.className}"`) with **no**
escaping/sanitization — a latent `innerHTML` injection sink under the ADR 0017 /
Notidian-ebz threat model. But the load-bearing finding was that **every export
in the module had zero production callers**, so the real question was not "how
should it sanitize" but "should this defective, dead helper exist at all." That
was a deliberate scoping call, not pure logic. That decision has since been
made: Option A shipped as noted above.

## Date

2026-06-15

## Context

### The code

`src/shared/utils/emojiBox.ts` exports four symbols:

- `createExactEmojiBox(emoji, size?, options?)` — returns an **HTML string** (one
  of three render methods: `svg` via `<foreignObject>`, `css-grid`, `css-flex`).
- `emojiBoxStyles` — a static CSS string of `.mk-emoji-box*` class rules.
- `calculateOptimalEmojiFontSize(containerSize)` — returns `"<n>px"` (`size * 0.85`).
- `supportsColorEmoji()` — a canvas feature-detect, returns `boolean`.

The injection concern is `createExactEmojiBox`. It interpolates **three pieces of
caller-supplied input directly into a returned markup string with no escaping**:

```ts
// src/shared/utils/emojiBox.ts (svg branch, abridged)
return `
  <svg ... class="${options?.className || ''}" style="width: ${size}; height: ${size}; ...">
    <foreignObject width="100" height="100">
      <div xmlns="http://www.w3.org/1999/xhtml" style="...">
        ${emoji}
      </div>
    </foreignObject>
  </svg>
`;
```

- `${emoji}` is interpolated as **element text** inside the `<div>` (and inside
  the `<span>` for the `css-grid`/`css-flex` methods). A value like
  `<img src=x onerror=alert(1)>` is emitted verbatim.
- `class="${options?.className || ''}"` is interpolated into an **unquoted-by-
  attacker** attribute — a `className` of `"><script>...</script>` breaks out of
  the attribute and the tag.
- `style="width: ${size}; ..."` interpolates `size` into a CSS context; a crafted
  `size` can inject extra declarations or break out of the `style` attribute.

The function's only contract is "return a string," and its name + return type make
it an **attractive nuisance**: the natural way to use the result is
`el.innerHTML = createExactEmojiBox(...)` or React
`dangerouslySetInnerHTML={{ __html: createExactEmojiBox(...) }}` — exactly the
sink class ADR 0017 and the Notidian-ebz sweep govern. The moment any caller does
that with vault-derived `emoji`/`className`/`size`, it is a stored-XSS vector.

### The decisive finding: every export has **zero production callers**

A full-repo symbol audit (grep over `*.ts`/`*.tsx`, including re-exports and
barrels) finds `createExactEmojiBox`, `emojiBoxStyles`,
`calculateOptimalEmojiFontSize`, and `supportsColorEmoji` referenced in **exactly
one place each: the definition in `emojiBox.ts` itself.** There is **no import of
the `emojiBox` module anywhere in `src/`**, and **no test** exercises it. The
module is dead code — defined and exported, never invoked.

So the unsanitized interpolation has never run at a live sink in the current
codebase. The risk is entirely latent (a future contributor wiring it up, or
copy-pasting the pattern), which is precisely why this is *characterize-or-decide*,
not a hot-path bug.

### The repo already has the CORRECT emoji-injection path, in use

This is the part that reshapes the options. Notidian does **not** need
`emojiBox.ts` to render an emoji into the DOM — it already does it correctly, on a
live path, **through the Notidian-ebz sanitize chokepoint**:

`src/shared/components/StickerModal.tsx:26-33`:

```ts
const htmlFromSticker = (sticker: Sticker) => {
  // Notidian-ebz: the picker injects this raw, bypassing the stickerFromString
  // chokepoint — escape the emoji and sanitize custom-iconset SVG here too.
  if (sticker.type == "emoji") {
    return escapeHtml(emojiFromString(sticker.html));
  }
  return sanitizeIconSVG(sticker.html);
};
```

That is the house answer: an **emoji** is normalised to its native glyph
(`emojiFromString` → `unifiedToNative`, `stickers.ts:1-29`, a pure codepoint
decode that produces a plain emoji character — **no markup**) and then
**`escapeHtml`-ed** before it reaches `innerHTML`; a **custom-iconset SVG** goes
through **`sanitizeIconSVG`** (`src/shared/utils/sanitize.ts:295`, the
fixed-point DOM cleaner that strips `script`/`foreignObject`/`on*`/dangerous URLs
and neutralises CSS fetches). Bundled lucide/ui icons render verbatim via
`getSticker` because they are plugin-authored and trusted (per the `sanitize.ts`
threat-model header).

`emojiBox.createExactEmojiBox` is a **third, defective, unused** way to turn an
emoji into markup — one that does the opposite of the house pattern: it
*constructs* an SVG `<foreignObject>` (an element the icon sanitizer explicitly
**removes** as dangerous, `SVG_DANGEROUS_TAGS`) and injects raw `${emoji}` text
with **no** `escapeHtml`. It is everything Notidian-ebz hardened against, frozen
in a helper that nothing calls.

### Why this is a decision, not a blind action

Two reasons the autonomous loop refused to either harden or delete it on its own:

1. **Security/authority boundary.** Routing `${emoji}`/`${className}`/`${size}`
   through `escapeHtml`/`sanitizeIconSVG` (Option B) is a real security change to
   a function with a defined output contract, and the *only* way to know it is
   correct is adversarial + property tests at the sink — i.e. building real test
   surface for code with **no caller**. Whether that surface is worth carrying is
   a scope call (does the owner intend a future emoji-box renderer?), not
   something tsc/jest can decide.
2. **Scoping.** Because the module is **dead**, "just sanitize it" silently
   ratifies keeping a redundant emoji-injection path alongside the one correct,
   in-use one (`StickerModal`/`sanitizeIconSVG`). The honest choice set therefore
   includes **delete**, not only **sanitize-and-keep**. Picking delete vs harden
   is the owner's call about the codebase's surface area and intended direction.

This is the same shape as **ADR 0036** (`stripFrontmatterFromString` — a dead,
defective helper duplicating an already-correct in-use one): the recommendation
there was **delete**, for the same surface-area reasoning. ADR 0040 is the
security-flavoured sibling — the dead duplicate here is not just defective, it is
an unsanitized sink.

## Decision

**Recommended: Option A — DELETE `src/shared/utils/emojiBox.ts` (the whole
module), since every export has zero production callers and the codebase already
has the correct, in-use, sanitized emoji-injection path
(`StickerModal.tsx` → `escapeHtml(emojiFromString(...))` / `sanitizeIconSVG`).**

One-line why: an unsanitized HTML-string builder that nothing calls is pure
liability — deleting it removes the latent XSS attractive-nuisance outright,
cannot regress any behavior (nothing observes its output), and collapses a third
emoji-injection path back to the one Notidian-ebz hardened; if a future feature
needs an exact emoji box it should be built **on** the sanitized house pattern,
not on a resurrected raw-interpolation helper.

### Options

**Option A — DELETE the module (RECOMMENDED).**
Remove `src/shared/utils/emojiBox.ts` entirely. Nothing imports it, so tsc/jest/
build are unaffected.

- **Pros:**
  - **Removes the attractive-nuisance sink outright** — there is no
    raw-interpolation HTML builder left for a future contributor to wire to
    `innerHTML`/`dangerouslySetInnerHTML`, and no tempting "exact emoji box"
    pattern to copy that bypasses `escapeHtml`/`sanitizeIconSVG`.
  - **Cannot regress behavior** — zero callers means zero observable output; the
    full suite + tsc + build stay green by construction.
  - **Shrinks surface area** and re-collapses emoji injection to the single
    correct, in-use path (`StickerModal` + `sanitizeIconSVG`/`escapeHtml`), in
    line with ADR 0017 and the Notidian-ebz sink invariant.
  - Honest about intent: keeping dead security-relevant code "just in case"
    carries a standing audit/maintenance cost (it shows up in every injection
    sweep) for a helper that, if ever needed, should be rebuilt on the hardened
    pattern anyway.
- **Cons:**
  - Drops `supportsColorEmoji`/`calculateOptimalEmojiFontSize`/`emojiBoxStyles`
    too — but these are also dead, and the first two are trivial to re-derive; if
    one is genuinely wanted later, it is a few lines on a clean (non-sink) basis.
  - If an **out-of-tree** consumer (a downstream fork, a plugin importing this
    module path directly) relies on an export, deleting it is a breaking change.
    Given this is a personal fork with all four symbols unused in-tree and no
    historical caller, this risk is judged negligible — but it is the owner's
    call, which is why this is Proposed. If the owner wants the helpers retained,
    fall back to **Option B** so any such importer gets a *sanitized* version, not
    a raw-interpolation one.

**Option B — KEEP but sanitize the sink + add adversarial/property tests before
any caller adopts it.**
Route the three interpolated inputs through the existing helpers so the returned
string is safe at any `innerHTML`/`dangerouslySetInnerHTML` sink:
`${emoji}` → `escapeHtml(emojiFromString(emoji))` (mirror `StickerModal`);
`class="${escapeHtml(options?.className || '')}"`; and constrain/escape `${size}`
(it belongs inside a `style` value — validate it against a strict CSS-length
pattern, e.g. number+unit / `var(...)`, rejecting anything else, since `escapeHtml`
does not neutralise CSS breakout). Then either run the whole returned string
through `sanitizeRenderedHtml`/`sanitizeIconSVG` as a belt-and-braces final pass,
**or** reconsider the `svg`+`foreignObject` method (which the icon sanitizer would
strip as dangerous — so the `css-grid`/`css-flex` `<span>` methods are the only
sink-compatible ones). Add adversarial tests (the Notidian-ebz/-hef/-y3h payload
families: `onerror` img, attribute breakout via `className`, `style` breakout via
`size`, mXSS) **and** a property test (escape round-trip identity for benign
input) **before** wiring any caller.

- **Pros:**
  - Preserves the export for an out-of-tree importer (now safe).
  - Yields a ready, hardened "exact emoji box" helper if a future feature wants
    pixel-exact emoji sizing beyond the existing sticker render.
- **Cons (why not primary):**
  - **Builds real test + security surface for code with no caller** — the work is
    unverifiable in situ (no live sink, no eyes-on) beyond its own unit tests, and
    it carries that surface forever for a hypothetical need.
  - **Ratifies a third emoji-injection path** alongside the one correct in-use
    one, against the de-duplication posture (cf. ADR 0036 / ADR 0031 "the repo
    already has the house answer").
  - The `svg`/`foreignObject` method is fundamentally at odds with the icon
    sanitizer's policy (it *constructs* the exact element the sanitizer removes),
    so a faithful "keep all three methods" hardening is awkward; the honest
    hardened form is essentially a new, smaller, `<span>`-only helper — at which
    point Option A (delete + rebuild-on-demand) is cleaner.

**Option C — Keep as-is (REJECTED).**
Leave the raw-interpolation builder exported and unsanitized.

- **Why rejected:** it violates the ADR 0017 / Notidian-ebz sink invariant the
  instant any caller does `innerHTML = createExactEmojiBox(...)` with
  vault-derived input. A known-unsanitized, exported HTML-string builder is a
  copy-paste / future-wiring trap even while dead; the only options that are
  defensible are *remove the trap* (A) or *make it safe* (B).

### Why A over B

Both close the latent sink. B keeps a hardened-but-unused third injection path and
the test/maintenance surface to prove it safe forever; A removes the path and
defers any future need to the already-hardened house pattern. For a single-
developer fork with **no** in-tree caller, **no** historical caller, and a
correct, tested, in-use emoji-injection path already carrying the load
(`StickerModal` + `escapeHtml`/`sanitizeIconSVG`), the lower-surface-area choice
(A) is strictly better unless an external importer must be preserved — in which
case B is the fallback (with the `<span>` methods, not `foreignObject`). The only
choice that is *wrong* is leaving it as-is (C).

## Consequences

- **If the recommendation (Option A — delete):** `src/shared/utils/emojiBox.ts`
  is removed (all four exports). No in-tree code changes (nothing imported it);
  the latent unsanitized sink is gone; the codebase keeps the single correct
  emoji-injection path (`StickerModal` + `sanitizeIconSVG`/`escapeHtml`). Full
  suite + tsc + build stay green by construction (verified locally that the only
  references to every symbol are their own definitions). **No vault-observable
  change; no eyes-on check needed** (the module never rendered anything in the
  current codebase).
- **If Option B (sanitize + test):** `createExactEmojiBox` routes `emoji` through
  `escapeHtml(emojiFromString(...))`, `className` through `escapeHtml`, and `size`
  through a CSS-length validator; new adversarial + property tests are added; the
  `svg`/`foreignObject` method is either dropped or replaced with a `<span>` form
  compatible with `sanitizeIconSVG`. The export is preserved with safe semantics.
  Still no in-tree caller (so still no eyes-on render check), but it now carries a
  permanent test/security surface.
- **If left as-is (Option C, rejected):** the known-unsanitized exported builder
  stays a copy-paste / future-wiring XSS trap; the only guard is "nobody has
  called it yet."

This is a **dead-code / latent-sink** decision (no *currently* live render-path
`innerHTML`, no authority write surface, no currently-observable output), so **no
default-OFF runtime flag is proposed** — per the AUTONOMOUS-REVIEW-QUEUE
convention, the flag mechanism is for runtime changes the gates *cannot* prove
offline. Option A is fully tsc/jest/build-provable and changes no vault-observable
behavior; Option B's safety is provable by adversarial/property unit tests at the
function boundary. So this needs the owner's **decision** (scope + security call:
delete vs harden-and-keep), not a flag + live-verify. No code or test was changed
by this ADR; `emojiBox.ts` is untouched until the owner picks.

## The one decision the owner needs to make

**`emojiBox.ts` has zero production callers and builds raw, unsanitized SVG/HTML
strings (an attractive-nuisance `innerHTML` injection sink), while the codebase
already renders emoji correctly through the sanitized house path
(`StickerModal` → `escapeHtml(emojiFromString(...))` / `sanitizeIconSVG`) — should
the dead module be deleted, or hardened-and-kept?**

- **A** (delete the whole module — **RECOMMENDED**; lowest surface area, removes
  the latent sink, cannot regress, defers any future need to the hardened house
  pattern) /
- **B** (keep but route `emoji`/`className`/`size` through
  `escapeHtml`/`sanitizeIconSVG` + a CSS-length guard, drop/replace the
  `foreignObject` method, and add adversarial + property tests **before** any
  caller adopts it — choose this only if an out-of-tree importer must keep the
  exports, or a future exact-emoji-box feature is firmly intended) /
- (leave as-is — **not recommended**: keeps a known unsanitized injection trap).

On a pick of **A**, the implementing session deletes
`src/shared/utils/emojiBox.ts`; full suite + tsc + build confirmed green (the only
references to each symbol are their own definitions). On a pick of **B**, the
session sanitizes the three interpolated inputs, reworks/removes the
`foreignObject` method to be sink-compatible, and lands the adversarial + property
tests in the same commit before any caller is wired. Either way, any *future* need
to inject an emoji into the DOM should reuse the existing
`escapeHtml(emojiFromString(...))` / `sanitizeIconSVG` house pattern, not a
bespoke raw-interpolation builder.
