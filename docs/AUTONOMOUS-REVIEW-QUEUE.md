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

## Infra-blocked bd bookkeeping (implementation complete + verified + committed; `bd close` could not run)

> **Resolved 2026-07-10.** The bd write path recovered after run-3; both entries
> below are now properly closed in bd with evidence-bearing reasons
> (`Notidian-loan.3` closed 2026-07-05, `Notidian-21l4` closed 2026-07-09 on
> `autolong/run-4`). Kept for the historical record of the blocker signatures.

### Notidian-loan.3 — S3: Schema adoption command (draft v3 from live rows, confirm-gated)

**2026-07-05.** Fully implemented, gated, and committed on `autolong/run-3`
(commit noted in the commit message below) — this is **not** a code-review or
decision item, it is a **bd-write-path infrastructure blocker**: every `bd`
write command (`--claim`, `close`, `remember`, `create`) on this clone refuses
with:

```
refusing to auto-apply 4 pending schema migrations to a remote-backed database
(v49 -> v53): migrating clones independently forks the schema (#4259)
```

Per `bd`'s own guidance this is a **coordination decision, not an auto-fix** —
only the single designated migrator should run
`BD_ALLOW_REMOTE_MIGRATE=1 bd migrate && bd dolt push`, and re-cloning
(`bd bootstrap`) replaces local unpushed issues. Since this is a Long Autonomous
Mode multi-session drive, other clones may be concurrently active, so this
session did **not** migrate or re-clone unilaterally — that would risk forking
the shared bd schema for every other in-flight session. `bd show/list` still
work read-only via `BD_IGNORE_SCHEMA_SKEW=1`, confirming `Notidian-loan.3` is
still `OPEN`/unclaimed in the local view.

**What shipped (verified, not just claimed):**

- `src/core/utils/contexts/typeProfileAdopt.ts` — pure adoption planner: field
  value stats (present/empty/absent + distinct values), the bounded-cardinality
  enum-candidate heuristic (ADR-0056 D2/D9 — always drafted `strict: false`,
  never auto-strict), empty-encoding policy inference (D5), FK candidate
  scoring via cross-database value overlap (D6, keyMatchResolver-style trim +
  string equality), whole-draft assembly, and a never-clobber merge planner
  into the hub note's raw `fields:` map.
- `src/core/superstate/utils/typeProfileAdoption.ts` — runtime glue: gathers
  sibling-database field values from `contextsIndex`/`pathsIndex`, resolves the
  adoption target folder from an active path (folder/hub-note/row), builds the
  draft, and is the **only** function that writes (via
  `saveFrontmatterProperties`), invoked exclusively from the preview modal's
  confirm handler.
- `src/core/react/components/UI/Modals/TypeProfileAdoptionModal.tsx` +
  `typeProfileAdoptionAction.tsx` — the ADR-0015 preview/confirm modal and its
  shared open-and-wire orchestration, used by both entry points below.
- Two entry points, per the bead's "palette + hub-note affordance" ask:
  the `notidian-adopt-schema` command (`src/commands.tsx`) and an "Adopt
  Schema" item in the space header's `+` menu (`SpaceHeaderBar.tsx`).
- A new, independently-gated (`--adopt-schema`) live-verify harness scenario in
  `scripts/notidianRealVaultHarness.js` (`runSchemaAdoptionScenario`): creates a
  fixture "Sensor Registry" (bounded `sensor_class` vocabulary + `board_id`
  overlapping a sibling "Board Registry" fixture), triggers the real
  `notidian-adopt-schema` command, drives a real DOM click on the preview
  modal's confirm button, and asserts the hub note is unwritten before confirm
  and correctly profiled (drafted enum + FK reference) after. Not folded into
  the existing `--ui` table-UI scenario so it doesn't perturb that scenario's
  pinned eval-call-count test.

**Evidence:** `npm test -- --runInBand` 289/289 suites, 8964/8964 tests green
(89 new: 24 pure-planner, 15 runtime-glue, 3 modal, 10 harness-scenario unit
tests, plus 2 in `notidianVerify.test.js`); `npx tsc -noEmit -skipLibCheck`
exit 0; `npm run build` clean. `npm run verify:source`'s audit step fails on
the SAME pre-existing devDependency-only findings loan.1 already flagged and
filed as `Notidian-yf2a` (`@babel/core`/`esbuild`/`js-yaml` under
`istanbuljs`) — `npm audit --omit=dev` is clean (0 production
vulnerabilities); package.json/package-lock.json untouched this session, so
this is the same tracked baseline condition, not a regression. Live-verify
(`npm run deploy:vault` + `npm run verify:live -- --adopt-schema`, Obsidian
running this session per ADR-0051) — see the commit message / session
hand-off for the actual live run's outcome.

**Owner/next-session action:** once the bd remote schema-migration coordination
is resolved (designated migrator runs `BD_ALLOW_REMOTE_MIGRATE=1 bd migrate &&
bd dolt push`, or this clone is re-bootstrapped), claim and close
`Notidian-loan.3` with this entry as the evidence, and file the `bd note` on
`Notidian-loan.6` this bead's hand-off asks for (adoption-heuristic limits:
enum eligibility is gated to text/select/multi_select-shaped fields only;
bounded-cardinality cap is a fixed constant of 12 distinct values with at least
one repeat — no adaptive sampling; FK candidates require ≥2 distinct values and
a ≥60% overlap ratio, capped at the top 3 matches; adoption only ever ADDS
fields not yet declared — it never edits an already-declared field's enum/FK/
empty-policy, even to refine it).

### Notidian-21l4 — Navigator text filter: verify drag-and-drop while a filter query is active

**2026-07-05.** Fully investigated, characterized with regression tests, and
committed on `autolong/run-3` (`014d8bc`) — **not** a code-review or decision
item; a **bd-write-path infrastructure blocker** (`bd --claim`/`close`/
`remember`/`create` all refuse with `embeddeddolt: store is read-only` for this
clone throughout the session — a different failure signature than
`Notidian-loan.3`'s pending-migration message above, most likely a concurrent
embedded-dolt writer elsewhere on this heavily-parallel host; `bd show`/`list`
still work read-only).

**Important prerequisite finding — please read before re-routing follow-ups:**
`Notidian-nrjb` ("Vault file-tree text filter") is the feature this bead's
verification depends on. Its `bd show` record is `status: closed` with a
glowing "Shipped flag-gated..." `close_reason`, **but its `notes` field says
"Reverted: failed verification/review after fix attempts. Left open for
re-attempt."** — and indeed `git reflog show autolong/run-3` confirms its three
shipped commits (`e2cc88d`, `330986e`, `65399f4`) were reset out of this
branch's history (`autolong/run-3@{34}: reset: moving to 6492fb3`, discarding
`@{35..37}`) shortly after being committed, almost certainly by a concurrent
sibling session sharing this same working directory/branch. **No
navigator-text-filter code (`filterTreeByQuery` or otherwise) exists in this
tree today, on any local or remote branch** (`git grep filterTreeByQuery` is
empty everywhere). `Notidian-nrjb`'s status/notes are inconsistent (closed +
"left open for re-attempt") and should be reconciled once `bd` writes recover —
recommend reopening it, and re-scoping its two other still-open follow-ups
(`Notidian-d6lk` content/full-text match, `Notidian-a9m7` debounce) as blocked
on its re-attempt, same as this one was.

**What this bead actually delivered, given the above:** since there is no live
filter feature to drive, "verify" was done as a **clear-correct data-flow
audit** of the general-purpose (filter-agnostic) DND math itself, rather than
a live UI check:

- `getProjection`'s `getParentId` reverse-slice search only requires visible
  **ancestors** to be present in `flattenedTree` — an invariant any correct
  ancestor-inclusive filter already guarantees — and never depends on sibling
  contiguity, so an entirely omitted non-matching branch cannot corrupt
  depth/parent resolution.
- The rank committed by `dropPathInTree`/`dropPathsInTree` (`newRank =
  overItem.rank ?? -1`) is always the target's own `rank` field — traced to
  `superstate.ts` `getSpaceItems`: `rank: ranks.indexOf(f)`, the item's real
  absolute position in the full underlying context/mdb order — resolved via
  id-based `.find()`, **never** the `flattenedTree` array position.
- **Conclusion: no bug.** The design is already filter-safe by construction
  (id/field-driven, not array-position-driven).

Added 5 adversarial regression tests (2 in `dragPath.test.ts`, 3 in
`dropPath.test.ts`) building the exact non-contiguous, ancestor-only shape a
filtered tree would produce (an entirely omitted sibling branch, `sortable:
false` ancestor-only breadcrumb rows, and `rank` values with real gaps versus
array position) and pinning the correct resolution end to end for both
single- and multi-path drops, plus the ancestor-drop guard excluding a
filtered breadcrumb dropped onto its own visible matched descendant. These
lock in the exact contract any future re-implementation of `Notidian-nrjb`
must satisfy — this suite doubles as that feature's acceptance test the day
it's re-attempted.

**Evidence:** `npm test -- --runInBand` 293/293 suites, 9019/9019 tests green
(5 new); `npx tsc -noEmit -skipLibCheck` exit 0; `npm run build` clean
(pre-existing unrelated `TableView.css` warnings only; `main.js`/`styles.css`
byte-unchanged since only `*.test.ts` files were touched).

**Owner/next-session action:** once `bd` writes recover on this clone, claim +
close `Notidian-21l4` with this entry as evidence, reconcile `Notidian-nrjb`'s
closed-but-"left open for re-attempt" status, and re-scope `Notidian-d6lk` /
`Notidian-a9m7` as blocked on that re-attempt.

---

## Awaiting owner enable + live-verify — default-OFF flag-gated changes

These are **core render-path changes that are NOT owner-requested**, so per
[AGENTS.md](../AGENTS.md) they ship **default-OFF** and stay dark until the owner
enables the flag and live-verifies in the vault. Offline gates (tsc/jest/build)
prove the OFF path is byte-identical legacy behavior and the ON path's pure/DOM
logic; only the owner's in-vault use confirms the live placement/behavior.

### Notidian-b0fm — Nested-database row indicator wired into the TableView gutter

> **Owner-ask record:** rollup bead `Notidian-7suf` (ADR-0059) — this doc entry
> is the renderer; the rollup bead is the record and closes only when the
> enable/live-verify decision is recorded.

**2026-07-09 (`autolong/run-4`).** z21a follow-up: the standalone, already-tested
`HubRowIndicator` component (landed unwired in Notidian-z21a) is now wired into the
TableView row gutter, alongside `RowHealthBadge`, for a row that is itself the hub
of a same-named child folder. Gated OFF because it is a core render-path change with
no offline-provable placement, and there was no live hub row in the vault to verify
against at implementation time.

- **Setting:** `enableHubRowIndicator` (default `false`) — `src/shared/types/settings.ts`,
  defaulted in `src/core/schemas/settings.ts`, OFF-default pinned in
  `src/core/schemas/settings.defaults.test.ts` (`DOCUMENTED_REVIEW_QUEUE_FLAGS`).
- **What it does when ON:** for each data row whose file is the configured note of
  a same-named sibling folder (`shouldRenderHubRowIndicator` = `enableHubRowIndicator`
  AND `enableNestedHubRows` AND `isHubRowPath`), the gutter renders a small
  `.mk-hub-row-indicator` button; clicking it opens that nested child-database
  folder via `ui.openPath`. Gutter is otherwise unchanged.
- **Dependency:** requires `enableNestedHubRows` ON too (the indicator is
  meaningless without the nested-hub cascade/discovery behavior).
- **How to toggle:** set `enableHubRowIndicator: true` (and confirm
  `enableNestedHubRows: true`) in the plugin's `data.json`, then reload the plugin
  (`obsidian plugin:reload id=notidian`). No settings-UI toggle yet.
- **What to live-verify in the vault (the part gates can't cover):**
  - Open a database that has a hub row (a row whose file is the note of a
    same-named sibling folder, e.g. the Knowledge root's domain rows): the gutter
    of that row (and only that row) shows the indicator button.
  - Clicking the indicator opens the nested child database folder; clicking
    elsewhere on the row still selects/opens the row as before (the indicator
    `stopPropagation`s its own click).
  - Toggle the flag OFF → the indicator disappears and the gutter is byte-for-byte
    the pre-feature gutter.
- **Offline evidence in place:** `hubRowCascade.test.ts`
  (`shouldRenderHubRowIndicator` gate: both-flags-and-hub-row truth table),
  `HubRowIndicator.dom.test.tsx` (component render/click contract, pre-existing),
  and `TableView.hubRowIndicator.dom.test.tsx` (jsdom wiring: OFF/nested-OFF/
  non-hub-row = no indicator; ON + hub row = exactly one indicator, click opens
  the folder). `settings.defaults.test.ts` pins the OFF default. Full suite + tsc
  + build green.

---

## Awaiting owner USE — default-ON flag-gated changes (ship-then-verify)

These are **owner-requested core render-path changes** shipped **default-ON behind
a kill-switch** per [AGENTS.md](../AGENTS.md) (the owner's USE is the
live-verification). They are listed here so the owner knows what to exercise and
how to revert if a regression appears — not because they are gated OFF.

### Notidian-8h9 — Table row virtualization (assemble-before-paginate + windowed render)

✅ **Live-verified 2026-06-20 (default-ON); owner's ongoing USE remains the standing validation.**
Verified in the Atlas Vault on the installed v1.3.5 build: an **ungrouped 71-row**
table (Portfolio) mounts only a **bounded ~27-row window** with **no Load More
tfoot**; scrolling to the bottom advances the window to rows **[44–70]** (last row
reachable, **no data loss**) while the DOM row count stays constant; cells/frames/
stickers render intact on windowed rows; a **grouped** table (Device Registry,
`groupBy:["board"]`) correctly **falls back to legacy pagination** by design; no
console/`dev:errors` throughout. Fresh live evidence (2026-06-20, Atlas Vault
~1408 paths / 250 contexts) had confirmed the assemble-before-paginate +
no-row-virtualization triad made opening a large database visibly slow. The render
path now assembles all filtered/sorted rows and mounts **only the rows inside the
scroll window** (constant ~viewport-worth of DOM) instead of every loaded
row+cell.

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

### Notidian-z21a — Nested databases: row-as-child-hub (schema + views + row ops) — verify-then-build

> **RESOLVED 2026-07-05 (same day, follow-up session):** recovered exactly as
> prescribed below — cherry-picked `notidian-z21a-attempt-1` (skipping the
> interleaved, already-restored `8d0d32d`), moved `onPathDeleted(path)` inside
> the `if (deleted)` guard with a red-first regression test, adversarial
> re-review found no must-fix, landed as `3ce5380` (9126/9126 tests, build
> green). Follow-ups (HubRowIndicator wiring; `ui.notify` on swallowed
> primary-delete failure) are filed as `Notidian-b0fm`, not open scope here. The bd
> read-only diagnosis below is also superseded: root cause is the
> `.beads/config.yaml` `repos.additional` read-only hydration of
> `~/.beads-planning`, where the whole issue graph actually lives (see
> `Notidian-6amu` notes, 2026-07-05).

**2026-07-05.** Attempted on `autolong/run-3`, reverted after two real fix
rounds still left one unresolved must-fix finding — **not abandoned, fully
recoverable.** `bd`'s notes field could not be updated with this finding
directly (`Notidian-6amu`: `bd close`/`bd update --notes` fail
`embeddeddolt: store is read-only` while `bd create` still works — logged
here per the same infra-blocked-bookkeeping pattern as the `Notidian-21l4`
entry above), so the full diagnosis lives here instead.

- **Recovered work:** the attempt is permanently preserved at git tag
  **`notidian-z21a-attempt-1`** (`af2c55c`), three commits deep:
  `684d0aa` (initial build: `hubRowCascade.ts` planner + cascade rename/move/
  delete wiring in `path.ts` + row-scoped Type Profile key exclusion in
  `allProperties.ts`, all behind new flag `settings.enableNestedHubRows`,
  default ON per owner-requested provenance), `a08427c` (round 1: fixed 4
  independently-verified must-fix findings — wrong deletion API
  (`deleteSpace` instead of `deletePath`), unconditional cascade on rename/
  move even when the primary op failed, and an over-broad vault-wide Type
  Profile key exclusion narrowed to declaring rows only), `af2c55c` (round 2:
  fixed 2 more — paired `cascadeHubRowDelete` with `onSpaceDeleted` index
  cleanup, guarded `deletePath`'s cascade on the primary delete's own
  try/catch result).
- **The one remaining bug (why round 2 still didn't land):** two independent
  reviewer lenses converged on the same finding in `af2c55c`'s `deletePath`
  (`src/core/superstate/utils/path.ts`): `superstate.onPathDeleted(path)` runs
  **unconditionally**, one line before the `if (deleted)` guard that gates
  everything else added in this bead:
  ```ts
  let deleted = true;
  try { await superstate.spaceManager.deletePath(path); } catch (e) { deleted = false; }
  superstate.onPathDeleted(path);        // ← must move inside the guard below
  if (deleted) { await cascadeHubRowDelete(superstate, path); }
  ```
  `onPathDeleted` (`superstate.ts:701-729`) does the real, disk-persisted
  mutation — purges the row from every context/table view, `pathsIndex`,
  `spacesMap`/`linksMap`, dispatches `pathDeleted` — so a failed primary file
  delete still silently makes the row vanish from every Notidian view even
  though the file remains on disk. The fix is a one-line move: pull
  `onPathDeleted(path)` inside the `if (deleted)` block, alongside the cascade
  call. Cherry-picking `notidian-z21a-attempt-1` and applying that one move
  (plus a regression test asserting a failed primary delete never calls
  `onPathDeleted`) should be enough to land clean on the next attempt.
- **Grounding:** built against the real vault Knowledge root hub
  (`Knowledge.md`, seeded 2026-07-05, 0 rows at build time) and Atlas Method
  ADR-0042 D1 (root Knowledge DB whose domain rows are themselves hubs of
  child unit DBs, depth 1) — owner-requested provenance, not speculative.
  Verify-then-build step 1 (characterizing current schema-resolution/view-
  picker/row-op behavior on a hub-row) found the view/space-selection half
  already works unconditionally (adjacent-mode hub-note resolution in
  `spaceInfo.ts`, already covered by `spaceInfo.test.ts`); the real gaps were
  only the cascade rename/move/delete + Type Profile key leakage this bead
  addressed.
- **Also shipped, standalone:** a `HubRowIndicator` component, jsdom-tested but
  **not yet wired into any row-rendering surface** — wiring it in is separate,
  follow-up scope, not part of the revert.

## Pending — decisions (pick a direction)

_(none — the two items queued earlier on 2026-07-05 were decided and executed
the same day, owner having delegated the call:_
- _**`Notidian-loan.4` DoD gap → BUILT, not relaxed.** The missing live-harness
  scenario shipped: `--reconciler` flag threaded through
  `notidianRealVaultHarness.js`/`notidianVerify.js` per the loan.3
  `--adopt-schema` precedent; external raw edit → `required` violation →
  restore → clean; broken-YAML edit → single `malformed-row` violation, no
  crash. Both `verify:live` modes green. Empirical yield: ADR-0057 D4's
  parse-failure assumption (absent `metadata.property`) confirmed against real
  Obsidian, previously mock-only._
- _**bd store architecture → migrated (option b, the Atlasidian precedent).**
  Forensics showed `~/.beads-planning` was bd-init fork-detection fallout
  (experimental bd-307), not architecture: zero git commits/remotes, Notidian
  the only repo still routing there. Full 457-issue export/import into this
  repo's own store; `routing.mode: "maintainer"`; hydration commented out;
  write path proven natively; memories intact (321); `bd stats`/`bd export`
  read 457 where they read 0. `~/.beads-planning` holds a frozen pre-migration
  copy as fallback — do not write there. Upstream guard inconsistency remains
  tracked in `Notidian-nir`.)_

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

**Decision-ADRs — clear-correct, auto-resolved into shipped fixes (status lives in
the [ADR index](adr/README.md), not copied here):**

The offline-provable Decision-ADRs the loop refused to build blind and then resolved
into shipped fixes — ADR 0025/0026/0030–0038, 0040–0048, the ADR 0041 view-search
consolidation, and the ADR 0040 case-fold divergence follow-up (beads `e8e fs6 od7
5zc qbr 0id 37m sp5 2zs jko drp k6a5 z8q ywcf 9i9i 2yh k778 p5qt dgo6 ircw wcig`),
plus ADR 0024 (`2uz`) and ADR 0029 (`tni`) whose engines shipped — are all **CLOSED**
and carry Status **Accepted, implemented** in [docs/adr/README.md](adr/README.md),
each with per-fix evidence in its `bd close` reason + commit sha (index
status-currency reconciled 2026-07-10 via `Notidian-7sa0`, commit `6524a3a`). They no
longer await the owner, so the sha-by-sha enumeration was removed from this review
surface — read status live from the ADR index / `bd show <id>`, never a copy here.

- **Still OPEN — do not treat as resolved:** **`Notidian-nir`** (ADR 0027) — the bd
  embedded-dolt `export`/`stats` blind is an **upstream** action item with **no
  in-repo fix**; the JSONL-mirror policy is Accepted but the tracking bead stays
  **OPEN** until an upstream bd release re-exports the full graph.
- **`Notidian-2w0`** (Notion-parity epic) stays **OPEN** in bd for its remaining
  roadmap items; only its ADR 0021 in-table quick-find sub-item shipped (child
  `Notidian-r20`, later consolidated by ADR 0041 / removed by ADR 0049).

**Parked → docs/ROADMAP.md (build only when the owner asks):**

- **Notidian-o4w — select-to-comment + AI-review channel** (ADR 0019) — parked → roadmap.
- **Notidian-5io — date reminders + recurring events** (ADR 0020) — parked → roadmap.
- **Notidian-214 — frame-execution settings toggle + trusted-frame allowlist** (ADR 0022) — parked → roadmap (gated on the `hardenFrameExecution` flag-gated item above).
- **Notidian-n2t — Type Profile hub-deletion notice** (ADR 0023) — parked → roadmap (ADR recommends decline).
- **Notidian-e29 — per-database row-create templates in the table** (ADR 0028) — parked → roadmap.
- **Notidian-jlb5 — control-byte source guard** (ADR 0039) — parked → roadmap (repo currently clean; regression insurance only).

_(ADR 0024 sub-items UX (`2uz`, superseded by ADR 0050) and ADR 0029 relations+rollups
(`tni`, owner-pulled 2026-06-20) were previously listed here as parked; both are
Accepted with engines shipped and their beads CLOSED — see the ADR index, above.)_
