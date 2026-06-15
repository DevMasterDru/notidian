# ADR 0027: Upstream bd Embedded-Dolt `export`/`stats` Are Blind to Issues — JSONL Mirror Policy

## Status

Proposed. Awaiting owner direction (bd Notidian-nir). This is an **owner/upstream
action item, not an in-repo code change** — there is no Notidian source to edit.
The autonomous loop refused to fabricate a passive `.beads/issues.jsonl` mirror
to "make the file non-empty," because a hand-built mirror would be lossy and
misleading (see Decision 2). This ADR records the question, the options for how
the owner carries the upstream bug, and the recommended JSONL-mirror policy until
a bd release fixes it.

## Date

2026-06-15

## Context

This project tracks work in **bd (beads)**, whose architecture is: issues live in
a local Dolt DB; the git-committed `.beads/issues.jsonl` is a **passive export
mirror** of that DB (see the bd `SYNC_CONCEPTS` doc referenced in `CLAUDE.md`).

On **bd 1.0.5 (Homebrew, embedded-dolt mode)** in this repo, the HEAD-reading
code paths are blind to the issue rows. Re-verified live for this ADR (repo root,
2026-06-15):

| Command | Result |
| --- | --- |
| `bd list --all` (working view) | **113 issues** (8 open, 10 in progress) |
| `bd stats` (HEAD reader) | **Total Issues: 0** |
| `bd export -o /tmp/x.jsonl` | **Exported 0 issues** (0 lines) |
| `bd export --all` (from osf diagnosis) | 22 lines, **all `_type:memory`, zero `_type:issue`** |
| `dolt sql 'SELECT COUNT(*) FROM issues'` (from osf) | **0** |

The original 82-issue count from the Notidian-osf diagnosis is now 113 — the gap
**grows as work is filed**, confirming new writes are still not landing in the
committed `issues` table.

### Root cause (evidence-backed, from Notidian-osf + bd memory)

The `issues` table is empty at **every committed Dolt root the HEAD-reading paths
query** — committed HEAD, STAGED, WORKING, all history, and the Dolt-native
backup (`last_dolt_commit == live HEAD`). `dolt status` is clean, yet
`dolt_branches.dirty = true`. The 113 issues exist **only** in bd's in-process
embedded-engine view that `bd list` reconstructs; they were **never persisted to
the `issues` table on any branch HEAD**. Memories *did* commit (config table
`kv.memory.*`, 22 rows — which is exactly the 22 lines `bd export --all` emits).
So `export`/`stats` (HEAD readers) are blind to issues; `list` (working view) is
not. Full finding: bd memory key
`bd-105-embedded-dolt-export-stats-blind-to-issues-osf`.

### What is already ruled out (so this is not an in-repo fix)

From the Notidian-osf investigation:

- **db-name casing** — single `Notidian` dir; bd and the Dolt CLI agree on the
  capital `N`.
- **branch / HEAD** — only `main`; the table is empty on every committed root.
- **WORKING-vs-HEAD staging** — `bd dolt commit` says "Nothing to commit"; a
  fresh `bd update --notes` write still leaves committed `issues = 0`.
- **upgrade** — 1.0.5 is the **newest GitHub release and Homebrew stable**, not in
  `brew outdated`. We are already on the newest bd; re-confirmed `bd version`
  reports `1.0.5 (Homebrew)`.
- **backup-restore / db-name / branch surgery** — none address an empty committed
  table.

The fix must come from **bd**: persist issue writes to the committed `issues`
table in embedded mode (or provide a working-set→JSONL export path). It is not
addressable by Notidian repo config, branch, HEAD, db-name, or backup.

### Blast radius (small, and important to state plainly)

**Daily bd work is UNAFFECTED.** `bd list`, `bd show`, `bd update`, `bd ready`,
`bd close`, `bd remember` all operate on the working view and behave correctly —
this very session claimed, queried, and will note a bead through that path. The
**only** thing blocked is the passive `.beads/issues.jsonl` git mirror, which
stays empty because `bd export` reads the (empty) committed table. The Dolt DB
itself is healthy.

## Decision 1 — How to carry the upstream bug

**Options:**

- **(1a) File upstream + retest each bd release; close the blocked mirror bead
  when a release re-exports the full graph (recommended).** Open an issue on the
  active bd repo (`github.com/steveyegge/beads`, or the maintained fork
  `gastownhall/beads` referenced in `CLAUDE.md`) with the minimal repro below.
  On each new bd release, re-run the one-line repro; when `bd export` emits the
  full `_type:issue` set, re-export, commit `.beads/issues.jsonl`, and close
  Notidian-osf. Until then the bead stays an open, low-cost watch item. This costs
  the owner one upstream filing and a ~30-second retest per release, and keeps the
  fix where it belongs (the bd binary).

- **(1b) Pin/downgrade bd, or switch this repo to bd server-mode / file-DB
  backend.** A backend change *might* sidestep the embedded-dolt write path. But
  it is speculative (no evidence a different backend persists where embedded does
  not), it changes this repo's bd operating model for every future contributor and
  the Atlas Method sync contract (`refs/dolt/data`), and it risks the working data
  that `bd list` currently reconstructs correctly. High blast radius to chase a
  mirror that daily work does not need. Rejected as the default.

- **(1c) Do nothing / accept the empty mirror silently.** Zero effort, but the
  bug then goes unreported (so it never gets fixed upstream) and the empty
  `.beads/issues.jsonl` looks like data loss to a future reader with no recorded
  explanation. Rejected: the cost of (1a) is trivial and (1c) loses the paper
  trail.

## Decision 2 — JSONL mirror policy until a fix ships

**Invariant:** the committed `.beads/issues.jsonl` must either be a **faithful**
export or an **honestly empty** file with a recorded reason — never a fabricated
or drifting hand-built substitute.

**Options:**

- **(2a) Leave the mirror empty-by-design; record why; never fabricate
  (recommended).** Keep `.beads/issues.jsonl` empty until `bd export` works, with
  the reason captured here (ADR), in the bead, and in bd memory. The DB (`bd
  list`) remains the source of truth, exactly as bd's architecture intends. No
  drift, no misleading artifact.

- **(2b) Hand-build a JSONL mirror from `bd list --json`.** Makes the file
  non-empty, but it is **lossy and drift-prone**: `bd list --json` does not carry
  the comments / dependencies / labels arrays the real export does, and a
  hand-rolled writer cannot match bd's field-omission rules — so the mirror would
  silently disagree with the DB and could be mistaken for ground truth on a future
  re-import. Rejected: it trades an honestly-empty file for a quietly-wrong one.

- **(2c) Generate a partial mirror and mark it `partial: true`.** Mitigates the
  "looks like ground truth" risk of (2b), but bd has no such convention; a custom
  marker bd does not read is dead metadata, and the file still drifts. Rejected:
  invents a non-standard format on the passive mirror to paper over an upstream
  bug.

## Recommendation

**Decision 1: adopt (1a)** — file the bug upstream with the minimal repro and
retest `bd export` on each new bd release, closing Notidian-osf when a release
re-exports the full graph. One line: the defect is in the bd binary and we are
already on the newest bd, so the only durable fix is upstream — and the retest is
near-free while daily work is unaffected.

**Decision 2: adopt (2a)** — keep `.beads/issues.jsonl` **empty by design** until
`bd export` works, with the reason recorded here, in the bead, and in bd memory;
never fabricate a mirror. One line: an honestly-empty file with a recorded cause
is safer than a lossy, drifting hand-built one that could be mistaken for the
source of truth.

### Minimal upstream repro (paste into the bd issue)

```
# bd 1.0.5 (Homebrew), embedded-dolt mode, in a repo with N filed issues:
bd list --all          # -> Total: 113 issues  (working view sees them)
bd stats               # -> Total Issues: 0      (HEAD reader is blind)
bd export -o x.jsonl   # -> Exported 0 issues    (passive mirror stays empty)
bd export --all        # -> only _type:memory lines, zero _type:issue
dolt sql -q 'SELECT COUNT(*) FROM issues'   # -> 0  (in the embeddeddolt/<DB> dir)

# Observed: dolt status = clean, yet dolt_branches.dirty = true.
# The issues table is empty at committed HEAD/STAGED/WORKING/all-history AND the
# Dolt-native backup; issues live only in bd's in-process embedded view.
# Memories (config kv.memory.*) DO commit and DO export.
```

## Alternatives Considered / Ruled Out

- **(1b) Pin/downgrade bd or switch backend (server-mode / file DB).** Rejected as
  default: speculative (no evidence a different backend persists where embedded
  does not), high blast radius (changes the repo's bd model + Atlas Method sync
  contract for all contributors), and risks the healthy working data — to recover
  a mirror daily work does not need.
- **(1c) Do nothing, accept the empty mirror silently.** Rejected: the bug goes
  unreported (never fixed upstream) and the empty file reads as unexplained data
  loss.
- **(2b) Hand-built JSONL from `bd list --json`.** Rejected: lossy
  (no comments/deps/labels arrays, cannot match bd's field-omission rules) and
  drift-prone; an honestly-empty file beats a quietly-wrong one.
- **(2c) Partial mirror with a custom `partial` marker.** Rejected: bd has no such
  convention, so the marker is dead metadata and the file still drifts.

## Why no spike / no code change

There is **no Notidian source on this code path** — bd is an external binary and
its embedded-dolt write/commit path is the defect. A spike could not de-risk the
decision: Decision 1 is "where does the fix live" (upstream, settled by evidence)
and Decision 2 is a data-integrity policy call, not a measurement. Per the bead,
**no code is written and no JSONL is fabricated**; this is a decision + upstream
action artifact only. `.beads/issues.jsonl` is intentionally left empty.

## Consequences

- The bd work graph stays fully usable via `bd list/show/update/ready/close` —
  the DB is the source of truth and is unaffected.
- `.beads/issues.jsonl` stays empty by design until a bd release fixes the
  embedded-dolt issue-table persistence; a future reader has this ADR, the bead,
  and the bd memory key explaining why.
- On a pick of (1a), the owner files the upstream issue with the repro above;
  Notidian-nir tracks the upstream report and per-release retest, and
  Notidian-osf (blocked on it) closes when a release re-exports the full graph.
- No Notidian code, config, branch, or backend changes here. Nothing in the repo
  ships until the owner confirms 1a/1b/1c and 2a/2b/2c.
