# ADR 0016: Per-View Display Properties and Inline Row Expansion

## Status

Accepted.

Amends one doctrine line of ADR 0014 / `AGENTS.md` ("Markdown file paths and
basenames own page titles"): basenames keep owning **row identity and the
default title**, but a view may additionally designate a frontmatter property
to render as the row **label**.

## Date

2026-06-10

## Context

Generated databases broke the assumption that the basename is always the best
human label. The Atlas Vault **Beads Portfolio** (built by the Atlasidian repo,
its ADR-402) mirrors issue-tracker rows where basename = stable machine id
(`Atlasidian-0c4.8`) and the human-readable name lives in `title` frontmatter.
Renaming files to their titles is wrong there: ids are stable, titles change,
and renames churn links. Today list/table views can only show the basename, so
the database reads as a wall of ids.

Two adjacent gaps surfaced in the same review:

- Rows cannot be expanded inline. Reviewing a bead means opening each note;
  the user wants Notion-style toggle rows with several open at once.
- The add-property menu appears to only create new properties. Discovery of
  existing frontmatter keys (`discoverFrontmatterPropertiesFromPathStates` in
  `src/core/utils/properties/allProperties.ts`) already exists but is buried
  behind a secondary import-icon button and hidden entirely when
  `fieldSource == "$fm"`, so it reads as missing.

## Decision

1. **Per-view display property.** A view may designate one frontmatter
   property (e.g. `title`) as its display property, stored per view as
   `predicate.listViewProps.displayProperty` (the existing per-view option
   pattern: FilterBar `savePropValue` → `savePredicate` → `frameSchema.predicate`).
   When set, list/table row labels render that property's value; empty or
   missing values fall back to the basename. Identity, links, renames, and the
   default label remain basename-owned. Doctrine after this ADR: *basenames
   own row identity and default titles; views may project a display property
   as the row label.*

2. **Inline row expansion (toggle rows) in list views.** A row collapses to
   its label (display property per item 1) and expands in place to render the
   note body inline, reusing the existing inline-note machinery
   (`src/basics/ui/UINote.tsx` flow-embed pattern). Multiple rows may be open
   simultaneously. v1 keeps open-state **in memory** (per session): persisting
   it would write view state on every toggle for no proven need. Persisted
   open-state in the context MDB is an explicit, compatible follow-up if
   wanted.

3. **First-class existing-key suggestions.** The add-property menu surfaces
   discovered existing frontmatter keys (with inferred types) as a visible
   section of the menu itself, with "create new" unchanged. This is a UX
   surfacing of the existing discovery path, not a new mechanism.

**Cross-repo contract with the Beads Portfolio** (Atlasidian ADR-402): the
portfolio's display property is `title`; the toggle body is the row note's
body; the Atlasidian generator folds its generated-view banner so expanded
rows lead with content. The generator does not rename row files.

## Rejected options

- **Rename row files to titles (generator-side fix).** Breaks stable identity,
  churns links on every title change, contradicts "basename owns identity".
- **Global (not per-view) display-property setting.** Different databases need
  different labels; view state is the doctrinal home for view behavior.
- **Persisting toggle open-state in v1.** View-definition churn on every
  click; deferred until a real need shows up.

## Consequences

- Work graph: beads epic in this repo (display property → toggle rows;
  property-menu surfacing independent).
- `AGENTS.md` doctrine line updated to the amended phrasing.
- Each feature ships with tests and passes the standard verification suite
  (`npm test -- --runInBand`, `npx tsc -noEmit -skipLibCheck`,
  `npm run build`, `npm run health:audit -- --live`).
