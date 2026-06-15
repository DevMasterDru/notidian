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

### Notidian-e8e — array.ts order comparators: correctness vs caller-dependence (+ uniqCaseInsensitive casing, Notidian-9v6)

- **ADR:** [docs/adr/0025-array-comparator-correctness.md](adr/0025-array-comparator-correctness.md) (Status: **Proposed**).
- **Why a decision, not a build:** the two comparators (`orderStringArrayByArray`
  column ordering, `orderArrayByArrayWithKey` space/row ordering) are load-bearing
  on the cache path, and their current output is **explicitly locked as
  characterization, not correction** (`array.test.ts:29`). They are non-reflexive
  (`cmp(x,x)===-1`), non-transitive, lean on V8 TimSort specifics for absent-item
  order, and mutate the caller's array in place. The live callers (`cacheParsers.ts:88`,
  `superstate.ts:816`) *might* depend on the reversed-absent / in-place quirks, so
  "fix the comparator" is a behavior call, not pure logic — a blind flip could
  silently reorder the owner's columns/spaces.
- **What the investigation found (grounds the recommendation):** neither caller
  depends on *reversed* absent ordering. `superstate.ts` passes a throwaway copy
  (in-place is harmless) and has no reason to show focus-less spaces reversed.
  `cacheParsers.ts:88` is **actively harmed** by the comparator's absent tail —
  verified empirically, it **duplicates** every new path (`orderStringArrayByArray`
  reverse-appends the absent set, then `missingPaths` appends the same set again:
  `[row2,row1,newB,newA,newA,newB]`). The single contract both rely on —
  "present items first, in order-sequence" — is already property-tested
  (`array.test.ts:388`) and preserved by every option.
- **The one decision you need to make:** pick **A / B / C** for the comparators —
  **recommended B**: replace both with a stable, reflexive, non-mutating comparator
  (`0` for equal/both-absent, `A-B` otherwise, preserving input order for absent
  items via stable sort), update the two callers, and flip the ~5 locked
  characterization assertions. Ruled out: **A** (keep+document) leaves the latent
  V8-dependent sort-stability hazard and the `cacheParsers` duplication; **C**
  (default-OFF flag) over-engineers the rollout of pure, offline-provable logic —
  the flag mechanism is for changes gates *can't* prove, which this isn't.
- **Folded-in sub-decision (Notidian-9v6):** confirm switching `uniqCaseInsensitive`
  to **first-seen** casing (currently keeps last-seen via `new Map(...).values()`).
  Recommended **yes** — it is display-only (property-key column labels in
  `PropertiesView`/`RemoteMarkdownHeaderView`), matches stated intent, mirrors
  `uniq`. Rides with Option B; can land independently even under A (no caller risk).
- **No build / no spike shipped.** This is pure offline-provable logic, so no
  default-OFF flag was added; on a pick, the implementing session applies it (tests
  + tsc + build green; one eyes-on vault check confirms the cosmetic absent-order
  delta).
- **Bead status:** Notidian-e8e stays **OPEN** (folds in Notidian-9v6), awaiting
  your direction.

### Notidian-fs6 — `jsonWithUnquoted` frame-payload parsing: wrapper convention + tolerant tokenizer

- **ADR:** [docs/adr/0026-jsonwithunquoted-frame-payload-parsing.md](adr/0026-jsonwithunquoted-frame-payload-parsing.md) (Status: **Proposed**).
- **Why a decision, not a build:** `src/shared/utils/jsonWithUnquoted.ts` is the
  boundary between **stored frame-action text and executable code** — `ButtonSubmenu`
  serializes the action into `node.actions[propName]`, and `runner.ts` later compiles
  that string via `new Function` with `$api` (actions are user-triggered, so they keep
  `$api`). So "parse better" is also "accept more executable payloads" on the
  **Notidian-vke frame-execution trust boundary** (ADR 0018). Both open items were
  deferred from Notidian-d4u for exactly this reason and pinned as characterization in
  `jsonWithUnquoted.test.ts`.
- **The one decision you need to make:** approve the recommended pair —
  **(1)** make the **OBJECT-returning wrapper convention canonical** and normalize the
  double-quote-wrapped case (`"{...}"`) to it, so a wrapped payload returns a
  deterministic object regardless of quote style (every real caller wants the object;
  a returned string is dropped as "not a JSON object"). This is offline-provable and
  needs **no flag** — it flips the d4u characterization assertion from STRING to
  OBJECT. **(2)** implement the **tolerant tokenizer** (replacing the lossy regex
  `/(\w+)\s*:\s*([^,}\]]+)/` that silently degrades to `{}` on embedded `,`/`}`/`]`)
  as a later implement-bead **gated behind the existing default-OFF
  `hardenFrameExecution` flag** — regex behavior preserved when OFF — so it rides the
  *same* vke flag + live-verify and adds **no new runtime flag**. Ruled out:
  string-canonical convention (loses real payloads); a dedicated `tolerantFrameParser`
  flag (breaches the review-queue flag-cap, splits one trust decision into two); an
  unconditional always-on tokenizer (widens the executable-payload set with no owner
  opt-in); a JSON5/relaxed-JSON dependency (maximally widens the accepted shape +
  supply-chain surface on a security sink).
- **No build / no spike shipped.** Per the bead, the parser code is untouched and
  **no new runtime flag was added** (the flag-cap is already at its working limit). A
  throwaway spike can't de-risk a semantics call (the wrapper convention is a contract,
  not a measurement) and the tokenizer's whole risk is the vke boundary it must
  live-verify under the existing flag anyway.
- **Bead status:** Notidian-fs6 stays **OPEN**, awaiting your direction.

### Notidian-nir — Upstream bd embedded-dolt `export`/`stats` blind to issues: how to carry it + JSONL mirror policy

- **ADR:** [docs/adr/0027-bd-embedded-dolt-export-stats-blind-and-jsonl-mirror-policy.md](adr/0027-bd-embedded-dolt-export-stats-blind-and-jsonl-mirror-policy.md) (Status: **Proposed**).
- **Why a decision, not a build:** there is **no Notidian source on this code
  path** — bd is an external binary and its embedded-dolt write/commit path is the
  defect. Re-verified live (2026-06-15): `bd list --all` sees **113 issues** but
  `bd stats` and `bd export` read the committed `issues` table, which is **empty at
  every Dolt root** (committed HEAD/STAGED/WORKING/all-history + the Dolt backup),
  so they report 0 and the passive `.beads/issues.jsonl` git mirror stays empty.
  **Daily bd work is UNAFFECTED** (`list`/`show`/`update`/`ready`/`close`/`remember`
  all use the working view); only the JSONL export mirror is blocked. We are
  already on the newest bd (1.0.5, Homebrew stable, not in `brew outdated`); root
  cause + every ruled-out fix is in Notidian-osf + bd memory key
  `bd-105-embedded-dolt-export-stats-blind-to-issues-osf`.
- **The one decision you need to make:** approve the recommended pair —
  **(1a)** **file the bug upstream** (`github.com/steveyegge/beads`, or the
  maintained fork `gastownhall/beads`) with the minimal repro in the ADR, and
  **retest `bd export` on each new bd release**, closing the blocked mirror bead
  Notidian-osf when a release re-exports the full graph; and **(2a)** keep
  `.beads/issues.jsonl` **empty by design** until then, recorded as such — never
  fabricate a mirror. Ruled out: pin/downgrade bd or switch backend
  (server-mode/file-DB) — speculative, high blast radius (changes the repo's bd
  model + Atlas Method `refs/dolt/data` sync contract for all contributors), risks
  the healthy working data, to recover a mirror daily work does not need; do
  nothing silently (bug goes unreported + empty file reads as unexplained data
  loss); hand-build a JSONL from `bd list --json` (lossy — no comments/deps/labels
  arrays, can't match bd's field-omission rules — and drift-prone, could be
  mistaken for ground truth); partial mirror with a custom `partial` marker (bd
  has no such convention; dead metadata, still drifts).
- **No build / no spike shipped.** No Notidian code, config, branch, or backend
  changed; `.beads/issues.jsonl` is intentionally left empty. A spike can't
  de-risk this: Decision 1 is "where the fix lives" (upstream, settled by
  evidence) and Decision 2 is a data-integrity policy call, not a measurement.
- **Bead status:** Notidian-nir stays **OPEN** (owner/upstream action item),
  awaiting your direction; it blocks Notidian-osf.

### Notidian-e29 — Per-database row-create templates: wire them into the table create path

- **ADR:** [docs/adr/0028-per-database-row-create-templates.md](adr/0028-per-database-row-create-templates.md) (Status: **Proposed**).
- **What the loop found:** templates are **already file-canonical and already work
  from the sidebar** — the storage question is answered, only the wiring is missing.
  A space's templates are ordinary `.md` notes under
  `{space}/{spaceSubFolder}/templates/`, copied whole (frontmatter + body) via
  `copyPath` in `newTemplateInSpace` (`spaces.ts`). The MDB holds only a *pointer*
  to the default (`space.metadata.template`) — view config, not row data, exactly
  the ADR 0001/0014/0017 partition. The navigator `+` (`ui.tsx defaultAdd`,
  `showSpaceAddMenu`) already applies the default **and** offers a per-DB picker
  over `space.templates`. The gap epic item (2) names is narrow: the **three
  in-table/in-context row-create chokepoints** (`TableView.tsx newRow`,
  `api.ts insert`, `ContextCell.tsx`) call `newPathInSpace` directly and always make
  an **empty file** — so a default template set for a database is honored from the
  sidebar but **not** when you add a row in the table (the most common gesture).
- **The one decision you need to make:** **confirm the recommended contract so the
  thin wiring can ship — (a) keep templates as file-canonical `.md` (never an MDB
  blob without `source:notidian`); (b) seed frontmatter + body (frontmatter-only is
  already served by Type Profile defaults); (c) auto-apply the single default +
  keep the existing optional picker (no forced prompt); (d) template wins wholesale,
  Type Profile `newPropertyDefaults` only seeds the no-template path (the precedent
  `applyNewRowTypeProfileDefaults` already documents — "the template wins").** The
  load-bearing part is (d): it keeps exactly one writer per row create and a clean
  division of labor (Type Profile = property defaults for plain rows; templates =
  full authored new-row scaffold). If you instead want schema defaults to fill gaps
  the template leaves absent, that is the deferred per-DB opt-in (D2), not the
  default.
- **No build is pending.** No code changed. An **optional default-OFF spike** is
  offered in the ADR (extract one shared `createRowInSpace` helper, route the three
  chokepoints through it, gate table/context template-honoring behind a default-OFF
  `applyRowTemplateOnTableCreate` flag so your vault is byte-for-byte unchanged
  until you flip it) — **not built**, it presupposes you pick the recommended
  contract and is the first task of the follow-up implementation bead.
- **Bead status:** Notidian-e29 stays **OPEN**, awaiting your direction.

### Notidian-tni — Frontmatter-link relations + rollups: authority + UX contract (epic item 1)

- **ADR:** [docs/adr/0029-frontmatter-relations-rollups-authority-ux.md](adr/0029-frontmatter-relations-rollups-authority-ux.md) (Status: **Proposed**).
- **What the loop found:** the **engine + runtime + cell + column type + config menu
  already shipped and are tested** (beads 9ln/8pl/e1u/ahk) — this is the headline
  Notion gap, but it is a *contract* decision, not a build, just like the sub-items
  sibling (ADR 0024). A relation is just `[[links]]` in a frontmatter `link`/`context`
  property; `computeRowRollup` resolves them via the shared resolver, reads the linked
  notes' own frontmatter from the in-memory `pathsIndex`, and aggregates — **read-only,
  never writes**. The rollup *definition* `{ref, field, fn}` is stored in the rollup
  **column's** definition in the MDB schema `cols` — and that is *allowed*: ADR 0001
  (row "View layout" / "Formulas and aggregates") and ADR 0014 put **view/column
  configuration** in the MDB on purpose. ADR 0017 only fires when the MDB silently
  owns a frontmatter *value* — a compute-definition is not one, and the rollup *result*
  is always recomputed, never persisted. So the shipped storage is **compliant, not a
  violation**. Dangling links and non-numeric values already degrade gracefully but
  **silently**; recompute is already live, on-render, off the cache.
- **The one decision you need to make:** **confirm the recommended contract so the
  one thin UX gap can ship — (a) relation source = any link column designated per
  rollup/view, no reserved name (status quo, symmetric with ADR 0024 A1); (b) keep the
  rollup definition in MDB view/column config (it is configuration, not a durable
  frontmatter value — no `source:notidian` needed); (c) one-way, source owns the link,
  the inverse is the already-shipped read-only computed `backlink` (symmetric with ADR
  0024 B1) — two-way only as a future per-DB opt-in; (d) keep graceful degradation but
  add a passive "N of M counted / K unresolved" indicator so a partial number is
  honest; (e) keep live on-render recompute off the in-memory cache (a rollup is a
  computed value per ADR 0001, never a stored one).** The load-bearing parts are (b)
  and (c): (b) ratifies that the shipped MDB storage is within the authority partition,
  not an ADR 0017 violation; (c) keeps relations one-way + computed-inverse, so we never
  duplicate a derivable fact into a second authority. If you instead want a reserved
  relation property, two-way stored relations, or a materialized rollup value in
  frontmatter, those are the ruled-out alternatives (A2 / C2 / B3) — pick one explicitly
  and I will re-scope.
- **No build is pending.** No code changed. The only new code the recommendation
  implies is the passive partial/unresolved indicator (d) — a cell badge/tooltip driven
  by counts the runtime already has, **CSS/text only, no new innerHTML sink** (sanitize
  invariant, ADR 0017/0019) — and it is the first task of the follow-up implementation
  bead, **not built**, because it presupposes you accept the contract.
- **Bead status:** Notidian-tni stays **OPEN**, awaiting your direction.

### Notidian-od7 — `serializeMultiDisplayString`/`parseMultiDisplayString`: first-comma-only escape data loss

- **ADR:** [docs/adr/0030-multi-display-string-comma-escaping.md](adr/0030-multi-display-string-comma-escaping.md) (Status: **Proposed**).
- **Why a decision, not a build:** the escape contract is **caller-dependent**.
  `serializeMultiDisplayString` (`serializers.ts:1`) and `parseMultiDisplayString`
  (`parsers.ts:10`) both use a **string-pattern** `.replace(',', ...)` / `.replace('\\,', ...)`,
  which replaces only the **first** occurrence — so any element containing a comma
  fractures on round-trip (`['a,b','c']` -> `'a\,b, c'` -> `['a','b','c']`, one element
  into three; `['x,y,z']` -> `['x','y','z']`; verified empirically). It backs real
  authority surfaces (link/context cells, tags, aliases, lookup inlinks/outlinks/spaces).
  The present defective output is **explicitly locked as characterization, not correction**
  in `serializers.test.ts` (Notidian-a3s), so a fix must be a deliberate flip — not silent.
- **What the investigation found (grounds the recommendation):** the exposure is
  **narrow**. The `multi` path everywhere already uses the safe JSON `serializeMultiString`
  (`LinkCell.tsx:35`, `ContextCell.tsx:62`); the display form is hit only on **single
  values** or on **paths/tags** (Obsidian paths and tags can't contain commas in practice),
  so the only real bite is a comma inside an **alias** (`label.ts:30`) or a single-option
  label (`optionCellModel.ts:33`) — rare on a single-user vault. Comma-free values
  round-trip cleanly and are **byte-identical** before/after. The load-bearing catch:
  fixing the **parser** changes the read-back of values **already written** by the buggy
  serializer (stored `'a\,b, c'`: old parser -> `['a','b','c']`, fixed parser -> `['a,b','c']`)
  — a vault-data re-interpretation offline gates can't see.
- **The one decision you need to make:** pick **A / B / C** — **recommended A**: make
  **both** comma replaces global (`/,/g` on serialize, `/\\,/g` on parse), and move the
  parser un-escape to **after** the split (un-escaping the whole string first would
  re-create separators — verified). Keeps the human-readable comma form; correct
  round-trip for all values; flips ~5 locked characterization assertions. Ruled out:
  **B** (route single values through JSON `serializeMultiString`) turns readable `a, b`
  into `["a","b"]` on disk — a readability regression for a lone string and a larger
  "retire the display form" call; **C** (accept + document) leaves a confirmed data-loss
  defect on authority surfaces with only a comment as guardrail.
- **No build / no spike shipped.** The only un-gate-able aspect is the rare
  re-interpretation of already-escaped-comma vault values, which a single eyes-on vault
  check settles — not something a default-OFF flag de-risks (the logic itself is
  offline-provable and guarded by the comma-free-identity property net + the flipped
  characterization tests). On a pick, the implementing session applies A's two-function
  edit and flips the locked assertions.
- **Bead status:** Notidian-od7 stays **OPEN**, awaiting your direction.

### Notidian-5zc — `parseCsvToRecords`: duplicate CSV headers silently clobber (last-write-wins) on import

- **ADR:** [docs/adr/0031-csv-import-duplicate-header-contract.md](adr/0031-csv-import-duplicate-header-contract.md) (Status: **Proposed**).
- **Why a decision, not a build:** the contract is **caller-dependent**. In
  `parseCsvToRecords` (`tableCsv.ts:128`), `headers.forEach((h,i) => record[h] = cells[i] ?? '')`
  keys each cell by header **NAME**, so two same-named columns collapse — the later one
  overwrites the earlier in the per-row record (last-write-wins), the first column's data
  is **silently dropped**, and `headers[]` still lists the duplicate (the returned shape
  is internally inconsistent). Pinned as current behavior in `tableCsv.test.ts:462`
  (`'a,a,b\n1,2,3'` -> `headers ['a','a','b']`, `rows [{a:'2',b:'3'}]` — `1` lost). This
  is the Notion-parity import path (roadmap item 6); a real CSV with two same-named
  columns loses a whole column on import with no warning.
- **What the investigation found (grounds the recommendation):** the parser does not stand
  alone. Its output feeds `planCsvImport` (`tableCsvImport.ts:54,77-81`) and
  `executeCsvImport` (`tableCsvImportRuntime.ts:30,48`), **both name-keyed**, and the final
  frontmatter sink is a name-keyed YAML map — so two truly-identical header names cannot
  produce two distinct columns downstream **regardless of the parser**; the collision is
  structural. The project already has the house answer: `uniqueNameFromString`
  (`shared/utils/array.ts:23`, tested in `array.test.ts:268-313`) backs column/schema/
  file-name dedup at ~10 sites; duplicate **import** columns are the same problem as
  duplicate **created** columns. Notion's own CSV import auto-suffixes duplicate column
  names rather than dropping data.
- **Where uniquification belongs (the cross-layer call the bead asks for):** **in the
  parser**. It is the only layer that sees the raw header row positionally before names
  become keys; deduping there keeps `headers[]` and every record's keys 1:1 by
  construction, and all consumers (preview + frontmatter materialization) inherit the fix
  with no per-caller change. The caller's only job is preview honesty —
  `CsvImportModal` already renders `planCsvImport(parseCsvToRecords(text))`, so the
  suffixed name (`a1`) shows in the column-mapping preview **before any write**.
- **The one decision you need to make:** pick **A / B / C** — **recommended B**:
  auto-uniquify duplicate headers in the parser via `uniqueNameFromString` (`a,a,b` ->
  `headers ['a','a1','b']`, `rows [{a:'1',a1:'2',b:'3'}]`). Lossless, consistent with the
  existing column-dedup convention, matches Notion, keeps `headers[]`/row keys consistent,
  no hard failure on a real-world CSV. Ruled out: **A** (reject/warn) — a hard failure on
  input the user often can't easily fix, heavier than a mechanically-repairable problem
  warrants; **C** (keep last-write-wins) — silent column loss on a data-import path, the
  one contract that gives the user no signal at all.
- **No build / no spike shipped.** The fix is a **pure parser function**, fully
  offline-provable (no vault read), so a default-OFF flag adds nothing — the only gate is
  the owner choosing repair (B) vs reject (A) vs accept (C). On a pick, the implementing
  session applies it and **deliberately flips** the pinned characterization at
  `tableCsv.test.ts:462` (guarded by the existing `uniqueNameFromString` property net).
- **Bead status:** Notidian-5zc stays **OPEN**, awaiting your direction.

### Notidian-qbr — Date-filter boundary + Invalid-Date semantics (`dateAfter`/`dateBefore`/`isSameDay`)

- **ADR:** [docs/adr/0032-date-filter-boundary-and-invalid-date-semantics.md](adr/0032-date-filter-boundary-and-invalid-date-semantics.md) (Status: **Proposed**).
- **Why a decision, not a build:** the chosen boundary + malformed-input contract is
  a **product/UX call** (what does "before/after a date" mean to a user, and should a
  corrupt date be visible?), and every plausible fix changes **which rows the owner
  sees** in a date-filtered table — observable vault behavior offline gates can't
  prove correct, and the current behavior is **pinned as characterization** in
  `filter.test.ts` (Notidian-3fs, lines 367-507) so any change is a deliberate flip.
- **What the investigation found (all empirically verified):** `dateAfter` uses
  inclusive `>=` (`filter.ts:97`) but `dateBefore` uses exclusive `<` (`filter.ts:106`),
  so a boundary instant satisfies `dateAfter` but **not** `dateBefore`. Worse: the
  comparison is at **instant** granularity while users pick a **date** (a date-only
  filter parses to local midnight), so whether a row "on June 1" matches an
  "after/before June 1" filter depends on the **time-of-day stored in the row** —
  which the user usually never set and can't see. An unparseable value becomes
  Invalid Date (NaN) and is **invisible to BOTH** filters (every NaN comparison is
  false — fail-closed today). `isSameDay` compares only `getMonth()`+`getDate()`,
  **ignoring the year**, so 15 Mar 2024 matches 15 Mar 1999 (the sibling
  `isSameDayAsToday` is intentionally year-agnostic — an anniversary check — and is
  a separate concern).
- **The one decision you need to make:** approve the recommended trio (or pick per
  axis) — **(a) boundary: A1** make `dateAfter`/`dateBefore` **day-granular + both
  inclusive** so "on the boundary day" matches both operators consistently regardless
  of the row's stored time (over A2 consistent-instant, which only patches the
  `>=`/`<` disagreement, or A3 keep half-open + document); **(b) Invalid-Date: B1**
  keep **invisible-to-both / fail-closed** (status quo, made explicit) — a malformed
  date must **not** silently satisfy a date filter (over B2 visible-to-both/fail-open,
  which lets garbage pass any date filter, or B3 treat-as-empty, which conflates blank
  with typo'd — deferred not rejected); **(c) `isSameDay`: C1** **also compare the
  year** — a real bug fix; cross-year same-day matching is almost certainly accidental
  (over C2 keep year-agnostic + relabel as anniversary, redundant with
  `isSameDayAsToday`).
- **No build / no spike shipped.** This is pure, offline-provable predicate logic (no
  render-path / `innerHTML` / authority surface), so **no default-OFF flag** was added
  — the flag mechanism is for changes gates *can't* prove. The only un-gate-able
  aspect is the one-time visible row-set delta on a date-filtered table, which the
  existing characterization net plus a single eyes-on vault check settle. `filter.ts`
  and the pinned `filter.test.ts` assertions are **untouched** until you pick.
- **Adjacent decision you may want to fold in:** **Notidian-37m** —
  `filterReturnForCol` returns `true` (row visible) for an unknown/undefined filter
  `fn` (fail-open at the dispatcher level). Same family of question as (b) but at the
  *operator* level rather than the *value* level; defensibly resolves differently
  (fail-open is plausibly right for forward-compat with unknown fns from newer
  schemas), but you may prefer to settle the whole predicate-contract posture at once.
  Filed separately (P3), **not** decided by this ADR.
- **Bead status:** Notidian-qbr stays **OPEN**, awaiting your direction.

### Notidian-0id — `intelligentCompare` (Visualization `sortingUtils.ts`): non-transitivity vs observable chart ordering

- **ADR:** [docs/adr/0033-intelligentcompare-viz-comparator-non-transitivity.md](adr/0033-intelligentcompare-viz-comparator-non-transitivity.md)
  (Proposed). Discovered by the characterization net `Notidian-dx5`.
- **The defect:** `intelligentCompare` (`sortingUtils.ts:37-65`) is reflexive +
  antisymmetric but **NON-TRANSITIVE** — the `Notidian-e8e`/ADR-0025 comparator bug
  class on the chart-ordering surface. The date/number/string branch is chosen
  **per comparison pair** (`isDateLike(aStr) || isDateLike(bStr)`), not by a stable
  per-value classification, so the same value is treated as a different type
  depending on its partner. Verified triple (locked as `KNOWN DEFECT` in
  `sortingUtils.test.ts`): `cmp("2024-01-01","")=-1`, `cmp("","10")=-1`,
  `cmp("2024-01-01","10")=+1` — because `new Date("10")` parses as year 2001 while
  `""` is an invalid Date; `"10"` is a *number* vs `""` but a *Date* vs a real date.
  A nonzero violation count over an 18-value mixed domain (the exact figure is
  deliberately not locked — only that it is `> 0`). Self-consistent sub-domains
  (all-dates / all-numbers / all-strings) provably obey the full triad — so the
  breakage is the cross-branch mixing, not the per-branch logic.
- **Why it matters:** the comparator is fed **directly** to `Array.prototype.sort`
  to order chart axes/categories (`D3VisualizationEngine.tsx:205,388`,
  `LineChartUtility.ts:173,600`, Bar/Line/Area/Radar transformers). For
  mixed-type category data the rendered axis order is a V8/TimSort artifact, not a
  defined contract — a Node/V8 upgrade or input-size change can silently reorder it.
- **Why a decision, not a blind fix:** no caller depends on the *broken* property,
  but every caller renders **whatever order the comparator emits**, so a fix changes
  **owner-visible** chart category order for mixed-type data. `tsc`/`jest`/`build`
  can prove the *laws* hold but cannot decide which *product* ordering is correct.
  Same posture as ADR-0025; current behavior pinned as characterization.
- **Recommendation:** **Option B** — classify each value's type **once** (per-value
  buckets with a fixed cross-bucket order) into a real strict weak ordering, then
  flip the locked `KNOWN DEFECT` assertions to assert the laws hold. Over **A**
  (keep + document the latent hazard) or **C** (flag-gate pure offline-provable
  logic — over-engineering, ruled out as in ADR-0025). One eyes-on chart check
  settles the category-order delta.
- **The two B sub-choices are now pinned in the ADR (Notidian-0id decision pass)**
  so "approve B" is a complete picture: **(i)** cross-bucket order
  **`dates < numbers < strings`** (keeps every single-type axis byte-identical to
  today — the visible delta is confined to genuinely mixed-type axes; overridable at
  zero correctness cost); **(ii)** numeric predicate = **whole-string
  finite-numeric**, which *also* closes the locked `"Infinity"`/`"1e999"`
  NaN-reflexivity defect, so **both** `KNOWN DEFECT` blocks (non-transitivity + the
  Infinity NaN-return) flip in one commit. The ADR carries a worked mixed-axis
  reorder example as the exact review picture.
- **Adjacent (not decided here):** **Notidian-dox** — `getOptionsOrder` throws on a
  truthy non-array `options` (no `Array.isArray` guard; safe Q1 hardening, no
  valid-data change); `getOptionsOrder` drops options with falsy value (`0`/`''`/
  `false`); `getUniqueSortedValues` collapses a real `0` field value to `''` via
  `|| ''`. All pinned in `sortingUtils.test.ts`.
- **No build / no spike shipped.** Pure, offline-provable comparator logic — no
  render-path/`innerHTML`/authority surface — so **no default-OFF flag**. The
  characterization net (`sortingUtils.test.ts`, 51 tests) is untouched-as-locked
  until you pick.
- **Bead status:** Notidian-0id stays **OPEN**, awaiting your direction.

### Notidian-37m — `filterReturnForCol` fail-open for unknown/undefined filter `fn`

- **ADR:** [docs/adr/0034-predicate-unknown-fn-fail-open-contract.md](adr/0034-predicate-unknown-fn-fail-open-contract.md)
  (Proposed). The `decide` note that ADR 0032 filed **separately** (P3, undecided).
- **The behavior:** `filterReturnForCol` (`filter.ts:140-159`) initializes
  `result = true` (line 144) and only overrides it when `filterFnTypes[filter?.fn]`
  resolves a **known** operator (line 145). So a `null` filter, a missing `fn`, or
  an unknown `fn` (e.g. emitted by a newer schema version) makes the row **stay
  visible** — a corrupt/unrecognized predicate silently disables filtering rather
  than hiding rows or throwing. Pinned as characterization in `filter.test.ts`
  (Notidian-3fs) at lines 526 ("unknown fn"), 532 ("missing fn"), 591 ("null
  filter").
- **Already-guarded upstream:** `validatePredicate`→`cleanPredicateType`
  (`predicate.tsx:38`, applied at `:57-59`) **strips** any filter whose `fn` is not
  a known operator at write/load (`ContextEditorContext.tsx:1153, :1189`), so an
  unknown fn never reaches the dispatcher in normal operation. Fail-open here is the
  **defensive backstop** for the un-validated edge (in-memory pre-validate
  predicates, programmatic filters). Every call site also fails open already
  (`linkContextRow.ts:372/:378`, `ContextEditorContext.tsx:681`,
  `treeHelpers.ts:214` — all `col ? … : true` / `reduce(…, true)`).
- **Why a decision, not a blind fix:** keep-visible vs hide vs throw changes **which
  rows the owner sees** (or, for throw, can crash the per-row render pass) — a
  safety/UX call about the worst failure mode for a single-user vault, which
  tsc/jest/build cannot decide. Current behavior locked as characterization.
- **Recommendation:** **Option A** — keep fail-open + **document the contract**
  (comment on `filterReturnForCol` + ADR), paired with a **one-time upstream
  validate-loud warning** in `cleanPredicateType`/`validatePredicate` so an unknown
  fn is surfaced once at validation, not silently. Over **B** (fail-closed: hides
  the owner's own data with no signal — for a single-user vault, vanishing data is
  the worse failure than an under-constrained table the user can see and fix) or
  **C** (throw/log at the per-row dispatcher: render-crash on a throw, console-spam
  on a log, plus hot-path cost — its valid intent is preserved by moving the warning
  upstream).
- **Relationship to ADR 0032 (Notidian-qbr):** same family of question (what should
  a malformed predicate input do?) but **defensibly resolves oppositely** — ADR
  0032(b) recommends **fail-closed** for a malformed **date value** (a bad value
  must not silently *satisfy* a real constraint), while this recommends **fail-open**
  for an unknown **operator** (an *unreadable constraint* must not silently *delete
  data*). Value-level vs operator-level. You **may** fold the two into one
  predicate-contract decision, but they need not match.
- **No build / no spike shipped.** Logic/contract change (no render-path/`innerHTML`/
  authority surface), and the recommended A + validate-loud companion changes **no
  visible row set** and is fully jest-provable — so **no default-OFF flag** and **no
  eyes-on check** needed; it needs your **decision** (ratify the contract). The
  pinned `filter.test.ts` assertions (526/532/591) are untouched-as-locked until you
  pick (A keeps them green; B flips them).
- **Bead status:** Notidian-37m stays **OPEN**, awaiting your direction.

### Notidian-sp5 — `inferEncodingType` value-path: numeric data infers `temporal`, shadowing `quantitative`

- **ADR:** [docs/adr/0035-inferencodingtype-numeric-vs-temporal-value-inference.md](adr/0035-inferencodingtype-numeric-vs-temporal-value-inference.md)
  (Proposed). Discovered by the characterization net `Notidian-5hs`. Same bug
  family as ADR 0033 (`intelligentCompare`): a date heuristic that swallows numbers.
- **The behavior:** the no-property-metadata value path in `inferEncodingType.ts`
  (`38-62`) runs `areDates` **before** `areNumbers`, and `new Date(String(n))`
  returns a **valid** Date for stringified real numbers **and** bare numeric
  strings (verified 2026-06-15: `String(1)`→`2000-12-31...`, `String(2.5)`,
  `String(-3)`, `"2024"`→`2024-01-01` are all valid Dates; `"true"`/`"apple"`/
  `"2024-01-01"` give `Number(String(v))===NaN`). So `[1, 2.5, -3]` and
  `["2024","2025"]` infer **`temporal`**, shadowing `quantitative`; the only
  value-path that reaches `quantitative` is non-date-parseable numbers (booleans).
- **Blast radius:** **metadata-less inference only.** An explicit `SpaceProperty`
  of type `number` returns `quantitative` from the property switch before the value
  path runs (pinned: property metadata always wins over values). The hazard bites
  only a **type-less chart encoding** on a **property-less numeric field**. Fed via
  `ensureCorrectEncodingType` into D3 axis/scale typing across
  `D3VisualizationEngine.tsx`, `DataTransformationPipeline.ts`, and every
  transformer (Scatter/Line/Area/Bar) — such a numeric column renders on a **time
  axis** instead of a continuous quantitative scale.
- **Why a decision, not a blind fix:** it changes **owner-visible** chart axis
  typing (a heuristic-**quality** product call, not a crash), and the current
  numeric→`temporal` output is **explicitly locked as characterization** in
  `inferEncodingType.test.ts` (Notidian-5hs ADVERSARIAL block, lines 122-145 +
  79-85). `tsc`/`jest`/`build` can prove *which branch fires* but not *which axis
  type is the right product choice* for ambiguous numeric data.
- **Recommendation:** **Option C/A hybrid** — in the value path treat a value as a
  date candidate **only when `Number(String(v))` is `NaN`** (or `v` is a `Date`
  instance), so numbers/numeric-strings short-circuit to `quantitative` while
  genuine ISO/date-string and `Date` detection are preserved (the empirically clean
  discriminator: finite for `1`/`2.5`/`"2024"`, NaN for `"2024-01-01"`/`"true"`).
  Over **A** (bare reorder mishandles years-as-numbers the other way; a heavyweight
  date-pattern regex is a larger bespoke surface) or **B** (leave as-is, rely on
  property metadata — keeps a surprising `[1,2.5,-3]`-on-a-time-axis default,
  documents a foot-gun instead of removing it).
- **Named ambiguity (not hidden):** no value-only heuristic perfectly separates
  `[2020,2021,2022]` meant as **years** (temporal) from the same values meant as
  **counts** (quantitative). C types year-like numbers **quantitative**; temporal
  intent for years is expressed via a `date` property or an explicit encoding type.
- **The one decision you need to make:** **should metadata-less numeric values
  default to `quantitative` (C, recommended) or stay `temporal` (B)?** On a pick of
  **C/A**, the implementing session applies the one-predicate guard and **flips the
  locked numeric `temporal` assertions in `inferEncodingType.test.ts` in the same
  commit** (the genuine-date and boolean-quantitative pins stay green); one eyes-on
  chart check confirms the axis-type delta for year-like numeric columns. On a pick
  of **B**, the session adds a contract comment documenting the numeric→temporal
  default + metadata escape hatch; the locked assertions stay green.
- **No build / no spike shipped.** Pure, offline-provable heuristic logic (no
  render-path/`innerHTML`/authority surface), so **no default-OFF flag** — the only
  un-gate-able aspect is the one-time visible axis-type delta a single eyes-on chart
  check settles. `inferEncodingType.ts` and the pinned test assertions are
  untouched-as-locked until you pick.
- **Bead status:** Notidian-sp5 stays **OPEN**, awaiting your direction.

### Notidian-2zs — `stripFrontmatterFromString` greedy/unanchored regex: fix, replace, or delete a dead helper

- **ADR:** [docs/adr/0036-stripfrontmatterfromstring-greedy-regex-dead-helper.md](adr/0036-stripfrontmatterfromstring-greedy-regex-dead-helper.md)
  (Proposed). Defect confirmed + characterized by Notidian-bey (commit `c61b8ac`),
  pinned in `fm.stripFrontmatterFromString.test.ts`.
- **The defect:** `stripFrontmatterFromString` (`fm.ts:30`) uses
  `/---(.|\n)*---/` — **greedy** (`*`) + **unanchored** (no `^`). The greedy `*`
  spans from the **first** `---` to the **last** `---` anywhere in the doc, so a
  real leading frontmatter block followed by a body horizontal-rule `---`
  over-strips the intervening prose (`"---\ntitle: Hi\n---\nIntro\n\n---\n\nAfter
  rule"` -> `"\n\nAfter rule"`, **`Intro` LOST**); multiple fences collapse to the
  last one; and a non-leading frontmatter-like block is matched too. Behavior
  pinned as characterization (test green, 11 pins).
- **Why a decision, not a build:** two reasons. (1) A non-greedy/anchored rewrite
  **changes what is removed from a note body** — frontmatter is the canonical
  owner of editable properties (ADR 0014/0017) and this is the "body without the
  property fence" view, so the strip semantics are a behavior call, locked as
  characterization so a change is a conscious flip. (2) **The decisive audit
  finding: the helper has ZERO production callers** (full-repo symbol grep =
  definition + its own test only). Its only historical caller — a **commented-out**
  preview reader doing `stripFrontmatterFromString(await
  app.vault.cachedRead(file))` (commit `58bc881`) — was **deleted** in `b38b417`.
  So "fix the regex" silently ratifies keeping a redundant defective stripper; the
  honest choice set includes **delete**, which is a scoping call only the owner can
  make.
- **What the investigation found (grounds the recommendation):** the repo does NOT
  need this helper to strip frontmatter — it already does it **correctly, twice, on
  live paths**: `stripFrontmatter` (`src/core/utils/spaceNoteBody.ts:4`) is
  `^`-anchored, `*?` lazy, CRLF-aware, single-block, trailing-newline-consuming
  (used by `isNoteBodyEmpty`, Notidian-7oj; tested); and the Obsidian
  `frontmatterPosition` offset slice (`markdownAdapter.ts:335`, `Explorer.tsx:322`)
  uses Obsidian's own authoritative YAML-boundary parse. `stripFrontmatterFromString`
  is a third, defective, **unused** duplicate of a solved problem.
- **The one decision you need to make:** **delete the dead helper, or fix it in
  place?** — **recommended C: delete** `stripFrontmatterFromString` + its
  characterization test (removes the over-strip hazard outright, cannot regress
  since nothing observes its output, collapses three strippers to the two correct
  in-use ones). Over **A** (fix in place to the anchored/lazy form and re-point the
  pinned test — choose only if an out-of-tree fork/plugin importer must keep the
  export) or leaving it as a known copy-paste trap (not recommended). If you want
  the export retained for safety, fall back to A so any importer gets the *correct*
  behavior rather than a missing symbol. For any *future* body-minus-frontmatter
  need, the recipe is `frontmatterPosition` (when a cache is in hand) else
  `stripFrontmatter` — not a new bespoke regex.
- **No build / no spike shipped.** This is a dead-code / logic change (no
  render-path `innerHTML`, no authority write surface, no currently-observable
  output), so **no default-OFF flag** and **no eyes-on check** — both C (delete)
  and A (fix) are fully jest/tsc/build-provable and change no vault-observable
  behavior (the function never runs on a note body in the current codebase). It
  needs your **decision** (scope: delete vs fix). `fm.ts` and the pinned
  `fm.stripFrontmatterFromString.test.ts` are untouched until you pick.
- **Bead status:** Notidian-2zs stays **OPEN**, awaiting your direction.

### Notidian-jko — `DataTransformationPipeline.normalizeConfig` impurity (mutates caller `config.encoding`) + `validateConfig` throws on undefined `encoding`

- **ADR:** [docs/adr/0037-datapipeline-normalizeconfig-purity-and-validate-guard.md](adr/0037-datapipeline-normalizeconfig-purity-and-validate-guard.md)
  (Proposed). Two surprises discovered + LOCKED as characterization by the
  orchestrator net `Notidian-34e` (`DataTransformationPipeline.test.ts`). Same
  Visualization subtree as ADR 0033/0035.
- **The two surprises:** (1) `normalizeConfig` (`DataTransformationPipeline.ts:34`)
  does `const normalizedConfig = { ...config }` — a **shallow** copy — so
  `normalizedConfig.encoding` **is** `config.encoding`; writing the inferred
  encodings back **mutates the caller's `config` in place** (locked:
  `out.encoding === original.encoding`, `original.x.type` flips `undefined`→inferred,
  test lines 211-227/419-424). (2) `validateConfig` (`:265`) dereferences
  `config.encoding.x` with **no guard**, so it **throws** on `encoding===undefined`
  (locked, lines 807-815) — but it has **ZERO production callers** (the live path is
  `transform`→`applyRenderingTransformations`), so the throw is currently
  unreachable.
- **The decisive finding (why the bead's "deep-clone is behavior-preserving"
  premise is wrong for the render path):** `D3VisualizationEngine.tsx` runs two
  sibling `useMemo`s over the **same** `config` — `transformedData` (`:100-104`,
  calls `transform`→`normalizeConfig`, which **mutates** `config.encoding.*.type`)
  and `scales` (`:133-456`, reads `config.encoding.*.type` **directly**). The
  `scales` memo only **re-derives** the type for the **X** path of
  scatter/line/bar/area (`:178-181`) and the **Y** path of scatter (`:326-330`);
  for the **Y** path of bar/line/area/pie/radar and the **X** path of pie/radar it
  switches on `config.encoding.*.type` **with no re-derive**. So that type is
  populated **only** by the in-place mutation. Empirically verified (Node,
  2026-06-15): with a deep-clone in `normalizeConfig` and **no other change**, the
  transform **output** is correct but `original.encoding.y.type` stays `undefined`,
  the `scales` Y switch falls through every case, and **the chart loses its Y axis**.
  The mutation is **load-bearing in the live render path** — exactly the
  "downstream identity assumption in D3VisualizationEngine" the bead flagged.
- **Why a decision, not a blind fix:** `out.encoding === original.encoding` is a
  **LOCKED** characterization assertion encoding a render-path contract two memos
  silently rely on; flipping it without making the engine self-sufficient renders
  charts with no Y axis, and even the paired change touches the live render path
  (no offline render coverage) so it needs an **eyes-on-vault** confirm.
  `tsc`/`jest`/`build` prove the unit output but not the live D3 render.
- **The one decision you need to make:** pick **A / B / C1** — **recommended A**:
  deep-clone the `encoding` subtree to make `normalizeConfig` **pure** **and**
  make `D3VisualizationEngine` **self-sufficient** (re-derive Y types for **all**
  chart types and X types for pie/radar — the pattern the X path already uses for
  the other four) **in the same change**, **plus** add the `validateConfig`
  early-guard returning `{valid:false, errors:['No encoding configured']}`; flip
  the three locked assertions (211-227/419-424/807-815) in the same commit and
  confirm with **one eyes-on chart check** that bar/line/area/pie/radar charts with
  type-less encodings still render their axes. The load-bearing sub-call: **a safe
  purity fix is the *paired* change (clone + engine), never the clone alone.**
  Ruled out: **C2 (clone-only, no engine change)** — empirically breaks the render
  path, so the bead's "(c) clone but don't guard" is not a safe partial; **a blind
  autonomous fix** — flips a locked identity assertion the render path depends on.
  If you want only the free, render-safe half now, pick **C1** (guard
  `validateConfig` — independent, no live caller, no eyes-on step, flips only
  807-815). If you judge the cross-memo coupling stable and the unused method's
  throw acceptable, pick **B** (document both contracts incl. the
  load-bearing-mutation warning; change nothing).
- **No build / no spike shipped.** The `normalizeConfig`/engine half is
  render-path-coupled (no offline render test) so it needs an eyes-on confirm, but
  **no default-OFF flag** is proposed — it is not a security/authority sink and the
  coupling is fully understood + locally fixable, so the characterization-test flip
  + a single eyes-on chart check is the right gate (consistent with ADR
  0025/0030/0032/0033/0035). The `validateConfig` half (C1) is fully offline-provable
  with no live caller and needs no eyes-on step. `DataTransformationPipeline.ts`,
  `D3VisualizationEngine.tsx`, and the pinned test assertions are untouched until
  you pick.
- **Bead status:** Notidian-jko stays **OPEN**, awaiting your direction.

## Cleared

_(none yet)_
