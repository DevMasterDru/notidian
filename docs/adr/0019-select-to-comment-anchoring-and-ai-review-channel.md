# ADR 0019: Select-to-Comment — Anchor Format and the AI-Review Comment Channel

## Status

Accepted — owner pulled 2026-07-10; v1 cross-repo contract confirmed 2026-07-15.

The owner directive to "finalize all open features in Notidian" ratified the
recommended pair: Obsidian `^block` anchors and file-canonical structured comment
lists, with `review.comments` as the AI-directed channel. bd `Notidian-tluq.1`
freezes the exact v1 payload and producer/consumer seams below. Implementation is
tracked by `Notidian-tluq.2` (Notidian authoring) and `Notidian-tluq.3`
(Atlasidian consumption).

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
(`enactor.selectLink`), but code verification on 2026-07-15 corrected an earlier
assumption: that action opens a file picker and wraps the selection in a wiki
link; it does **not** mint an Obsidian block id. A **Comment** action is still a
sibling of that button — the popup and selection geometry already exist — while
block-id creation is new, syntax-aware logic that S2 must test. This is editor-UX
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

## Decision

Two coupled choices: **(a)** how a comment anchors to a selection, and **(b)** the
on-disk format for AI-review comments that the Atlasidian parser consumes.

### (a) Anchor representation

**Accepted: Obsidian block-id anchor (`^block`).**

When a user comments on a selection, Notidian ensures the Markdown block containing
the selection start carries a stable Obsidian block id (`^abc123`, reusing an
existing valid id or generating a collision-free one), and the comment records
that block id as its anchor. For word-, phrase-, or multi-block selections, the
anchor stays block-granular and `quote` records the selected text for display and
orphan/change detection. This is the accepted precision tradeoff; v1 never stores
character offsets.

Reasons (one line each):

- **Reuses an Obsidian-native mechanism** — the popup and selection state already
  exist, while a small new helper owns valid `^block` discovery/insertion.
- **Obsidian-native and durable (C2, C4)** — block ids are stable identifiers
  Obsidian itself maintains across edits and renders cleanly; offsets do not.
- **Diff-friendly and file-canonical (C1)** — the id lives in the file next to its
  block; the comment references it by name, not by fragile byte position.

### (b) AI-review comment format (the Atlasidian-parsed channel)

**Accepted: frontmatter-canonical `review.comments` list keyed by block-id
anchor, in `type: review` pages.**

In a `type: review` page, an AI-directed comment is stored as a structured entry in
the page's **YAML frontmatter** (the layer Atlasidian already reads for review
pages), e.g.:

```yaml
type: review
review:
  comments_version: 1
  comments:
    - id: cmt-k3m9x2p7q4
      anchor: "^abc123"
      quote: "the overstated guarantee"
      body: "This claim is too strong — cite the vault scan."
      by: human
      ts: 2026-07-15T10:00:00.000Z
      status: open
```

Reasons (one line each):

- **One authority, parser already there (C1, C3)** — Atlasidian's review read-back
  already parses review-page frontmatter; `review.comments` is a sibling of
  `review.verdicts`, so the parser extends rather than learns a second surface.
- **Structured + stable (C3)** — a typed YAML list is deterministically parseable
  without a Notidian runtime and versions cleanly; no inline-syntax ambiguity.
- **Anchor-shared (C5)** — the `anchor` field carries the choice-(a) block id, so
  general margin notes and AI-review entries bind to selections the same way.

General (mode 1) comments use the same `CommentV1` entry under top-level
`comments_version: 1` + `comments: [...]`. This supersedes the earlier
inline-comment/callout suggestion: one structured frontmatter record is easier to
update without mutating prose, remains file-canonical and Obsidian-legible, and
lets the Notidian UI render a consistent margin-note surface. No comment fact is
duplicated into the body or `.notidian`.

### Binding `CommentV1` contract

The two destinations carry the same entry shape:

| Field | v1 contract |
| --- | --- |
| `id` | Required unique `cmt-` machine id; immutable after creation. |
| `anchor` | Required Obsidian block id including `^`; exactly one matching id must exist in the body. |
| `quote` | Required non-empty selected text with line endings normalized to LF; display/orphan evidence, never a retargeting authority. |
| `body` | Required non-empty comment text. It is rendered as text/Markdown through the repository sanitizer boundary, never as raw HTML. |
| `by` | Required author token; v1 authoring writes `human`. |
| `ts` | Required UTC ISO-8601 creation instant; immutable. |
| `status` | Required `open | resolved`. Orphan state is derived, not stored over the lifecycle state. |

The enclosing `comments_version` is required and must equal numeric `1`. Unknown
versions fail closed. Readers may ignore unknown entry keys, but writers must
preserve them when appending or updating so a newer producer is not destructively
downgraded.

### Dispatch and lifecycle

- At creation time, `frontmatter.type === "review"` dispatches to
  `review.comments`; every other note dispatches to top-level `comments`. There is
  no per-comment mode prompt. Changing a note's `type` later does not silently move
  existing comments; their current list remains canonical until an explicit
  migration exists.
- The selection-start Markdown block owns the anchor. Reuse a valid existing block
  id; otherwise mint a collision-free `^c-...` id at an Obsidian-valid block-id
  position. Selections in YAML frontmatter or another syntax region where a valid
  block id cannot be inserted are rejected with no write.
- Writes are ordered fail-closed: insert/verify the harmless body block id first,
  then append the frontmatter entry. If the frontmatter write fails, the block id
  may remain but no dangling comment record exists. Existing entries and unknown
  keys are preserved.
- Anchor resolution has three read-time states: `attached` (one anchor match and
  the normalized anchored text still contains `quote`), `changed` (one anchor
  match but quote evidence no longer matches), and `orphaned` (zero or multiple
  anchor matches). A unique quote elsewhere may be reported as a re-anchor
  candidate, but neither Notidian nor Atlasidian auto-retargets or mutates the
  stored `status`.
- Atlasidian consumes only `type: review` + `review.comments_version: 1` +
  `review.comments`. General `comments` are never interpreted as AI instructions.
  Malformed entries return stable invalid-entry reason codes and are excluded from
  executable verdicts; one bad entry does not discard valid siblings.

### Producer, consumer, and fixture seams

- **Notidian producer UI:**
  `src/basics/menus/inlineStylerView/inlineStyler.tsx` and `InlineMenu.tsx`.
- **Notidian pure contract/anchor helpers:** new
  `src/core/utils/comments/commentContract.ts` and
  `src/basics/menus/inlineStylerView/commentAnchor.ts`; nested frontmatter writes
  route through `src/core/utils/properties/frontmatterWrite.ts` via
  `MakeBasicsPlugin.plugin.superstate`, never directly to the MDB.
- **Notidian gate:** top-level `settings.selectToComment`, default **ON** because
  the owner requested the feature, retained as an OFF kill-switch. S2 must pin the
  settings type, default, sanitization, pure contract, and jsdom authoring flow.
- **Atlasidian consumer:** add `review` to `src/tools/tool-surface.ts`, route it in
  `src/semantic/router.ts`, and keep parsing/resolution in a pure
  `src/semantic/operations/review.ts` module with fixtures beside its tests.
  `src/tools/semantic-tools.ts` remains the MCP edge and the brochure is regenerated
  from the tool surface after implementation.
- **Shared fixtures:** the canonical YAML/body examples live in Notidian under
  `src/core/utils/comments/__fixtures__/`; S3 copies the fixture bytes into the
  Atlasidian test tree with the fixture version and source commit recorded. Runtime
  code does not create a cross-repo dependency.

The fixture manifest must pin these v1 outcomes:

| Fixture | Notidian result | Atlasidian `review.verdicts` result |
| --- | --- | --- |
| General note, valid attached entry | Render as a general comment | Ignore; never an AI instruction |
| Review note, valid attached entry | Render as AI-directed | One executable structured comment, `anchor_state: attached` |
| Review note, one anchor but quote changed | Render with changed warning | Include as non-executable feedback, `QUOTE_CHANGED` |
| Review note, anchor absent | Render orphan warning | Include as non-executable feedback, `ANCHOR_NOT_FOUND` |
| Review note, duplicate anchor id in body | Render orphan warning | Include as non-executable feedback, `ANCHOR_AMBIGUOUS` |
| Review note, valid + malformed sibling | Render valid sibling and invalid diagnostic | Keep valid sibling; reject only malformed entry with its field code |
| Comment list present, version absent/unsupported | Do not interpret list | Fail closed with `MISSING_COMMENTS_VERSION` / `UNSUPPORTED_COMMENTS_VERSION` |
| Version 1 with non-array `comments` | Do not interpret value | Fail closed with `COMMENTS_NOT_ARRAY` |

Malformed-entry field codes are `INVALID_ID`, `DUPLICATE_COMMENT_ID`,
`INVALID_ANCHOR`, `INVALID_QUOTE`, `INVALID_BODY`, `INVALID_AUTHOR`,
`INVALID_TIMESTAMP`, and `INVALID_STATUS`. These tokens are part of the v1 wire
contract; human-facing wording may vary without a version bump.

### Implementation posture

S2 ships the owner-requested authoring flow default-ON behind the kill-switch,
with unit/jsdom coverage, deploy-to-vault, reload, DOM/error checks, and owner-use
verification. It is not a default-OFF spike: the owner pull has already settled
the product direction.

## Options considered

### (a) Anchor representation

| Option | How it binds | Durability (C2) | Obsidian-native (C4) | Verdict |
| --- | --- | --- | --- | --- |
| **A1. Obsidian block-id `^block`** *(accepted)* | comment references a block id minted on the anchored block | High — Obsidian maintains ids across edits | Yes — existing convention, renders clean | **Chosen** |
| A2. Character offset range (from/to) | comment stores `[from,to]` byte/char offsets | Low — any earlier edit shifts every offset | No — invisible in file, Notidian-only meaning | Ruled out |
| A3. Fenced/inline marker pair wrapping the text | insert `%%c:id%% … %%/c%%` (or HTML spans) around the selection | Medium — survives edits but mutates user text, fragile on partial deletes | Partial — `%%` is Obsidian comment syntax but pollutes the prose | Ruled out as the primary anchor |

### (b) AI-review comment format

| Option | Authority | Parser cost (C3) | Verdict |
| --- | --- | --- | --- |
| **B1. Frontmatter `review.comments` list** *(accepted)* | Frontmatter (file-canonical, C1) | Low — sibling of `review.verdicts` in the agreed review-page schema | **Chosen** |
| B2. Sidecar `.notidian` comment store | Hidden MDB | N/A — violates C1; parser needs Notidian runtime | Ruled out |
| B3. Inline indented bullets / `%%` comments in the body | File body text | High — free-text, ambiguous to parse deterministically; this is the status-quo fallback the owner rejected | Ruled out for the AI channel |

## Ruled-out options (and why)

- **A2 — offset-range anchors.** Rejected: offsets break on the first surrounding
  edit (fails C2) and are Notidian-private (fails C1/C4). They would re-introduce
  exactly the fragile, invisible binding the file-canonical model exists to avoid.
- **A3 — marker-pair anchors as the primary mechanism.** Rejected: it mutates the
  user's prose, is fragile under partial-selection deletes, and gives two ways to
  bind a comment. General comments use the same structured `CommentV1` entry under
  top-level frontmatter, not a second inline representation.
- **B2 — sidecar `.notidian` store.** Rejected: it directly violates ADR 0014/0017
  (comments are ordinary, portable note data, not Notidian-only fields), hides
  human-meaningful content from git/Obsidian, and forces the Atlasidian parser to
  depend on a Notidian runtime to read review feedback (fails C1, C3).
- **B3 — free-text inline bullets for the AI channel.** Rejected: this is the
  current fallback the owner finds inconvenient; free text is not deterministically
  parseable, so the read-back contract (C3) would be brittle. (It remains fine as a
  *human* convenience, just not as the machine-consumed review format.)

## Consequences

When implemented:

- Notidian gains a **Comment** action in the existing inline styler plus new
  block-id insertion logic; AI-review comments land in `review.comments` and
  general comments in top-level `comments`, both through the file-authority write
  path (no new MDB authority surface).
- Atlasidian-69c v2 parsing gets a stable, versioned `CommentV1` fixture to consume
  alongside checkbox, edit-diff, and existing indented-comment verdict inputs.
- Resolve is a stored lifecycle transition; `changed`/`orphaned` are derived anchor
  states. A future richer Atlasidian-j0q UI can render the same contract without a
  data migration.

Tradeoffs:

- Block-id anchors disambiguate at block granularity; sub-block (word-level)
  precision relies on the required `quote` evidence for display/orphan detection,
  not on exact character pointing. This is an accepted simplification (Notion-style
  highlights are precise; this is one notch coarser but far more durable).
- Frontmatter grows with comment count. Resolved comments remain canonical until
  an explicit user action archives or deletes them; readers never prune on read.

## Relationship to other ADRs / cross-repo

- Honors **ADR 0014** (Notidian-only engine; ordinary data canonical in
  files/frontmatter) and **ADR 0017** (no silent MDB ownership — comments are
  file-canonical, the MDB is not their home).
- Reuses the inline-styler popup in `src/basics/menus/inlineStylerView/`; the
  `^block` insertion helper is deliberately new because the existing blocklink
  action is only a file-link picker.
- Cross-repo: **Atlasidian ADR-206** (review-page convention), **Atlasidian-69c**
  (v2 review parser — must parse `review.comments`), **Atlasidian-j0q** (v3 native
  review UI — consumer of the read-back). The format chosen here is the contract
  those Atlasidian items parse; it should not change without coordinating that repo.

## Ratification record

The 2026-07-10 owner pull ratified the recommended block-id + structured
frontmatter direction and required implementation rather than a parked spike.
Session `Notidian-tluq.1` confirmed the versioned payload, dispatch, orphan, and
cross-repo seams on 2026-07-15. No owner-value question remains in S2/S3; a future
request to change anchor or storage shape must amend this ADR and coordinate both
repos.
