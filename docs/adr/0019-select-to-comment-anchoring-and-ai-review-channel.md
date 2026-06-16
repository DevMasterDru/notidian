# ADR 0019: Select-to-Comment — Anchor Format and the AI-Review Comment Channel

## Status

Parked — build when the owner asks.

Parked to [docs/ROADMAP.md](../ROADMAP.md): the owner validates by using the tool
and has not asked to build this. This ADR is retained as grounding reference for
the chosen anchor/format design if/when the owner requests the feature.

Tracked by bd `Notidian-o4w`. This ADR was written instead of building the
feature blind, because the product/UX design is genuinely open and a wrong-format
build would have to be re-done across two repos (Notidian writes the format; the
Atlasidian parser reads it).

## Date

2026-06-15

## Context

The owner asked (2026-06-11, from the first Atlasidian ADR-206 review page): select
text or a section in a note → a popup menu appears → a **Comment** option, like
Notion. The comment anchors to the selection. Two modes:

1. **General vault commenting** — human margin notes on any note.
2. **AI-directed review** — in pages with `type: review` (the Atlasidian ADR-206
   review-page convention), a comment is **directed to the AI**. The review
   read-back (Atlasidian-69c `review.verdicts` parser, future v3 native review UI
   Atlasidian-j0q) consumes the comment as feedback on the anchored block.

Until this ships, the fallback is inline indented bullets plus direct text edits,
which the owner finds inconvenient — that inconvenience is the origin of this work.

### Where this lands in the code

Notidian already owns the editor-side selection popup: the **inline styler**
(`src/basics/menus/inlineStylerView/inlineStyler.tsx` →
`InlineMenuComponent` in `InlineMenu.tsx`) is a CodeMirror `cursorTooltip` that
renders on every non-empty selection. It already has a **"blocklink"** action
(`enactor.selectLink`) that uses Obsidian's native `^block` reference convention.
A **Comment** action is a sibling of that button — the popup, the selection
geometry, and a block-anchoring precedent already exist. This is editor-UX
surface, which is Notidian's domain; Atlasidian stays the MCP/server side.

### Constraints (what any design must respect)

- **C1 — File/frontmatter authority (ADR 0014, ADR 0017).** Ordinary note data is
  canonical in Markdown files and frontmatter. The hidden `.notidian` context MDB
  may own only **explicitly Notidian-owned** fields and view-state. A comment is
  ordinary, portable, human-meaningful note content → it must be **file-canonical**
  (visible in the `.md`, survives outside Notidian, diff-able in git). It must
  **not** live silently in the MDB. ADR 0017 is explicit: a missing marker resolves
  toward the visible file layer, never the hidden store.
- **C2 — Durability across edits.** The anchor binds a comment to a text selection;
  it must survive ordinary editing of surrounding text and degrade gracefully (a
  clearly "orphaned" state) rather than silently mis-pointing when the anchored
  text is deleted or rewritten.
- **C3 — Cross-repo contract.** Whatever format Notidian writes for **AI-review**
  comments, the Atlasidian-69c v2 parser must parse it deterministically without a
  Notidian runtime. Format stability matters more than richness; a churny format
  forces lockstep releases of two repos.
- **C4 — Obsidian-native legibility.** The note must remain valid, readable
  Obsidian Markdown when opened without Notidian. Anchors should reuse Obsidian
  conventions where one exists, not invent a parallel syntax Obsidian renders as
  garbage.
- **C5 — Two modes, one anchor.** The anchor mechanism (how a comment binds to a
  selection) should be shared by both modes; only the **comment payload/destination**
  differs (general margin note vs AI-directed review entry).

## Decision (proposed)

Two coupled choices: **(a)** how a comment anchors to a selection, and **(b)** the
on-disk format for AI-review comments that the Atlasidian parser consumes.

### (a) Anchor representation

**Recommended: Obsidian block-id anchor (`^block`), reused from the existing
blocklink path.**

When a user comments on a selection, Notidian ensures the anchored block carries a
stable Obsidian block id (`^abc123` appended to the block, generated if absent —
exactly what the existing blocklink action already does), and the comment records
that block id as its anchor. For a sub-block (word/phrase) selection, the anchor is
`blockId` plus an optional quoted snippet of the selected text for disambiguation
and orphan detection.

Reasons (one line each):

- **Reuses an existing, proven mechanism** — the blocklink action already mints and
  uses `^block` ids in this exact popup; no new anchor subsystem.
- **Obsidian-native and durable (C2, C4)** — block ids are stable identifiers
  Obsidian itself maintains across edits and renders cleanly; offsets do not.
- **Diff-friendly and file-canonical (C1)** — the id lives in the file next to its
  block; the comment references it by name, not by fragile byte position.

### (b) AI-review comment format (the Atlasidian-parsed channel)

**Recommended: frontmatter-canonical `review.comments` list keyed by block-id
anchor, in `type: review` pages.**

In a `type: review` page, an AI-directed comment is stored as a structured entry in
the page's **YAML frontmatter** (the layer Atlasidian already reads for review
pages), e.g.:

```yaml
type: review
review:
  comments:
    - anchor: "^abc123"          # block-id anchor (choice a)
      quote: "the overstated guarantee"   # optional selected-snippet, for orphan detection
      body: "This claim is too strong — cite the vault scan."
      by: human
      ts: 2026-06-15T10:00:00Z
      status: open               # open | resolved | orphaned
```

Reasons (one line each):

- **One authority, parser already there (C1, C3)** — Atlasidian's review read-back
  already parses review-page frontmatter; `review.comments` is a sibling of
  `review.verdicts`, so the parser extends rather than learns a second surface.
- **Structured + stable (C3)** — a typed YAML list is deterministically parseable
  without a Notidian runtime and versions cleanly; no inline-syntax ambiguity.
- **Anchor-shared (C5)** — the `anchor` field carries the choice-(a) block id, so
  general margin notes and AI-review entries bind to selections the same way.

General (mode 1) margin notes use the **same block-id anchor** but a lighter
payload — an Obsidian-native inline comment (`%%comment%%`) or a callout adjacent
to the block — because they are read by humans in Obsidian, not by the parser, and
do not need the structured frontmatter contract. (Which of the two human surfaces
is a minor follow-up, not a blocking decision.)

### Optional default-OFF spike (de-risks, does not pre-commit)

A minimal spike that materially reduces decision risk, behind a **default-OFF**
`selectToComment` setting: add a **Comment** button to the inline styler that, for
AI-review pages, appends one `review.comments` entry (block-id anchor + body) to
frontmatter via the existing authority-aware frontmatter write path — no read-back
UI, no resolve/orphan lifecycle. This proves the anchor mint + frontmatter round-
trip and gives Atlasidian-69c a real sample to parse, without shipping a half-built
UX. It is **not** included in this ADR's change (no production code here); it is
offered as the recommended first implementation step **after** the owner picks (a)
and (b).

## Options considered

### (a) Anchor representation

| Option | How it binds | Durability (C2) | Obsidian-native (C4) | Verdict |
| --- | --- | --- | --- | --- |
| **A1. Obsidian block-id `^block`** *(recommended)* | comment references a block id minted on the anchored block | High — Obsidian maintains ids across edits | Yes — existing convention, renders clean | **Chosen** |
| A2. Character offset range (from/to) | comment stores `[from,to]` byte/char offsets | Low — any earlier edit shifts every offset | No — invisible in file, Notidian-only meaning | Ruled out |
| A3. Fenced/inline marker pair wrapping the text | insert `%%c:id%% … %%/c%%` (or HTML spans) around the selection | Medium — survives edits but mutates user text, fragile on partial deletes | Partial — `%%` is Obsidian comment syntax but pollutes the prose | Ruled out as the primary anchor |

### (b) AI-review comment format

| Option | Authority | Parser cost (C3) | Verdict |
| --- | --- | --- | --- |
| **B1. Frontmatter `review.comments` list** *(recommended)* | Frontmatter (file-canonical, C1) | Low — sibling of `review.verdicts`, already parsed | **Chosen** |
| B2. Sidecar `.notidian` comment store | Hidden MDB | N/A — violates C1; parser needs Notidian runtime | Ruled out |
| B3. Inline indented bullets / `%%` comments in the body | File body text | High — free-text, ambiguous to parse deterministically; this is the status-quo fallback the owner rejected | Ruled out for the AI channel |

## Ruled-out options (and why)

- **A2 — offset-range anchors.** Rejected: offsets break on the first surrounding
  edit (fails C2) and are Notidian-private (fails C1/C4). They would re-introduce
  exactly the fragile, invisible binding the file-canonical model exists to avoid.
- **A3 — marker-pair anchors as the primary mechanism.** Rejected as primary: it
  mutates the user's prose, is fragile under partial-selection deletes, and gives
  two ways to bind a comment. Kept only as a candidate **human-margin-note**
  surface (mode 1), where `%%…%%` is legitimately Obsidian-native and read by
  humans, not the parser.
- **B2 — sidecar `.notidian` store.** Rejected: it directly violates ADR 0014/0017
  (comments are ordinary, portable note data, not Notidian-only fields), hides
  human-meaningful content from git/Obsidian, and forces the Atlasidian parser to
  depend on a Notidian runtime to read review feedback (fails C1, C3).
- **B3 — free-text inline bullets for the AI channel.** Rejected: this is the
  current fallback the owner finds inconvenient; free text is not deterministically
  parseable, so the read-back contract (C3) would be brittle. (It remains fine as a
  *human* convenience, just not as the machine-consumed review format.)

## Consequences

If accepted:

- Notidian gains a **Comment** action in the existing inline styler, sharing the
  blocklink anchor machinery; AI-review comments land in `review.comments`
  frontmatter through the authority-aware write path (no new authority surface).
- Atlasidian-69c v2 parser gets a stable, typed format to add alongside
  `review.verdicts`; the cross-repo contract is one YAML key, versioned with the
  review-page schema.
- A new lifecycle surfaces to design later (resolve/orphan handling, the read-back
  UI in Atlasidian-j0q), but the **anchor + storage** decision this ADR settles is
  the load-bearing, hard-to-reverse part; the rest is incremental UX.

Tradeoffs:

- Block-id anchors disambiguate at block granularity; sub-block (word-level)
  precision relies on the optional `quote` snippet for display/orphan detection,
  not on exact character pointing. This is an accepted simplification (Notion-style
  highlights are precise; this is one notch coarser but far more durable).
- Frontmatter grows with comment count on heavily-reviewed pages; acceptable for
  review pages (which are transient and small), and resolved comments can be
  archived/pruned by the read-back side.

## Relationship to other ADRs / cross-repo

- Honors **ADR 0014** (Notidian-only engine; ordinary data canonical in
  files/frontmatter) and **ADR 0017** (no silent MDB ownership — comments are
  file-canonical, the MDB is not their home).
- Reuses the inline-styler popup and `^block` blocklink precedent already in
  `src/basics/menus/inlineStylerView/`.
- Cross-repo: **Atlasidian ADR-206** (review-page convention), **Atlasidian-69c**
  (v2 review parser — must parse `review.comments`), **Atlasidian-j0q** (v3 native
  review UI — consumer of the read-back). The format chosen here is the contract
  those Atlasidian items parse; it should not change without coordinating that repo.

## The one decision needed from the owner

Approve the pair **(a) block-id `^block` anchor + (b) frontmatter
`review.comments` list** as the format Notidian writes and the Atlasidian parser
reads — and say whether to land the default-OFF `selectToComment` spike as the
first implementation step. If the owner prefers a different anchor or format, that
choice propagates to the Atlasidian parser work, so it is settled here first.
