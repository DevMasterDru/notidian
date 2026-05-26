# ADR 0012: Custom Bases View Feasibility Gate

## Status

Accepted.

## Date

2026-05-26

## Context

ADR 0011 made Bases-first convergence the strategic direction for Notidian. The remaining question is how to move toward native Bases without losing the table behavior Notidian already needs:

- file rows governed by Markdown files;
- ordinary editable properties governed by frontmatter;
- page-title edits implemented as file renames;
- range paste, conflict handling, and undo routed through authority-aware writes;
- legacy Make.md context data preserved until it is audited and migrated.

Obsidian's custom Bases view API gives plugins a way to register a new view type for `.base` files. A custom view receives a Bases query controller and is notified through `onDataUpdated` when the Bases result changes. The view can read the current `BasesView.data` result, including grouped entries and visible properties.

That is the right native surface to test before replacing Notidian's context-centered table renderer.

There are important constraints:

- the local `obsidian` package used by this repository does not yet expose typed `BasesView`, `QueryController`, or `registerBasesView` declarations;
- the custom view read path is documented, but the full write/edit surface needed for Notidian's table UX still needs runtime proof;
- live capability capture showed no native `entry.setValue` surface, so the first safe write path must route through Obsidian's existing file/frontmatter authority instead of assuming a Bases row writer;
- a full replacement before proving the API would risk weakening current file-title rename, frontmatter conflict, paste, and undo guarantees;
- Notidian must not create a hidden mirror table under the custom view just to make the UI work.

## Decision

Add a minimal runtime-compatible Notidian custom Bases view with type:

```text
notidian-table
```

The first implementation is intentionally a feasibility gate:

- register the view only when the running Obsidian host exposes `registerBasesView`;
- use a small compatibility shim instead of importing unavailable local Bases typings;
- instantiate a `NotidianBasesView` through the documented custom view factory shape;
- read visible property order from the Bases view config when available;
- read rows from the current Bases query result (`groupedData` or `data`);
- render a basic table projection from those native Bases entries;
- allow the first narrow edit path for ordinary note properties by writing through Obsidian's `fileManager.processFrontMatter`;
- keep file projections, formulas, and file-title cells read-only until their authority-aware transaction paths are mapped into the custom view;
- keep the existing Notidian context table as the production enhanced editor until Bases-backed editing is proven.

The custom view must not persist hidden ordinary row values. It is a projection over the Bases result, and accepted ordinary property edits go directly to Markdown frontmatter. Ordinary data remains governed by files, file names, and frontmatter.

## Why This Is The Best Next Step

This path balances the three competing goals:

| Goal | Why the custom-view gate fits |
| --- | --- |
| Native alignment | The view is opened from `.base` and receives Obsidian's Bases query result instead of rebuilding a separate folder database. |
| Notion-like UX | It gives Notidian a place to move its spreadsheet/table interactions later without abandoning the existing safe table prematurely. |
| Delivery and data safety | The first step proves registration and read lifecycle only, avoiding a broad rewrite against partially typed runtime APIs. |

Keeping the current table as the production editor is not a rejection of Bases. It is the safe bridge: Notidian can compare its mature UX against the native Bases host surface before moving writes.

## Why Not A Full Custom Bases Table Immediately

A full immediate replacement was rejected because it would require solving several uncertain areas at once:

- how custom Bases views should commit edits to note properties;
- how to preserve Notidian's stale-frontmatter conflict detection inside a Bases-hosted view;
- how to perform file-title renames from a Bases row without accepting detached title strings;
- how to replay undo/redo through the same authority-aware write paths;
- how to handle unsupported legacy Make.md context-only columns;
- how to test runtime API behavior when the local development package lacks current Bases typings.

Doing all of that in one step would increase the chance of breaking the exact guarantees Notidian exists to provide.

## Why Not Stay Context-Only

Staying context-only was rejected because it keeps the fork too close to Make.md's original split mechanism. Context MDB remains useful for compatibility, legacy data, explicit Notidian-owned fields, and advanced state, but it should not be the default center of ordinary database behavior.

The custom Bases view is the first concrete step that moves rendering toward Obsidian's native database host rather than just exporting `.base` files beside the context system.

## Implementation

Main files:

- [notidianBasesView.ts](../../src/adapters/obsidian/bases/notidianBasesView.ts)
- [notidianBasesView.test.ts](../../src/adapters/obsidian/bases/notidianBasesView.test.ts)
- [main.ts](../../src/main.ts)

Implemented behavior:

- `registerNotidianBasesView` returns `false` when the runtime does not expose `registerBasesView`.
- When supported, it registers `notidian-table` with display name `Notidian Table`.
- The factory creates `NotidianBasesView`.
- `NotidianBasesView` renders from the live Bases query result, not from Notidian context MDB rows.
- Ordinary note-property cells are editable and write to the row file with `fileManager.processFrontMatter`.
- `file.*` and `formula.*` cells are read-only; `file.name` is intentionally not editable yet because page-title edits must go through rename transactions.
- The snapshot helper is pure and tested so future API-shape changes can be handled without hiding durable data.
- The cell edit planner is pure and tested so unsupported targets fail before the UI can accept a detached value.
- The view captures runtime capabilities for the active controller, config, data, first entry, value object, and apparent write surface.
- The real-vault smoke harness has an opt-in `--base-view` mode that creates and opens a temporary `.base` file with `type: "notidian-table"`, fails if capability metadata is missing or incomplete, edits a `status` note-property cell, and verifies the Beta fixture note's frontmatter changes.
- The smoke `.base` includes `file.ext == "md"` because live testing proved a folder-scoped Base can otherwise include the `.base` file itself as a row.

The capability capture records:

- controller keys exposed to the custom view;
- documented config methods such as `get`, `getOrder`, `getSort`, `getDisplayName`, and `set` when present;
- whether `data`, `groupedData`, and visible properties are present;
- the first entry's file path and value methods;
- whether the entry appears to expose a native `setValue` method.

This is intentionally diagnostic. It is not a new data model and it is not a durable user-facing metadata store.

## Current Limits

This ADR accepts only the feasibility gate, not final Bases-backed table parity.

Still needed:

- preserve capability snapshots from supported Obsidian versions as the API evolves;
- mapping Notidian's current table edit transaction helpers into a Bases-hosted view;
- page-title rename cells inside the custom view;
- range copy/cut/paste, conflict feedback, undo, and future redo inside the custom view;
- typed frontmatter edits beyond the current string value path;
- migration behavior for existing Make.md context-only columns when a view is moved to `.base`.

## Invariants

Future work on the custom Bases view must preserve these rules:

- A Bases-hosted row still represents a Markdown file.
- Editing `file.name` or the page-title cell must perform a file rename transaction.
- Editing ordinary note properties must write frontmatter before the UI accepts the value.
- The custom view must not create durable hidden row values for ordinary frontmatter-backed properties.
- Unsupported context-only data must be surfaced as unsupported, legacy, or explicit Notidian-owned state.
- Current safe Notidian table behavior must remain available until the Bases-hosted path reaches equivalent safety.

## Relationship To Other ADRs

- ADR 0011 defines Bases-first convergence.
- ADR 0001 defines the authority-partitioned source-of-truth model.
- ADR 0002 defines frontmatter-backed ordinary properties.
- ADR 0003 defines file-title edits through rename transactions.
- ADR 0006, ADR 0007, ADR 0008, and ADR 0009 define the transaction, feedback, undo, and conflict guarantees that a future Bases-hosted editor must preserve.
- ADR 0010 defines why legacy context data cannot be discarded during convergence.
