# ADR 0066: Retire the Beads Product and Task Tracker Behind a Dormant Archive

## Status

**Accepted and executed — owner-directed 2026-08-03.** This decision supersedes
ADR 0027's tracker policy and ADR 0064's tracker-driven execution model.

## Context

The Beads observation/workbench experiment added 45 contiguous commits after
`000620b4`, touching 271 files with roughly 74,000 inserted lines. It was useful
work, but the owner no longer uses Beads and does not want its runtime, tests,
documentation, task graph, hooks, or routing instructions to tax future
Notidian development.

A source-only extraction would not be a faithful archive. The workbench depends
on Notidian's database, table, context, Obsidian adapter, and rendering layers;
detaching only Beads-named paths would preserve files but not a buildable system.

## Decision

1. Preserve the complete experiment in the private, dormant repository
   [`DevMasterDru/notidian-beads-archive`](https://github.com/DevMasterDru/notidian-beads-archive).
   Its default branch contains an archive manifest. Exact refs preserve the
   native/restored result (`de4e7ad9`), HTML-dashboard variant (`803c8963`),
   shared UI checkpoint (`410126b1`), pre-experiment boundary (`000620b4`), and
   the former Dolt data/remote-information refs.
2. Continue the active Notidian line from `000620b4`, the parent of the first
   workbench commit. Do not cherry-pick experiment-born generic infrastructure
   speculatively; it remains available for deliberate later extraction.
3. Notidian has no repository-wide task tracker. Owner requests, current-state
   documentation, accepted ADRs, and focused turn-local plans govern work.
   Historical `Notidian-*` identifiers remain inert provenance, not live work.
4. Remove automatic tracker hooks, the project Beads skill, tracker-specific
   root instructions, local hook routing, and active remote Beads/Dolt refs.
5. Keep the archive behind one pointer. Do not add it as a submodule, subtree,
   symlink, secondary remote, or default search path; revival must be explicit.

## Integrity and Recovery

Before active history changed, a bare mirror and a complete verified Git bundle
were written outside the repository. A fresh clone of the private archive was
verified against every critical ref and passed `git fsck --full`. The archive
manifest documents exact hashes and recovery commands.

## Consequences

- Active source, builds, tests, searches, and agent routing no longer include the
  Beads workbench or tracker.
- The experiment stays buildable and recoverable without taxing ordinary work.
- Old ADRs, code comments, and test names may retain issue identifiers where they
  explain provenance. They confer no tracker semantics and should not be queried
  as current state.
- Reintroduction requires a new owner decision and a deliberate port from the
  archive; it is never implicit compatibility work.
