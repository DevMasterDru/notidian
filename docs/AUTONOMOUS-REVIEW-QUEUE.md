# Autonomous Review Queue

This file is the owner's review surface for the autonomous implementation drive
(see [AGENTS.md](../AGENTS.md) → "Autonomous Implementation Mode"). The autonomous
loop appends here so nothing it could not fully verify itself drifts unseen.

Two kinds of entries, both **awaiting the owner**:

- **Flag-gated change** — a core render-path / not-offline-verifiable change that
  shipped behind a **default-OFF** setting. It needs the owner to enable the flag
  and live-verify in the vault before it counts as done.
- **Decision (ADR)** — a design-open feature the loop refused to build blind;
  instead it produced a Proposed ADR with options + a recommendation. It needs the
  owner to pick a direction; then the loop (or a session) implements it.

The loop bounds outstanding flag-gated changes (default cap: 4) before it stops
queueing more and pivots to safe work — so this list stays reviewable.

---

## Pending — flag-gated (enable + live-verify)

### Notidian-vke — Frame-execution sink hardening (trust boundary + frame-text sanitization)

- **Setting:** `hardenFrameExecution` (default `false`) — `src/shared/types/settings.ts`,
  defaulted in `src/core/schemas/settings.ts`.
- **Why gated:** both sinks are on the core render path — `SpaceOuter` *always*
  frame-renders every space (ADR 0018 / `frames-runtime-is-load-bearing` memory),
  so correctness cannot be proven by tsc/jest/build alone. Shipped OFF so the
  owner's current vault is byte-for-byte unchanged until enabled.
- **What it does when ON:**
  1. **Frame-text sanitization** — `TextNodeView`'s `dangerouslySetInnerHTML` of
     frame text is routed through the new `sanitizeFrameText` (`src/shared/utils/sanitize.ts`),
     a DOM-based sanitizer that strips `script`/`on*`/dangerous-URL/fetch elements
     but **keeps formatting tags** (it cannot use `escapeHtml`: `onBlur` reads
     `e.target.innerHTML`, so escaping would double-escape and break formatting).
  2. **`new Function` trust boundary** — the prop/style evaluator
     (`src/core/utils/frames/runner.ts`) withholds `$api` from **user/imported**
     frame nodes. Trust is decided by genuine, **non-persisted provenance**
     (`src/core/utils/frames/trust.ts`): a node keeps `$api` only if its code was
     resolved from a `superstate.kit` entry at expansion time (`ast.ts`
     `getFrameNodesByPath` `$kit` branch) and stamped with a module-private,
     non-enumerable, Symbol-keyed marker. Trust is **not** derived from
     `node.ref` — that is a persisted, attacker-controllable column, so a forged
     `spaces://$kit/` ref on a stored/imported row does **not** confer trust (the
     fix for the silent-on-render RCE the ref-based check left open). Plugin-shipped
     kit frames keep `$api` (they require it — `list`/`calendar`/`ui` kits call
     `$api.path.label`/`$api.date.*` in **props and styles**, so the bead's "no
     default prop/style needs $api" assumption was *refuted*; a blanket gate would
     break default rendering). User-triggered **actions** keep `$api` regardless
     (they are not part of the always-on render).
- **How to enable:** set `hardenFrameExecution: true` in the plugin's data.json
  (Notidian settings) or via the settings UI once a toggle is added.
- **What to live-verify in the vault (the part gates can't cover):**
  - Open several spaces (list view, card/column view, calendar view, detail
    view) with the flag ON — default rendering must be **unchanged** (covers/
    stickers/colors/dates still resolve, since default-kit nodes keep `$api`).
  - Edit a frame **text** node (type, bold/italic, paste formatted text), blur,
    reopen — formatting must round-trip losslessly (sanitizer keeps formatting).
  - Confirm a user-authored dynamic frame that relies on `$api` in a prop/style
    now no-ops that expression (expected: the trust-boundary tradeoff per ADR
    0018 — such frames must be re-classified as trusted or use actions). If this
    breaks a frame the owner actually uses, that is the signal to refine the
    trust model (e.g. an allowlist of vault-trusted frames) before enabling.
- **Offline evidence already in place:** `src/shared/utils/sanitizeFrameText.dom.test.ts`
  (jsdom, formatting-kept + dangerous-stripped + idempotent round-trip) and
  `src/core/utils/frames/trustBoundary.test.ts` (flag OFF = legacy; flag ON =
  `$api` withheld from untrusted props/styles, kept for trusted nodes + actions;
  cross-node isolation). Full suite + tsc + build green.
- **Primary import vector already closed:** the `.mkit` installer is disabled by
  default (Notidian-409 / ADR 0018), so untrusted frame *delivery* is already
  blocked; this bead hardens the *execution* sink as defence-in-depth.

### Notidian-bnb — Remove dead MKit preview runtime from core SpaceManagerContext

- **Setting:** `removeMKitPreviewRuntime` (default `false`) —
  `src/shared/types/settings.ts`, defaulted in `src/core/schemas/settings.ts`.
- **Why gated:** `SpaceManagerContext` is a core render-path context (consumed by
  `SpaceView`, `MDBFileViewer`, `inlineContextLoader`, `NavigatorView`,
  `EverLeafView`, `ContextExplorerLeafView`, `SpaceFragmentViewComponent`,
  `FileView`, `markdownPost`) with no offline render coverage, so a deletion's
  render-correctness cannot be proven by tsc/jest/build. Shipped OFF so the
  owner's vault is byte-for-byte unchanged until enabled and live-verified.
- **What changed (unconditional, behavior-preserving):** deleted
  `src/core/react/context/MKitContext.tsx` (~645 LOC) and the
  `MKitSpaceManagerProvider` it mounted. These were a **circular import**
  (`SpaceManagerContext` imported `useMKitPreviewContext`; `MKitContext`
  imported `MKitSpaceManagerProvider`). The only thing that ever mounted a real
  `MKitProvider` was the `.mkit` installer (`MKitFileViewer`), **already removed
  in Notidian-ala** — so with no provider mounted, `useMKitPreviewContext()`
  always returned the inert `createContext` default (`isPreviewMode:false`) and
  **every `mkit://preview/` branch in the non-MKit `SpaceManagerProvider` was
  already dead at runtime.** The core provider now reads a **local inert MKit
  default** (`INERT_MKIT_PREVIEW_CONTEXT`) that reproduces those exact runtime
  values, so the deletion changes nothing the provider observes. The public
  SpaceManager value still carries `isPreviewMode`/`isMKitPath`/
  `convertMKitPath`/`getContextsIndexMap` (external consumers — `SpaceContext`,
  `PathCrumb`, `SpaceFragmentView` — read `spaceManager.isPreviewMode`), all
  evaluating to the same inert non-preview values as before.
- **What the flag controls:** only whether the now-orphaned-but-inert mkit
  branches are still *present* in the core provider.
  - `false` (default): branches present, fed by the local inert default —
    identical runtime values to today.
  - `true`: the MKit context is forced `null` and the branches short-circuit
    (functionally identical, since the branches were already dead; this is the
    clean end state to live-verify before the residual branches are pruned in a
    follow-up).
- **How to enable:** set `removeMKitPreviewRuntime: true` in the plugin's
  data.json (Notidian settings), reload, and live-verify in the vault.
- **What to live-verify in the vault (the part gates can't cover):**
  - With the flag **ON**, open several spaces in **list, card/column, calendar,
    and detail views** — rendering must be **unchanged** (covers/stickers/colors,
    context tables, frame data, inline contexts, path crumbs, embedded space
    fragments all still resolve through the normal `superstate.spaceManager`
    path).
  - Toggle the flag **OFF → ON → OFF** on the same spaces — behavior must be
    indistinguishable in all three states (the offline tests assert this for the
    SpaceManager API; the eyes-on check confirms the rendered output).
  - Confirm navigation/context-menus still work (`PathCrumb` no longer suppresses
    them, since `isPreviewMode` is false either way).
- **Offline evidence already in place:**
  `src/core/react/context/SpaceManagerContext.deadMKit.dom.test.tsx` (jsdom,
  renders the real provider under both flag states: full API shape stable,
  `isPreviewMode` false, read/resolve/pathState delegate to
  `superstate.spaceManager`, OFF/ON observable-equivalence) and
  `src/core/react/context/deadMKitRemoval.guard.test.ts` (static: `MKitContext.tsx`
  is deleted; no source imports `./MKitContext` or references the removed symbols
  in code — the circular import cannot return). Full suite (1142 tests) + tsc +
  build green.

## Pending — decisions (pick a direction)

### Notidian-o4w — Select-to-comment: anchor format + AI-review comment channel

- **ADR:** [docs/adr/0019-select-to-comment-anchoring-and-ai-review-channel.md](adr/0019-select-to-comment-anchoring-and-ai-review-channel.md) (Status: Proposed).
- **Why a decision, not a build:** the product/UX is genuinely open and the chosen
  format is a **cross-repo contract** — Notidian writes it, the Atlasidian-69c v2
  parser must read it (Atlasidian ADR-206 review pages, Atlasidian-j0q v3 UI). A
  wrong-format blind build would have to be redone across both repos.
- **The one decision you need to make:** approve the recommended pair —
  **(a)** anchor a comment with an Obsidian **block id (`^block`)**, reusing the
  existing inline-styler "blocklink" path; **(b)** store AI-directed comments as a
  frontmatter **`review.comments`** list keyed by that anchor (sibling of
  `review.verdicts`), file-canonical per ADR 0014/0017. Ruled out: offset-range and
  marker-pair anchors; sidecar-`.notidian` and free-text-bullet storage (the
  current fallback you find inconvenient).
- **Also decide:** whether to land a **default-OFF `selectToComment` spike** (a
  Comment button that appends one `review.comments` entry via the authority-aware
  frontmatter write — no read-back UI) as the first implementation step, to give
  Atlasidian-69c a real sample to parse.
- **If you pick a different anchor/format,** that choice propagates to the
  Atlasidian parser work, so it is settled here before either side builds.
- **Bead status:** Notidian-o4w stays **OPEN**, awaiting your direction.

### Notidian-5io — Date reminders + recurring events: delivery + recurrence materialization

- **ADR:** [docs/adr/0020-date-reminders-and-recurring-events.md](adr/0020-date-reminders-and-recurring-events.md) (Status: Proposed).
- **Why a decision, not a build:** both halves are runtime/render/notification
  concerns no offline gate can prove correct, and the bead itself says "these are
  design decisions for the user." A blind build risks notification spam, coupling to
  a third-party plugin, or exploding the vault with one file per occurrence — all
  expensive to undo.
- **The one decision you need to make:** approve the recommended pair —
  **(a)** deliver reminders via a **default-OFF load-time + coarse-interval scan that
  fires `superstate.ui.notify` (Obsidian Notice)**, fired-once-on-next-open for
  reminders that came due while Obsidian was closed, **no external reminders
  plugin**; **(b)** materialize recurrence as a **single canonical row carrying an
  rrule-shaped `repeat` frontmatter rule, expanded at render time** (generalizing the
  expander the calendar views *already* run — `RRule.between` over `freq`/`interval`/
  `byweekday`/`count`/`until`/`wkst`), **never generated rows**. Both keep `due`/
  `repeat`/`reminder` file-canonical per ADR 0014/0017. Ruled out: delegating to an
  external reminders plugin; edit-time-only Notice; one-file-per-occurrence rows.
  Deferred (not rejected): sparse exception/override rows for per-occurrence edits.
- **Also decide (minor, can defer):** the exact frontmatter key names/shape (proposed
  in the ADR — `repeat:` with rrule keys + `reminder: { before: PT30M }`), and where
  the ephemeral "already-fired" marker lives (recommended: Notidian view-state, not
  frontmatter, since it is runtime delivery state, not portable content).
- **Also decide:** whether to land the **default-OFF, read-only `dateReminders`
  reminder-scan spike** (scan frontmatter on `onLayoutReady`, toast due reminders via
  `notify`, in-memory fired-set — no recurrence-aware reminders, no persisted state,
  no editing UI) as the first implementation step, to de-risk the scan → due-compute
  → Notice path against a real vault.
- **Honest limitation surfaced (not hidden):** reminders fire only while Obsidian is
  open — there is **no background/OS notification** (an Obsidian-plugin runtime fact).
- **Bead status:** Notidian-5io stays **OPEN**, awaiting your direction.

### Notidian-214 — Frame-execution settings toggle + vault-trusted-frame allowlist

- **ADR:** [docs/adr/0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md](adr/0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md) (Status: Proposed).
- **Why a decision, not a build:** (1) this is **gated** on the Notidian-vke
  flag-gated item above — the toggle + allowlist only matter once you keep
  `hardenFrameExecution` **ON** after live-verify; building ahead of that gambles on
  a boundary you may tune or reject, and the allowlist only exists *if* live-verify
  finds a real user frame the boundary breaks. (2) The allowlist is a genuine design
  choice with a hard invariant: trust must stay **non-persisted / non-attacker-
  controllable** (`src/core/utils/frames/trust.ts`). A persisted allowlist (an
  `.mdb` column, a frontmatter field, a `data.json` paths list) is editable by the
  same AI-writes-to-vault threat actor the boundary defends against — it would
  **reopen the exact vke RCE**. So "just add an allowlist" *is* the question.
- **The one decision you need to make:** approve the recommended pair —
  **(1)** an **`advanced`-category settings toggle** for `hardenFrameExecution`,
  worded to name the tradeoff ("may disable `$api` in custom frames you authored");
  **(2)** a **non-persisted, user-blessed, session-scoped provenance stamp** — a
  deliberate "trust this frame's code" gesture that calls `stampKitProvenanceTree`
  **in memory only** (re-confirmed after reload/edit), optionally upgraded to a
  **content-hash** allowlist (trust the reviewed bytes, not a path/flag) if
  re-blessing proves too noisy. Ruled out: persisted per-space/frontmatter "trusted"
  marker (attacker-editable — same class as the forgeable-`ref` RCE); a `data.json`
  trusted-**paths** list (trust attaches to a location, not reviewed code — kept
  only as an explicit-consent fallback); auto-trusting opened/edited frames.
- **Sequencing:** this stays parked until you complete the **Notidian-vke** live-
  verify above and decide to keep the boundary on. If you do, the cheap first step is
  the **default-OFF spike** in the ADR: ship only the toggle plus a read-only
  diagnostic that reports *which* frame/expression the boundary no-op'd, so the
  live-verify yields a precise list of frames that need blessing — telling you
  whether the allowlist is even needed before any allowlist code is written.
- **Bead status:** Notidian-214 stays **OPEN**, awaiting your direction.

### Notidian-2w0 (epic item 5) — In-table quick find: already shipped; one sequencing decision left

- **ADR:** [docs/adr/0021-in-table-quick-find.md](adr/0021-in-table-quick-find.md) (Status: **Accepted** — records an already-shipped design).
- **What the loop found:** epic item (5) ("in-table quick find with highlighted
  match navigation vs current row-hide filter") was **already built and merged** as
  child bead **Notidian-r20** (CLOSED 2026-06-12): Cmd/Ctrl+F highlight + navigate,
  `n of m`, off-screen reveal, wraparound, password/hidden columns excluded,
  Codex-reviewed, tests/tsc/build green. The four decisions you'd be asked to make
  were already resolved in line with the recommended defaults: (a) additive find
  that coexists with filters (searches only filtered-visible rows, never hides);
  (b) matches rendered cell text (WYSIWYG); (c) **no new `innerHTML` sink** —
  highlight is cell-level CSS classes, so the ADR 0017/sanitize invariant is met by
  avoidance; (d) reveal off-screen matches by growing pagination + `scrollIntoView`.
  Writing a "Proposed, build it" ADR would have been fiction, so the loop recorded
  the accepted design instead.
- **The one decision you need to make:** **sequencing of quick-find vs row
  virtualization (Notidian-8h9).** The current off-screen-reveal mechanism is
  coupled to pagination. When virtualization replaces pagination, reveal must
  switch to `virtualizer.scrollToIndex`. **Recommended:** fold that change into the
  Notidian-8h9 work as an acceptance criterion (one DOM concern, no regression
  window) rather than shipping virtualization first and patching find after.
- **No build is pending.** No spike was added; the feature is live. A child
  implementation bead for the virtualization-reveal migration is filed (see below)
  and blocks on the Notidian-8h9 direction.
- **Bead status:** Notidian-2w0 stays **OPEN** (epic), awaiting your sequencing call.

### Notidian-n2t — Type Profile hub-deletion notice: pick a direction (recommend: decline)

- **ADR:** [docs/adr/0023-type-profile-hub-deletion-notice.md](adr/0023-type-profile-hub-deletion-notice.md) (Status: **Proposed**).
- **What the loop found:** building this blind would be actively harmful. The
  table→hub mirror (`typeProfileMirror.ts`) returns the same `{ok:false,
  state:null}` for "no profile", "no folder note", and "hub deleted", and it fires
  on **every** column edit of **every** folder DB (the caller gates only on
  `dbSchema.id == defaultContextSchemaID`, not on having a profile;
  `ContextEditorContext.tsx:1402`). `notePath` is always a computed path
  (`spaceInfo.ts:121-132`), so the note's existence can't be read off the path.
  A naive "hub stopped tracking" notice would therefore spam every non-Type-Profile
  folder DB on every column edit. The only case that loses work — deletion *between*
  read and write of a resolved profile — **already** surfaces via the
  `saveFrontmatterProperties` failureMessage.
- **The one decision you need to make:** **should this notice exist at all, and if
  so via which prior-state signal** — (a) persist a Notidian-owned
  last-known-profile context field, (b) a burst-scoped read-before-write diff, or
  (c) decline. **Recommended: (c) decline** — the only data-loss case is already
  reported and the rest is a low-value (P3) ambient status not worth net-new
  Notidian-owned authority state; (b) only catches the mid-burst case the existing
  notice already covers. If you do want the ambient status, the recommended build is
  (a) (the only option that detects across-session deletion), implemented per ADR
  0017 as a Notidian-owned field — *not* (b).
- **No build is pending.** No spike was added: neither (a) nor (b) can be de-risked
  by a throwaway flag without committing to the design choice this ADR defers to you.
- **Bead status:** Notidian-n2t stays **OPEN**, awaiting your direction.

### Notidian-2uz — Sub-items + back-relations UX: who owns the link, and is creation two-way?

- **ADR:** [docs/adr/0024-sub-items-back-relations-ux.md](adr/0024-sub-items-back-relations-ux.md) (Status: **Proposed**).
- **What the loop found:** the engine + render for sub-items and back-relations are
  **already shipped and tested** (`tableRowTree.ts`, `tableBackRelations*.ts`,
  `relationResolver.ts`; beads gg9/pv4/s9m/ahk/9ln). Building more blind would gamble
  on the wrong product contract. Concretely, today: the parent column is chosen
  **per view** (any link property, no reserved name); the tree runs **after sort**
  so **hierarchy wins row order, sort orders siblings**; creating a row writes
  **no link at all** (empty file — the user types `[[parent]]` into the parent
  column); the relation is **strictly one-way** (child names parent; the parent file
  is never touched; "linked from" is the read-only computed inverse); cycles are
  **broken silently** with no user-visible signal.
- **The one decision you need to make:** **when a user creates/nests a sub-item,
  should Notidian write only the child→parent link (one-way, child owns) or also the
  parent's reciprocal child link (two-way)?** This is the load-bearing call — it
  decides whether we ever write to a file the user didn't target and whether two
  competing authorities exist for the same fact. **Recommended: one-way, child owns**
  (Option B1) — the inverse already exists for free as read-only computed
  back-relations, so two-way storage only duplicates a derivable fact and adds a
  second authority + rename/delete reconciliation for no new information. Ship a
  row-context "Add sub-item" action that pre-fills the new child's parent link;
  leave two-way as an explicit per-DB opt-in (B3) only if you ask for it.
  - Secondary recommendations in the ADR (lower-stakes): keep per-view parent-column
    designation (A1, status quo); add a passive cycle indicator, no edit-time block
    (C2); keep the shipped sort/filter/groupBy rules with a documented groupBy
    adjacency caveat (D1–D4).
- **No build is pending.** No spike was added: the open question is product
  authority, not something a throwaway flag de-risks — building either creation flow
  commits to the very choice this ADR defers to you.
- **Bead status:** Notidian-2uz stays **OPEN**, awaiting your direction.

## Cleared

_(none yet)_
