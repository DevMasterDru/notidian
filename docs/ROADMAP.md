# Notidian Roadmap (pull when wanted)

These are speculative product features the owner has **not** requested. Nothing
here is built on a schedule or "because it's queued" — each item is built **only
when the owner asks for it**. The linked ADR is the grounding (context, options,
and a recommendation already worked out) so that, when pulled, the build starts
from a settled design rather than a blank page.

## Pulled into build (active stream)

The owner pulled these on 2026-06-20 — they are no longer "parked"; their ADRs are
**Accepted** and they are scheduled as window-sized session issues. See epic
**`Notidian-f0pj`** and packet `docs/streams/notion-parity-ux.md`.

- **Sub-items + back-relations creation UX** (ADR 0024 → bd `Notidian-f0pj.1`).
- **Frontmatter-link relations + rollups UX polish** (ADR 0029 → bd `Notidian-f0pj.2`).

## Parked — build when the owner asks

- **Select-to-comment + AI-review channel** — anchor a vault comment to a selection (block-id `^block`) and store AI-directed comments as a frontmatter `review.comments` list; cross-repo contract with Atlasidian. — ([ADR 0019](adr/0019-select-to-comment-anchoring-and-ai-review-channel.md))
- **Date reminders + recurring events** — in-app Notice reminders for due dates and rrule-shaped `repeat` recurrence expanded at render time (no external plugin, no generated rows). — ([ADR 0020](adr/0020-date-reminders-and-recurring-events.md))
- **Frame-execution settings toggle + trusted-frame allowlist** — a UI toggle for `hardenFrameExecution` plus a non-persisted, user-blessed way to re-trust a custom frame's `$api`; only relevant once frame-hardening is kept ON. — ([ADR 0022](adr/0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md))
- **Type Profile hub-deletion notice** — surface when a folder DB's Type Profile hub note is deleted out from under it (ADR's own recommendation is to decline; low-value P3). — ([ADR 0023](adr/0023-type-profile-hub-deletion-notice.md))
- **Per-database row-create templates in the table** — honor a database's default `.md` template when adding a row from the table/context (not just the sidebar `+`), seeding frontmatter + body. — ([ADR 0028](adr/0028-per-database-row-create-templates.md))
- **Control-byte source guard** — CI/lint regression insurance that blocks raw NUL/C0 control bytes from re-entering tracked source (repo is currently clean; this is prevention, not a fix). — ([ADR 0039](adr/0039-control-byte-source-guard.md))
- **sortingUtils falsy-value edge semantics** — decide how chart sorting/categories should treat meaningful falsy data: an option with `.value` `0`/`''`/`false` (currently dropped by a truthy filter) and a real `0` field value (currently collapsed to `''` by `String(d[field]||'')`) in `getOptionsOrder`/`getUniqueSortedValues`. — (`src/core/react/components/Visualization/utils/sortingUtils.ts`; comparator-correctness posture [ADR 0025](adr/0025-array-comparator-correctness.md)/[ADR 0033](adr/0033-intelligentcompare-viz-comparator-non-transitivity.md), locks in `sortingUtils.test.ts`)
- **AI-created custom Notidian views on request** — let the operating AI (Atlasidian MCP / `notidian` skill) create a named, persistent filter/sort/group/columns/viewType view on a target database; the HOW (CLI affordance vs `createView` API vs frontmatter convention) is undecided, so it stays parked until the owner pulls it. — (data model: `SpaceTableSchema` `type:"view"` in `src/shared/types/mdb.ts` + serialized predicate `src/shared/types/predicate.ts`, persisted in the context MDB `m_schema`; epic `Notidian-2w0`, persistence dep `Notidian-eedq` fixed; bead `Notidian-batd`)
- **jsdom provider-mount harness for ContextEditorProvider** — add a jsdom jest project (+ transformIgnorePatterns/moduleNameMapper for the ESM matchers.js import) and mount the provider to drive TableView paste/edit through React; the write bridge is already covered at the composition layer via the node extract + fake Obsidian adapter, so a provider mount only adds React-state/remount coverage. — (`src/core/utils/contexts/__audit__/__fakes__/`, partial dom seam `TableView.virtualization.dom.test.tsx`; bead `Notidian-d73i`, dep `Notidian-3dv`)
