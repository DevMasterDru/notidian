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

## Awaiting owner USE — default-ON flag-gated changes (ship-then-verify)

These are **owner-requested core render-path changes** shipped **default-ON behind
a kill-switch** per [AGENTS.md](../AGENTS.md) (the owner's USE is the
live-verification). They are listed here so the owner knows what to exercise and
how to revert if a regression appears — not because they are gated OFF.

### Notidian-8h9 — Table row virtualization (assemble-before-paginate + windowed render)

⏳ **Default-ON; awaiting the owner's USE in the vault.** Fresh live evidence
(2026-06-20, Atlas Vault ~1408 paths / 250 contexts) confirmed the
assemble-before-paginate + no-row-virtualization triad makes opening a large
database visibly slow. The render path now assembles all filtered/sorted rows and
mounts **only the rows inside the scroll window** (constant ~viewport-worth of
DOM) instead of every loaded row+cell.

- **Setting:** `rowVirtualization` (default `true`) — `src/shared/types/settings.ts`,
  defaulted in `src/core/schemas/settings.ts`.
- **Why gated:** the table body is a core render path; correctness of the live
  scroll/measure/window plumbing cannot be proven by tsc/jest/build alone (only
  the pure window math and the activation/slice glue are offline-provable). Shipped
  ON because the owner requested the perf fix; the flag is a true **kill-switch**.
- **What it does when ON:** assembles the full row set (the proven
  `tableAssembly` seam, Notidian-yjg3), then renders only the windowed `<tr>` rows
  chosen by the pure `computeVirtualWindow` seam (Notidian-mnuk, via
  `tableVirtualization.ts`), with top/bottom spacer rows holding the scrollbar at
  full content height. The legacy **Load More / Load All** pagination tfoot is
  hidden (every row is reachable by scrolling). Grouped tables fall back to the
  legacy non-windowed render (the uniform-row window kernel does not model
  interleaved group-header/nested rows).
- **Kill-switch (revert):** set `rowVirtualization: false` in the plugin's
  `data.json` (or the settings UI once a toggle exists) → byte-for-byte legacy:
  the table reverts to its `getPaginationRowModel` page window + the Load More /
  Load All tfoot, no spacer rows. The offline jsdom test asserts this OFF path is
  the pre-feature render.
- **What to live-verify in the vault (the part gates can't cover):**
  - Open a large context (hundreds–thousands of rows): scrolling must be smooth,
    rows mount/unmount cleanly with no blank flashes, and the scrollbar length
    must reflect the full row count (spacers correct).
  - Cell edits, row drag-reorder, cell/row selection, marquee, copy/paste,
    frozen columns, and the aggregate footer must all still work on windowed rows
    (the rows are real `<tr data-row-id>`, so the existing handlers apply).
  - Confirm a **grouped** table (groupBy set) still renders correctly (it takes
    the legacy non-windowed path by design).
  - Toggle the flag OFF → the old Load More / Load All pagination returns
    unchanged.
- **Offline evidence in place:** `src/core/utils/contexts/tableVirtualization.test.ts`
  (activation kill-switch predicate + slice-equals-seam across a scroll sweep),
  `src/core/utils/contexts/tableVirtualWindow.adversarial.test.ts` (the pure
  window kernel, 5000 property runs), and
  `src/core/react/components/SpaceView/Contexts/TableView/TableView.virtualization.dom.test.tsx`
  (jsdom render contract: flag OFF = legacy pagination page window + tfoot + no
  spacers; flag ON = only the windowed rows mount, mounted `tr[data-row-id]` set
  === `computeVirtualWindow` output, spacers present, tfoot gone, grouped
  fallback). Full suite (5826 tests) + tsc + build green.
- **Related follow-up:** the dormant quick-find off-screen reveal
  (Notidian-vgy, `tableQuickFind.ts` `pageSizeToRevealRow`) is **not imported
  live** today (Cmd/F opens the consolidated SearchBar per ADR 0041), so there is
  no active reveal to migrate to `virtualizer.scrollToIndex`; if the quick-find
  bar is ever re-activated, its reveal must scroll the window to the target row
  before `scrollIntoView`. vgy remains parked in [ROADMAP](ROADMAP.md).

---

## Verified — flag-gated changes (live-verified 2026-06-20)

> **Both items below were enabled in the Atlas Vault (`.obsidian/plugins/notidian/data.json`)
> and live-verified at the owner's request on 2026-06-20.** Sequence: fresh build
> (carries the `Notidian-eedq` header-persistence fix) installed → both flags set
> `true` + persisted → `plugin:reload` onto the new build (manifest **v1.3.4**, the
> version-bump path that used to wipe config). **Result:** both flags `true` in
> `data.json` and live runtime; clean render across an inline context table
> (stickers/icons/colored pills/checkboxes/12 frames) and a full folder-space view
> (hub note body + properties + Type Profile + context table); **no console errors,
> no `dev:errors`, frame text not double-escaped**; the `eedq` predicate
> (`colsOrder`×20, `colsHidden`×10) survived the rebuild+version-bump+reload that
> previously NULLed it. Detail retained below for reference; full original
> write-ups are in git history.

### Notidian-vke — Frame-execution sink hardening (trust boundary + frame-text sanitization)

✅ **Live-verified 2026-06-20 → now default-ON in code (Notidian-gbpu).** Default-kit frames keep `$api`, so default rendering (covers/stickers/colors/badges) is unchanged; frame text renders through the active `sanitizeFrameText` sink with no double-escaping and no errors. After verification the code default was flipped `false → true` (kill-switch retained) so all installs get the sink hardening + the jsonWithUnquoted tolerant tokenizer (ADR 0026) cascade. Owner can still refine the trust model (vault-trusted-frame allowlist, [ADR 0022](adr/0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md)) if a custom `$api`-in-prop frame they use ever needs re-trusting.

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
- **Follow-on (parked):** the settings UI toggle + a vault-trusted-frame allowlist
  for re-trusting a custom frame's `$api` is [ADR 0022](adr/0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md),
  parked to [docs/ROADMAP.md](ROADMAP.md) — it only matters once this flag is kept
  ON after live-verify, so it waits until the owner asks.

### Notidian-bnb — Remove dead MKit preview runtime from core SpaceManagerContext

✅ **Live-verified 2026-06-20 → dead runtime now fully pruned (Notidian-rzv).** Folder-space (`mk-space`) views render unchanged — `mk-space` table renders identically (275 cells, 27 rows × 20 cols via `readAllTables`), hub note body, properties panel, Type Profile, frames, sidebar nav all resolve through `superstate.spaceManager`; no errors. After verification the ~14 inert `mkitContext?.isPreviewMode` branches + the `INERT_MKIT_PREVIEW_CONTEXT`/`InertProcessedSpaceData` scaffolding + the `isMKitPath`/`convertMKitPath` helpers were deleted and the `removeMKitPreviewRuntime` setting retired (public value keeps the constant `isPreviewMode: false` external consumers gate on). Guarded by `deadMKitRemoval.guard.test.ts`. Beads `Notidian-bnb` + `Notidian-rzv` closed.

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

_(none — realigned: clear-correct ADRs were implemented, speculative ones parked to docs/ROADMAP.md)_

## Cleared

Realignment of the 2026-06 autonomous drive (use-driven doctrine, AGENTS.md
"Autonomous Implementation Mode"). Clear-correct ADRs were auto-resolved into
shipped fixes (Status Accepted); owner-requested render-path features shipped
default-ON behind kill-switches (the owner verifies by USE); genuinely-speculative
product direction was parked to [docs/ROADMAP.md](ROADMAP.md).

**Shipped default-ON (kill-switch retained; owner verifies by use):**

- **Notidian-543 — List view per-item display-property picker** (Notion "Properties" parity, ADR 0016) — shipped default-ON `listItemPropertyPicker`; kill-switch retained (`904db2c`, doc-comment `86b9b40`).
- **Notidian-sxs1 — Surface the per-item "Item Properties" picker beyond the plain list** (follow-up to 543) — the render half was already live + view-agnostic (default-ON `listItemPropertyPicker`); this widened the FilterBar menu-trigger from a coarse `predicate.view=="list"` gate to a precise `shouldShowListItemPropertyPicker(predicate)` keyed on the active `listItem` frame, so the picker now surfaces on the three fieldsView layouts that render `_properties` (Cards / Board / Details) and is correctly hidden where it would be a dead control (plain list / cover / image / flow). Pure helper + jsdom-free unit tests; inherits 543's kill-switch and use-driven verification.
- **Notidian-8sl — Collapsible + shrink-to-fit space note body** (ADR 0001/0014/0017) — shipped default-ON `collapsibleNoteBody`; kill-switch retained (`b1a5adc`).

**Shipped (offline-provable fixes / ratified contracts):**

- **Notidian-e8e — array.ts order comparators** (ADR 0025) — resolved: stable, reflexive, non-mutating comparators + first-seen `uniqCaseInsensitive` casing (`0e04749`).
- **Notidian-fs6 — `jsonWithUnquoted` frame-payload parsing** (ADR 0026) — resolved: canonical object wrapper convention + tolerant tokenizer (`d8f6452`).
- **Notidian-nir — bd embedded-dolt export/stats blind + JSONL-mirror policy** (ADR 0027) — resolved: policy ratified (file upstream + retest; `.beads/issues.jsonl` empty by design); daily bd work unaffected (`3bd558b`).
- **Notidian-od7 — multi-display-string comma escaping** (ADR 0030) — resolved: global comma escape/un-escape, un-escape after split (`dbc608f`).
- **Notidian-5zc — CSV import duplicate-header contract** (ADR 0031) — resolved: auto-uniquify duplicate headers in the parser, lossless (`ff79d3e`).
- **Notidian-qbr — date-filter boundary + Invalid-Date semantics** (ADR 0032) — resolved: day-granular both-inclusive filters + year-aware `isSameDay` (`d5f81df`).
- **Notidian-0id — `intelligentCompare` non-transitivity** (ADR 0033) — resolved: real strict weak ordering (`737f893`).
- **Notidian-37m — `filterReturnForCol` fail-open for unknown `fn`** (ADR 0034) — resolved: fail-open dispatcher ratified + validate-loud unknown-fn guard (`8780259`).
- **Notidian-sp5 — `inferEncodingType` numeric-vs-temporal** (ADR 0035) — resolved: numeric value-only data infers quantitative, not temporal (`f50dd3c`).
- **Notidian-2zs — `stripFrontmatterFromString` greedy regex** (ADR 0036) — resolved: dead over-greedy helper deleted (`a99f8c7`).
- **Notidian-jko — `DataTransformationPipeline.normalizeConfig` impurity** (ADR 0037) — resolved: pure normalizeConfig + self-sufficient engine + guarded validateConfig (`02280ba`).
- **Notidian-drp — `AreaChartTransformer` missing-x throw** (ADR 0038) — resolved: returns empty contract on missing-x, no throw (`767e3a9`).
- **Notidian-k6a5 — `emojiBox.ts` dead unsanitized injection sink** (ADR 0040) — resolved: dead sink deleted (`c6773d6`).
- **Notidian-z8q — consolidate view search affordances** (ADR 0041) — resolved: one view search affordance + Cmd/F focus-on-mount (`5cabcf7`, `cc850ef`).
- **Notidian-ywcf — `nativeToUnified('')` empty-input contract** (ADR 0042) — resolved: emoji codec pair made total on empty input (`5e4ae69`).
- **Notidian-9i9i — TEXT-matcher non-string operand** (ADR 0043) — resolved: fail-closed-empty TEXT matchers on non-string cell values (`864c42c`).
- **Notidian-2yh — `api.context.insert` per-field authority gate** (ADR 0044) — resolved: per-field authority gate + INSERT (not update) at the MDB sink (`85ac93b`, `83e82ce`).
- **Notidian-k778 — `replaceDB` CREATE/REPLACE column alignment** (ADR 0045) — resolved: explicit-column REPLACE, correct by construction (`98fc4bc`).
- **Notidian-p5qt — `insertIntoDB`/`updateDB` batched-statement seam** (ADR 0046) — resolved: SQL seam cleaned (array + join) (`496b663`).
- **Notidian-dgo6 — `db.exec` NUL transport limitation** (ADR 0047) — resolved: strip NUL at the SQL value chokepoint (`da0d41b`).
- **Notidian-ircw — `resolvePath('../…')` over-pop past root** (ADR 0048) — resolved: graceful root-clamp contract ratified (`fa9a490`).
- **Notidian-2w0 (epic item 5) — in-table quick find** (ADR 0021, Accepted) — already shipped + merged as child Notidian-r20 (Cmd/Ctrl+F highlight + navigate); virtualization-reveal migration folds into Notidian-8h9.

**Parked → docs/ROADMAP.md (build only when the owner asks):**

- **Notidian-o4w — select-to-comment + AI-review channel** (ADR 0019) — parked → roadmap.
- **Notidian-5io — date reminders + recurring events** (ADR 0020) — parked → roadmap.
- **Notidian-214 — frame-execution settings toggle + trusted-frame allowlist** (ADR 0022) — parked → roadmap (gated on the `hardenFrameExecution` flag-gated item above).
- **Notidian-n2t — Type Profile hub-deletion notice** (ADR 0023) — parked → roadmap (ADR recommends decline).
- **Notidian-2uz — sub-items + back-relations creation UX** (ADR 0024) — parked → roadmap (engine already shipped).
- **Notidian-e29 — per-database row-create templates in the table** (ADR 0028) — parked → roadmap.
- **Notidian-tni — frontmatter-link relations + rollups UX polish** (ADR 0029) — parked → roadmap (engine already shipped).
- **Notidian-jlb5 — control-byte source guard** (ADR 0039) — parked → roadmap (repo currently clean; regression insurance only).
