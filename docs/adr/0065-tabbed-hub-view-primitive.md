---
type: adr
adr_id: "0065"
title: Tabbed Hub View Primitive
status: accepted
date: 2026-07-29
context_class: history
---

# ADR 0065: Tabbed Hub View Primitive

## Status

Accepted (engine contract owner-ratified via Atlas Method ADR-0096 D2,
2026-07-29; internals decided here per the 0083-pattern). Carrier bead
`Notidian-pb7p.1` (epic `Notidian-pb7p`).

## Context

Atlas Method ADR-0096 retires canvas cockpits: every vault hub becomes a
tabbed, full-page dashboard rendered by Notidian, with one grammar across all
hubs. The engine contract names H1 — the tabbed hub view primitive — as the
keystone: a hub declares an ordered set of tabs; Notidian renders a persistent
top tab bar (all options always visible — no spatial memory); each tab opens a
full-page, dense, authored composition (a markdown page of notidian embeds and
header blocks), not just one table view.

Binding constraints inherited from the Atlas contract:

- Tab declarations are agent-editable, versioned config; ephemeral UI state
  (the active tab) stays in `.notidian` (Atlas ADR-0066 D4 config-vs-state
  split).
- Dense multi-embed pages must be load-tested before v1 ships (Atlas ADR-0066
  D8 guardrail).
- Mobile is deferred; the primitive must merely not break on touch (Atlas
  ADR-0096 D6).
- H2 (`Notidian-pb7p.2`, shipped) provides the zero-chrome embed building
  blocks: `bar: false` and hard read-only embeds.

Existing machinery this decision builds on:

- The space page composes as `SpaceInner` = `SpaceHeader` + `SpaceNoteBody`
  (folder note inline) + `SpaceOuter` (view body).
- `NoteView` (`core/react/components/PathView/NoteView`) renders an arbitrary
  note's body inline — the same component `SpaceNoteBody` uses — so an
  authored composition note can render full-page inside the space view with
  its notidian embeds live.
- `saveSpaceMetadataValue` persists per-space view state onto the
  `SpaceDefinition`, which lives at `<folder>/.notidian/def.json` — the
  shipped precedent is `noteBodyCollapsed`/`noteBodyHeight` (Notidian-8sl).
- ADR 0062 established the folder-note frontmatter declaration grammar
  (`views:`): ordered list, stable lowercase slug ids, fail-closed validation.

## Decision

1. **Declaration home.** The hub's folder note frontmatter owns an ordered
   `tabs:` list. Each entry is a mapping with:
   - `id` (required): stable lowercase slug (`[a-z0-9-]+`), unique within the
     list. Machine identity for state and tests; never derived from names.
   - `page` (required): path to the authored composition note, resolved
     against the hub folder first, then vault-absolute.
   - `name` (optional): display label; falls back to the page basename.
   Unknown keys on an entry invalidate the declaration (ADR 0062 §6 posture).

2. **Declaration-attempt classification.** The `tabs:` key is treated as a hub
   declaration only when its value is a non-empty array whose entries are
   mappings. Any other shape (scalar, list of strings, empty list) is not a
   declaration: the space renders the legacy page with no banner. This keeps
   an unrelated user `tabs:` property from bricking a folder view, while real
   declaration attempts get strict validation.

3. **Mount seam.** `SpaceInner` renders `HubTabsView` in place of
   `SpaceNoteBody` + `SpaceOuter` when (a) the space's folder note declares a
   structurally valid `tabs:` list and (b) the default-ON kill-switch
   `settings.hubTabbedViews` is enabled. `SpaceHeader` stays. With the flag
   OFF or no declaration present, the space page renders byte-identical to the
   legacy composition.

4. **Tab bar.** `HubTabsView` renders a persistent top tab bar listing every
   declared tab in declaration order — always all visible, wrapping onto
   additional rows on overflow, never collapsing into a dropdown (the
   no-spatial-memory ruling). Plain buttons; click switches tabs; no hover
   dependency (tooltips are H3). Touch works because they are ordinary
   buttons.

5. **Tab content.** The active tab renders its `page` note full-page through
   `NoteView` (same component and semantics as the folder-note body,
   including `readOnly` following the space's read mode). Embeds inside the
   composition are ordinary notidian embed blocks — with H2's `bar: false`
   and default read-only they render zero-chrome. Only the active tab's
   composition is mounted; switching unmounts the previous one (bounds the
   per-page provider-tree cost the D8 guardrail prices).

6. **Active-tab state.** The last active tab id persists as
   `SpaceDefinition.activeHubTab` via `saveSpaceMetadataValue` — landing in
   `<folder>/.notidian/def.json`, never in frontmatter (Atlas ADR-0066 D4).
   Default is the first declared tab; a persisted id no longer in the
   declaration falls back to the first tab.

7. **Failure surfaces.** A structurally invalid declaration attempt (missing
   or malformed `id`/`page`, duplicate ids, unknown keys) renders the legacy
   space page plus a visible error banner naming every violation — fail
   visible, never fail-brick, never partial-apply (no tab bar from an invalid
   declaration). A valid declaration whose `page` note is missing at render
   time keeps the tab bar and renders the error surface in that tab's content
   area only.

8. **Load-test gate.** Before the epic's v1 is declared shipped, a
   representative dense multi-embed hub page (one tab with ≥6 embeds across
   ≥2 databases) is exercised through the live deploy harness
   (`npm run deploy:vault` + `obsidian dev:*`, ADR 0051) and the observed
   render/interaction cost recorded on the carrier bead (Atlas ADR-0066 D8).
   This gate rides `Notidian-pb7p.5` together with the H2 live checks.

## Options Considered

### A. Container view: space view hosts the bar and renders the active tab inline — Chosen

One leaf, no navigation; the hub is one surface whose tabs swap the rendered
composition. State is one `.notidian` key; the bar is trivially persistent;
the legacy space page is untouched without a declaration. Deep-linking to a
tab is deferred (acceptable: hubs are entry surfaces, not link targets).

### B. Navigation model: tabs open real notes, bar injected into each member note's view — Rejected

Native note rendering and free deep links, but the bar must be injected into
every member note's markdown view (a new decoration surface), active-tab
state becomes implicit in navigation history, and the hub stops being one
surface — back-button and pane behavior diverge per tab. More moving parts
for the same ratified UX.

### C. Frontmatter-declared tabs on the folder note — Chosen (over a dedicated config file or MDB)

Mirrors ADR 0062's `views:` grammar: agent-editable, versioned, one home,
schema-with-data. An MDB or `.notidian` home would make durable config
unversioned and agent-opaque, violating the D4 split in the other direction.

## Consequences

- New pure module `hubTabs.ts` (declaration parsing/validation) and
  `HubTabsView` component; `SpaceInner` gains the mount seam;
  `SpaceDefinition` gains `activeHubTab`; settings gain the `hubTabbedViews`
  default-ON kill-switch (advanced category).
- Atlas-side consumers (Life HQ, Operations/Knowledge/Gidi hubs) author hub
  folder notes with `tabs:` lists and per-tab composition notes; no Atlas
  work is blocked on anything beyond this primitive plus shipped H2.
- H3 (density/tooltips/wrap) layers onto the same compositions without
  touching this contract; H4 supplies header freshness projections.
