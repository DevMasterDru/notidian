# Hub-Note Body Above the Table (Notidian-7oj)

Date: 2026-06-12
Bead: Notidian-7oj
Status: approved by user (interactive brainstorm, this session)

## Problem

Opening a Notidian database shows the table but never the hub note's markdown
body, so legends/definitions (e.g. the Reviews status legend) must be opened
separately. Verified: `SpaceInner` renders `SpaceHeader` → `SpaceOuter` (frame
tree containing the table) → optional backlinks footer; no component renders
`spaceState.space.notePath`'s body.

Compounding gap: the vault's hub convention is **adjacent** notes
(`Reviews.md` beside `Reviews/` — 14 such hubs, Atlas Method ADR-0008), but
`fileSystemSpaceInfoFromFolder` always computes `notePath` **inside** the
folder and the `folderNoteInsideFolder` setting is dead except in the
listing-exclusion predicate. Consequence: space label/properties writes and
`NoteView(forceNote)` target wrong, auto-created empty files (two 0-byte
strays found in the vault).

## Decisions (user-approved)

1. **Render mode:** editable inline embed via existing `NoteView`/`forceNote`
   (FlowEditor leaf), like row expansion. Not read-only preview, not a frame
   node.
2. **Gating:** new global setting `spaceViewShowNoteBody`, default **ON**.
3. **Empty state:** silently render nothing when the hub note is missing or
   its body (frontmatter stripped) is blank. Emptiness is evaluated on
   mount/path change only — the region must not vanish mid-edit.
4. **Adjacency fix included:** make `folderNoteInsideFolder` actually control
   `notePath` (false → `<parent>/<folderName>.md`); fix hardcoded
   inside-folder note creation/moves. Region-only fallback rejected: it would
   fork the hub-note concept right before Type Profiles (Notidian-5qr) build
   schema reads on `notePath`.
5. **Vault alignment (live vault, approved):** flip
   `folderNoteInsideFolder: false` in the Atlas Vault plugin settings and
   delete the two 0-byte strays (`Reviews/Reviews.md`,
   `Gidi/Hardware/Sensor Registry/Sensor Registry.md`) so they don't surface
   as bogus rows after the flip.

## Design

### Part 1 — adjacency-aware notePath

- `src/core/spaceManager/filesystemAdapter/spaceInfo.ts`
  (`fileSystemSpaceInfoFromFolder`): when `enableFolderNote &&
  !folderNoteInsideFolder`, `notePath = <parentOfFolder>/<folderName>.md`.
  Vault-root space (`/`) unchanged. In adjacent mode `folderNoteName` is
  ignored (a shared custom name across sibling folders would collide);
  inside mode keeps current behavior.
- Fix inside-folder hardcodes to derive the create/move parent from
  `notePath` instead of `folderPath`:
  - `filesystemAdapter.saveLabel` (~:787 newFile)
  - `filesystemAdapter.saveSpace` (~:936 newFile)
  - `filesystemAdapter.renameSpace` (~:970 movePath target)
  - `NoteView` force-create path (parent for `createItemAtPath`)

### Part 2 — SpaceNoteBody region

- New `src/core/react/components/SpaceView/SpaceNoteBody.tsx`:
  - Resolves `spaceState.space.notePath`; requires `enableFolderNote` and
    space type `folder` (or vault root with existing note).
  - Reads content via `spaceManager.readPath`, strips YAML frontmatter,
    trims; empty/missing → `null`.
  - Otherwise renders `NoteView` (`forceNote`, editable) with class
    `mk-space-note`.
- Wire into `SpaceInner.tsx` between `SpaceHeader` and `SpaceOuter`, gated by
  `superstate.settings.spaceViewShowNoteBody`.
- Setting added to `shared/types/settings.ts`, default `true` in
  `core/schemas/settings.ts`, toggle in the settings UI, i18n label.
- CSS: `.mk-space-note` width-matched to `mk-space-body` in
  `src/css/SpaceViewer/SpaceView.css`.

## Error handling

- Hub note unreadable → treat as empty (render nothing); no throws into the
  space view tree.
- Strict no-fallback rule: the region renders `notePath` only — no scanning
  for alternative note locations (identity stays single-sourced).

## Testing

- Jest: `fileSystemSpaceInfoFromFolder` notePath matrix (inside/adjacent ×
  root/nested × custom `folderNoteName`).
- Jest: frontmatter-strip/emptiness helper (frontmatter-only, body,
  whitespace-only, missing file).
- Gates: `npm test -- --runInBand`, `npx tsc -noEmit -skipLibCheck`,
  `npm run build`.
- Real-vault smoke: Reviews database shows the status legend above the rows;
  editing it edits `Reviews.md`.

## Out of scope

- Per-space toggle, collapsible region, "add description" placeholder.
- Schema consumption of hub frontmatter (Notidian-5qr).
