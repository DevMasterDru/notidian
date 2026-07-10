# ADR 0030: `serializeMultiDisplayString` / `parseMultiDisplayString` — First-Comma-Only Escape Data Loss

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** as **Option A** (recommended): both comma replaces made global and
the parser un-escape moved to after the split; shipped in `dbc608f` under the
use-driven-realignment doctrine (`cb2d74c`); bd `Notidian-od7` CLOSED. The locked
Notidian-a3s characterization assertions (in `serializers.test.ts`,
`parsers.test.ts`, `lookup.test.ts`) were deliberately flipped to assert correct
round-tripping. The original record below is preserved.

Originally written instead of changing the serializers blind (related-dep on the
characterization net `Notidian-a3s`). The escape contract was **caller-dependent**:
the functions back real authority surfaces (link/context cells, tags, aliases,
lookup inlinks/outlinks/spaces), the then-defective output was **explicitly locked
as characterization, not correction** in `src/utils/serializers.test.ts`
(Notidian-a3s), and — decisively — fixing the parser reinterprets values already
written into the vault by the buggy serializer, so "fix the round-trip" was a
data-migration / behavior call, not a pure-logic one. That decision has since been
made: Option A shipped as noted above.

## Date

2026-06-15

## Context

### The defect

`src/utils/serializers.ts:1` and `src/utils/parsers.ts:10`:

```ts
// serializers.ts
export const serializeMultiDisplayString = (value: string[]) =>
  value.map(f => f.replace(',', '\\,')).join(', ');

// parsers.ts
export const parseMultiDisplayString = (str: string): string[] =>
  (ensureString(str).replace('\\,', ',')?.match(/(\\.|[^,])+/g) ?? [])
    .map(f => f.trim());
```

Both `.replace(',', ...)` / `.replace('\\,', ...)` pass a **string pattern**, so
each replaces only the **first occurrence**. The serializer escapes only the
first comma in each element; the parser un-escapes only the first `\,` in the
whole string. The `, ` join separator and the `[^,]`-based split regex then
treat every remaining (unescaped) comma as an element boundary.

### Empirically confirmed data loss (Node repro)

```
['a,b','c']   -> 'a\,b, c'   -> ['a','b','c']     LOSS (one element -> three)
['a,b,c']     -> 'a\,b,c'    -> ['a','b','c']     LOSS (one element -> three)
['x,y,z']     -> 'x\,y\z'... -> ['x','y','z']     LOSS
['a,b','c,d'] -> 'a\,b, c\,d'-> ['a','b','c\\,d'] LOSS (and a stray backslash)
['plain','items'] -> 'plain, items' -> ['plain','items']   OK (comma-free)
```

Any element containing a comma fractures on round-trip. **Comma-free values
round-trip cleanly** — which is the overwhelmingly common case in a vault of
note paths, tag names, and short option labels.

### Where it bites (grounds the options)

`serializeMultiDisplayString` has ~12 call sites. They split into three risk
tiers:

1. **Paths / links — practically comma-safe.**
   `lookup.ts:33-39` (inlinks/outlinks/spaces are note **paths**),
   `LinkCell.tsx:37` and `ContextCell.tsx:64` — but **only on the non-`multi`
   branch**; both cells use the safe JSON `serializeMultiString` for `multi`
   values (`LinkCell.tsx:35`, `ContextCell.tsx:62`). Obsidian note paths do not
   normally contain commas, so these almost never trip the bug.

2. **Tags — low comma risk.** `lookup.ts:37`, `tags.ts:82`,
   `filesystem.ts:76/86/96` (tag add/rename/remove). Obsidian tags cannot
   contain commas, so the tag set is comma-free in practice; the risk is only if
   a non-tag string leaks into the list.

3. **Free-text-ish single values — the real exposure.** `label.ts:30`
   (primary alias — aliases are user free text and **can** contain commas),
   `optionCellModel.ts:33` (single-select option label), `parsers.ts:64`
   (duration `"N unit"` parts — comma-free by construction).

The `multi` (JSON) path is already safe everywhere it exists. The exposure is
therefore narrow: a **single** value (alias / option label / a path that somehow
contains a comma) written through the display form, then read back fractured.

### The load-bearing migration fact (why this is not pure logic)

The serializer has been writing the buggy form into the vault. A stored string
like `'a\,b, c'` is **currently displayed/used as `['a','b','c']`** by the
present parser. Verified empirically, the candidate fixed parser reads the same
stored bytes differently:

```
stored 'a\,b, c' :  OLD parser -> ['a','b','c']   NEW parser -> ['a,b','c']
stored 'a\,b,c'  :  OLD parser -> ['a','b','c']   NEW parser -> ['a,b','c']
stored 'x\,y\,z' :  OLD parser -> ['x','y\\,z']   NEW parser -> ['x,y,z']
stored 'plain, items' : OLD -> ['plain','items']  NEW -> ['plain','items']  (same)
```

So the fix is **not purely additive**. For comma-free values nothing changes
(the common case). But any value already containing an escaped comma changes its
read-back interpretation the moment the parser is fixed. That re-interpretation
is invisible to offline gates — it depends on what is actually in the owner's
vault — which is exactly why this is a queued decision, not an auto-merge.

### Currently-locked characterization (Notidian-a3s)

`src/utils/serializers.test.ts` deliberately **pins** the defect so any fix is a
conscious flip (header: "this is a CHARACTERIZATION net, not a correction"). The
assertions that the fix must flip:

- `:99-104` — "escapes only the FIRST comma per element": `['a,b']->'a\,b'`,
  `['a,b,c']->'a\,b,c'`.
- `:105-108` — canonical example `['a,b','c']->'a\,b, c'`.
- `:143-150` — round-trip data-loss: `['a,b','c']->['a','b','c']`,
  `['a,b,c']->['a','b','c']`.
- `:151-155` — parse un-escapes only the first `\,`:
  `'a\,b\,c'->['a','b\\,c']`.

Comma-free identity and the trim/empty-drop characterization (`:118-140`,
`:157-183`) stay green under every option below.

## Decision

**Recommended: Option A** — make **both** replaces global (escape every comma on
serialize, un-escape every `\,` on parse), and flip the locked characterization
assertions to assert correct round-tripping; close the loop with one eyes-on
vault confirm.

One-line why: the round-trip is then correct for *all* values, the change is
offline-provable except for the narrow, rare re-interpretation of
already-escaped-comma vault values (which a single eyes-on check settles), and
keeping the human-readable comma form preserves the existing wire format that
non-`multi` cells, lookup columns, and tag labels already read — no second
format, no migration of clean data.

### Options

#### Option A — Global escape, fix both sides (RECOMMENDED)

```ts
// serializers.ts
export const serializeMultiDisplayString = (value: string[]) =>
  value.map(f => f.replace(/,/g, '\\,')).join(', ');

// parsers.ts — move the un-escape AFTER the split, and make it global
export const parseMultiDisplayString = (str: string): string[] =>
  (ensureString(str).match(/(\\.|[^,])+/g) ?? [])
    .map(f => f.trim().replace(/\\,/g, ','));
```

Two changes, not one: (1) `/,/g` and `/\\,/g` make both sides global; (2) the
parser's un-escape must move **after** the `match` split (per-element), not
before — un-escaping the whole string first would turn `\,` back into `,` and
then the split regex would treat it as a separator again. The `(\\.|[^,])+`
regex already keeps `\,` inside one match; doing the un-escape per-element after
the split is the correct order. Verified empirically: all five LOSS cases above
round-trip to identity with this pair.

- **Pros:** correct round-trip for every value; **keeps the human-readable
  comma-joined display form** (the existing wire format — lookup columns,
  non-`multi` cells, tag labels, copy/paste all keep working unchanged for the
  common comma-free case); minimal, local, two-function diff; the
  comma-free-identity property net already guards the common path.
- **Cons:** changes the read-back of any **already-written** value containing an
  escaped comma (`'a\,b, c'` flips `['a','b','c']` -> `['a,b','c']`) — a
  vault-data re-interpretation offline gates can't see, so it needs one eyes-on
  confirm. The parser-order subtlety (un-escape after split) is a correctness
  trap a careless edit would get wrong; it must land with the flipped
  characterization tests as the guard. Must flip ~5 locked assertions.

#### Option B — Migrate display writes to the JSON form (`serializeMultiString`)

Route the at-risk non-`multi` writers (alias, single option/link/context) through
`serializeMultiString` (JSON, already comma/quote/backslash-safe, property-tested
in `serializers.test.ts`), matching what the `multi` branch already does. Readers
use `parseMultiString`, which already dispatches on a leading `[`.

- **Pros:** reuses an already-correct, already-tested serializer; one durable
  format; `parseMultiString` already auto-detects JSON vs legacy by the leading
  `[`, so old comma-form values still read via the legacy branch.
- **Cons:** **changes the on-disk/display representation** of single values from
  human-readable `a, b` to `["a","b"]` — visible in frontmatter and anywhere the
  raw cell value surfaces; a regression for the readability the display form
  exists to provide. The non-`multi` case is conceptually a *single* value, so
  wrapping it in a JSON array is a semantic mismatch (`["alias"]` vs `alias`).
  Touches more call sites than A and still leaves the legacy comma parser in the
  codebase for back-compat. Ruled out in favour of A unless the owner wants to
  retire the display form entirely.

#### Option C — Accept + document the limitation (zero churn)

Leave both functions as-is; expand the comment + the bead/ADR trail; keep the
characterization tests as the permanent record that this is known and accepted.

- **Pros:** zero behavior change, zero vault re-interpretation risk, no re-verify.
  Defensible because the exposure is genuinely narrow: a single-user vault where
  the comma-prone surfaces are paths/tags (comma-safe in practice) and the only
  real bite is a comma inside an alias or single-option label — rare.
- **Cons:** leaves a real **silent data-loss defect** on authority surfaces; a
  future feature that feeds comma-bearing free text through the display form
  (e.g. a free-text multi-cell) inherits the corruption with no guardrail beyond
  a comment. Documentation annotates the hazard without removing it.

### Ruled out

- **Option B** — JSON-encoding a *single* display value trades the readable
  comma form for `["x"]` in frontmatter and at every raw-value surface; that is a
  visible readability regression for the exact value type (a lone string) that
  least needs array encoding. Kept on the table only if the owner decides to
  retire the human-readable display form wholesale in favour of one JSON format
  everywhere — a larger product call than this bug.
- **Option C** — accepting a confirmed data-loss defect is acceptable only if the
  owner judges any vault re-interpretation too risky and the exposure too rare to
  warrant the fix. The recommendation is that A's correctness gain outweighs the
  narrow, eyes-on-settleable re-interpretation, since clean (comma-free) values —
  the vast majority — are byte-identical before and after.

## Consequences

- **If A (recommended):** the round-trip becomes correct for all values; the
  display form stays human-readable; ~5 locked characterization assertions flip
  to assert correctness; comma-free values are byte-identical (no migration of
  clean data); a single eyes-on vault check confirms that no real
  escaped-comma value is mis-read after the parser-order change. Tests, tsc,
  build must stay green; the comma-free-identity property net is the regression
  guard, and the flipped assertions guard the parser-order trap.
- **If B:** single display values become JSON arrays on disk; at-risk writers
  route through `serializeMultiString`; old comma-form values keep reading via
  the legacy branch; the display form's readability is lost for those fields.
- **If C:** nothing changes; the defect persists as a documented, accepted
  limitation; the bead closes as "known + accepted" rather than fixed.
- Whichever lands, it must **flip** the Notidian-a3s locked characterization
  assertions deliberately (not silently) — the net exists precisely so the fix is
  a conscious, reviewed change.

## The one decision the owner needs to make

**Pick A, B, or C** (recommended **A** — make both comma replaces global, move
the parser un-escape to after the split, flip the locked assertions, keep the
human-readable display form). On a pick, the implementing session applies it; the
comma-free-identity property net + the flipped characterization tests guard the
change offline, and a single eyes-on vault check confirms no real
escaped-comma value is mis-read.
