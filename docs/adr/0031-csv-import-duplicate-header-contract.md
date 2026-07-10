# ADR 0031: `parseCsvToRecords` — Duplicate CSV Header Contract on Import

## Status

Accepted. Auto-resolved per realignment (AGENTS.md use-driven doctrine, cb2d74c).

**Implemented** — the recommended **Option B** (auto-uniquify duplicate headers
in the parser via `uniqueNameFromString`) shipped in `ff79d3e` under the
use-driven-realignment doctrine (`cb2d74c`); bd `Notidian-5zc` (surfaced +
characterized by the CSV import/export net `Notidian-9g8`) CLOSED.

Originally written instead of changing the parser blind. The contract was
**caller-dependent**: the parser's output feeds `planCsvImport`
(`tableCsvImport.ts`) and `executeCsvImport` (`tableCsvImportRuntime.ts`), which
key everything by **header NAME** — so where uniquification happens, and how
`headers[]` stays consistent with the per-row keys, was a cross-layer contract,
not a one-line parser fix. That decision has since been made: Option B shipped
as noted above.

## Date

2026-06-15

## Context

### The defect

`src/core/utils/contexts/tableCsv.ts:120` (`parseCsvToRecords`):

```ts
export const parseCsvToRecords = (text: string): CsvImport => {
  const grid = parseCsv(text);
  if (grid.length == 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const cells of grid.slice(1)) {
    if (cells.every((cell) => cell.trim().length == 0)) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";   // <-- keys by header NAME
    });
    rows.push(record);
  }
  return { headers, rows };
};
```

Each cell is written under its **header name** as the object key. When two
columns share a header name, the later column's value overwrites the earlier
one's in the per-row record. `headers[]` still lists the duplicate, so the
returned shape is internally inconsistent: `headers.length` can exceed
`Object.keys(record).length`.

### Empirically confirmed loss (pinned characterization)

`src/core/utils/contexts/tableCsv.test.ts:462` deliberately **pins** the defect
(header: "CHARACTERIZE … Caller-dependent; NOT changed here. Follow-up:
Notidian-5zc"):

```
'a,a,b\n1,2,3'  ->  headers: ['a','a','b']   rows: [{ a:'2', b:'3' }]
```

The first `a` column (value `1`) is silently dropped (last-write-wins). A
real-world CSV with two same-named columns loses a whole column on import with
**no warning**. This is the Notion-parity import path (roadmap item 6); Notion's
own CSV import auto-suffixes duplicate column names rather than dropping data.

### Where the contract lives (grounds the options)

The parser does not stand alone. Its output flows through two name-keyed layers:

1. **`planCsvImport` (`tableCsvImport.ts:54`)** maps `parsed.headers` to
   `CsvHeaderMapping[]` (`existingColumn`, `isTitle`) and, for each record,
   copies every non-title header into `properties[header] = record[header]`
   (`:77-81`). It also reads the **title** value as `record[titleHeader]`
   (`:68`). It already builds a `Set` of column names and **already does its own
   duplicate detection** — but on **row file names** (`seenNames`, `:63,83-85`),
   not on headers.

2. **`executeCsvImport` (`tableCsvImportRuntime.ts:30`)** keys columns by name
   (`colByName`) and writes each `row.properties[key]` to frontmatter; an
   **unmatched header materializes a new frontmatter-backed text column**
   (`:48`). Frontmatter is itself a name-keyed map, so two same-named headers
   could never produce two distinct columns downstream regardless — the
   collision is structural, not just in the parser.

So the per-row record being name-keyed is **load-bearing** for both callers, and
frontmatter (the final sink) is name-keyed too. Any fix that keeps real duplicate
names alive end-to-end would have to thread distinctness through three layers and
still collapse at the frontmatter map. The only place distinctness can be
**created once and respected everywhere** is the parser, by giving each duplicate
column a unique header name before the record is built — which is exactly the
column-dedup convention the codebase already uses elsewhere.

### The existing dedup convention

`uniqueNameFromString(name, cols)` (`src/shared/utils/array.ts:23`) is the
project's canonical "make this name unique against existing names" helper:
`a` against `['a']` -> `a1`, then `a2`, … (verified in `array.test.ts:268-313`).
It backs column-name, schema-id, frame-id, and file-name dedup across ~10 call
sites (`SpaceListProperty.tsx`, `frames.ts`, `filesystemAdapter.ts`,
`inlineTable.ts`, …). Duplicate **import** columns are conceptually the same
problem as duplicate **created** columns — there is already a house answer.

### Why this is a decision, not a blind fix

Three real product choices ride on it, and they change observable import
behavior:

- **Reject vs repair.** Refusing a CSV with duplicate headers is a hard failure
  on input the user can't easily fix (the CSV came from elsewhere). Auto-repair
  is lossless but silently renames a column the user sees in the preview.
- **Where uniquification happens** (parser vs caller) determines whether
  `headers[]` and the per-row keys stay consistent, and whether the preview UI
  (`CsvImportModal` -> `planCsvImport`) shows the de-duplicated names.
- **Preview honesty.** Whatever lands, the `CsvImportModal` preview should not
  show the user a column that won't actually import. That's a UI consequence the
  parser alone can't satisfy.

## Decision

**Recommended: Option B** — uniquify duplicate headers in the parser via
`uniqueNameFromString`, so `parseCsvToRecords` returns a `headers[]` with no
duplicates and per-row records whose keys match `headers[]` 1:1.

One-line why: it is **lossless** (no column silently dropped), **consistent with
the existing column-dedup convention** (`uniqueNameFromString`, the same helper
column/schema/file-name creation already uses), **matches Notion's own import
behavior** (auto-suffix duplicate columns), keeps `headers[]` and row keys
consistent for both callers, and avoids a hard failure on a real-world CSV the
user did not author — at the cost of one visibly-renamed column the preview will
show.

### Options

#### Option A — Reject / warn on duplicate headers

Detect duplicate names in `parseCsvToRecords` (or surface a flag on `CsvImport`)
and make the import path **refuse** the file (or show a blocking warning in
`CsvImportModal`) until the user fixes the header row.

- **Pros:** zero silent change to any value or name; the user is told exactly
  what's wrong; no column is renamed behind their back; arguably the most
  "honest" contract for a data tool.
- **Cons:** a **hard failure on a real-world CSV** the user often can't easily
  edit (exported from another tool with two `Notes` columns, etc.); it blocks
  the whole import for a problem that is mechanically repairable; it adds an
  error/abort path to a flow that currently always produces something. For a
  single-user vault import, refusing the file is heavier than the problem
  warrants. Kept on the table if the owner prefers strictness over auto-repair.

#### Option B — Auto-uniquify via `uniqueNameFromString` (RECOMMENDED)

In `parseCsvToRecords`, build the header list so each name is unique before
mapping cells, using the project's existing helper:

```ts
// build a de-duplicated header list, preserving column order
const raw = grid[0].map((h) => h.trim());
const headers: string[] = [];
for (const h of raw) headers.push(uniqueNameFromString(h, headers));
// ...then headers.forEach((header, index) => record[header] = cells[index] ?? "")
```

For `a,a,b` this yields `headers: ['a','a1','b']` and
`rows: [{ a:'1', a1:'2', b:'3' }]` — **no data lost**, `headers[]` and row keys
stay 1:1, and the renamed column flows through `planCsvImport` (preview shows
`a1`) and `executeCsvImport` (materializes an `a1` frontmatter column) with no
further change.

- **Pros:** **lossless** — every column survives import; **reuses the canonical
  dedup helper** (`uniqueNameFromString`), so import dedup reads identically to
  column/schema/file-name dedup elsewhere — one mental model, one tested helper
  (`array.test.ts`); **matches Notion's CSV import** (auto-suffix); keeps the
  parser output internally consistent (`headers.length ==
  Object.keys(record).length`), which both callers and the frontmatter sink
  already assume; no hard failure on real-world input. The change is local to the
  parser and offline-provable (pure function, no vault read).
- **Cons:** **silently renames** a duplicate column (`a` -> `a1`) — the user sees
  a column name they didn't type. Mitigated because the rename is **visible in
  the `CsvImportModal` preview before any write** (it reads `parsed.headers` via
  `planCsvImport`), so it is surfaced, not hidden. Must flip the pinned
  characterization assertion at `tableCsv.test.ts:462` deliberately (from
  last-write-wins to lossless-suffix).

#### Option C — Keep last-write-wins (ruled out)

Leave the parser as-is; document the limitation; keep the characterization test
as the permanent record.

- **Pros:** zero churn, zero behavior change.
- **Cons:** leaves a **silent data-loss defect** on the Notion-parity import
  path — a whole column vanishes on a duplicate-header CSV with no warning,
  preview hint, or error. This is the worst contract for a data-import tool: the
  user can't even tell it happened. **Ruled out.**

### Where uniquification happens (parser vs caller) — the cross-layer call

The bead asks this explicitly. **Recommended: in the parser**, for three
reasons:

1. **Single source of truth.** The parser is the only layer that sees the raw
   header row positionally (before names become object keys). Both callers and
   the frontmatter sink are already name-keyed, so they **cannot** distinguish
   two same-named columns after the fact — distinctness has to be created at the
   parse boundary or it is lost.
2. **`headers[]`/row-key consistency for free.** Deduping in the parser keeps
   the returned `headers[]` and every record's keys 1:1 by construction. A
   caller-side fix would have to re-derive a deduped header list **and** rebuild
   each record's keys to match — duplicating parser logic in `planCsvImport`.
3. **All consumers inherit the fix.** `planCsvImport` (preview), `executeCsvImport`
   (frontmatter/column materialization), and any future consumer of `CsvImport`
   get the deduped names with no per-caller change.

The caller's only remaining responsibility is **preview honesty**:
`CsvImportModal` already renders `planCsvImport(parseCsvToRecords(text))`, so the
suffixed name (`a1`) shows in the column-mapping preview automatically — no extra
caller code needed. If the owner wants an explicit "renamed N duplicate columns"
notice in the modal, that is a small additive UI follow-up, not part of the core
contract.

### Ruled out

- **Option C** — accepting silent column loss on a data-import path is the one
  contract that gives the user no signal at all; rejected on first principles for
  a tool whose job is to faithfully import the user's data.
- **Caller-side (in `planCsvImport`) uniquification** — would duplicate the
  parser's positional header handling in the caller, re-key every record, and
  still leave `parseCsvToRecords`'s own output inconsistent for any other
  consumer. Parser-side is strictly simpler and keeps the contract in one place.
- **Reserving distinct frontmatter keys for genuinely-duplicate names** — the
  frontmatter sink is a name-keyed YAML map; two truly-identical keys cannot
  coexist there, so "preserve both names as-is end-to-end" is structurally
  impossible without inventing distinct names anyway. That collapses back into
  Option B.

## Consequences

- **If B (recommended):** `parseCsvToRecords` returns deduped `headers[]` and
  consistent row keys; no column is lost on import; the suffixed name surfaces in
  the `CsvImportModal` preview before any write; the pinned characterization at
  `tableCsv.test.ts:462` flips (last-write-wins -> lossless suffix), guarded by
  the existing `uniqueNameFromString` property net in `array.test.ts`; `tsc`,
  tests, and build must stay green. Pure-function change, fully offline-provable —
  no vault re-read, no flag needed. Optional additive follow-up: an explicit
  "renamed N duplicate columns" hint in the modal.
- **If A:** the import path gains a reject/warn branch; duplicate-header CSVs are
  blocked until the user fixes the header row; `CsvImportModal` needs a blocking
  error state; no value or name is ever changed silently.
- **If C:** nothing changes; the defect persists as a documented, accepted
  limitation; the bead closes as "known + accepted" rather than fixed.
- Whichever lands, it must **flip** the `tableCsv.test.ts:462` characterization
  assertion deliberately (not silently) — the pin exists precisely so the fix is
  a conscious, reviewed change.

## The one decision the owner needs to make

**Pick A, B, or C** (recommended **B** — uniquify duplicate headers **in the
parser** via `uniqueNameFromString`, so the import is lossless, consistent with
the existing column-dedup convention, and `headers[]`/row keys stay 1:1; the
renamed column shows in the preview before any write). On a pick, the
implementing session applies it and flips the locked characterization assertion;
the change is offline-provable (pure parser function), guarded by the existing
`uniqueNameFromString` tests and the flipped characterization test.
