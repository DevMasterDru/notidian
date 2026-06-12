# Frontmatter-link Relations + Rollups — Design

**bd:** Notidian-9ln · **Epic:** Notidian-2w0 · **Date:** 2026-06-12 · **Status:** in progress (engine landed)

## Problem

The #1 Notion-parity gap. Relations are already stored as frontmatter `[[links]]`,
and the aggregation functions already exist (`aggregateFnTypes` / `calculateAggregate`).
But the existing rollup/aggregate path (`linkContextRow.ts`) reads linked rows
from the **MDB context table** (`contextsMap…contextTable.rows`), not from the
linked notes' own frontmatter — so rollups are governed by a parallel database
instead of the file-canonical authority.

## The cache decision (settled)

There is **no new cache to build.** `superstate.pathsIndex` already holds every
note's parsed frontmatter in memory, maintained and invalidated on writes. The
rollup resolves each linked row via `pathsIndex.get(path)?.metadata?.property`,
so there is **no per-render disk-read perf cliff** — the original scoping's main
risk is dissolved. We add a clean, frontmatter-canonical engine alongside the
existing MDB path rather than inverting `linkContextRow` wholesale.

## Architecture

| Unit | Status | Responsibility |
| --- | --- | --- |
| `core/utils/contexts/tableRollup.ts` *(pure, 11 tests)* | **landed** | `parseRelationLinks(value)` → target paths (wikilinks/array/CSV, aliases stripped, deduped); `computeFrontmatterRollup({linkPaths, config, resolveFrontmatter})` → aggregated string (count / count_values / values / sum / avg / min / max) |
| Runtime bridge | follow-up | resolve a row's relation value → paths → frontmatter (via `pathsIndex`, with wikilink→path resolution) → `computeFrontmatterRollup` |
| Rollup cell display | follow-up | read-only cell rendering the computed value |
| Rollup column config UX | follow-up | pick relation property + target property + aggregate fn |

## v1 slice (this session)

The **pure engine** (`tableRollup.ts`) — the highest-value, fully-testable core.
It proves the model and is reusable by whatever wiring lands next.

## Sessionized follow-ups (own beads)

- Runtime bridge + wikilink→path resolution (basename fallback, perf-bounded).
- Read-only rollup cell + column type registration.
- Rollup config UX (relation/target/fn pickers).
- Inverse / back-relations ("linked from").
- Migrate existing MDB `aggregate`/`context` columns to the frontmatter engine.

## Authority / safety

Read-only and frontmatter-canonical. The engine never writes; it only reads
linked rows' frontmatter. No MDB relationship table is created or relied upon.
