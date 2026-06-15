# ADR 0018: Make.md-Era Fork-Debt Scope + Frame-Execution Trust Boundary

## Status

Accepted. The product owner delegated the decision; the recommended split below
is ratified. The safe, build-verifiable steps landed immediately; the render-path
sink hardening is tracked for live-verified implementation (see Outcome).

## Date

2026-06-15

## Context

Notidian is a Notidian-only personal database engine ([ADR 0014](0014-notidian-only-personal-database-engine.md)).
Several Make.md-era subsystems are still compiled and default-on. Auditor D
flagged them as fork debt and attack surface (bd Notidian-409); the ebz security
sweep ([a0aa230](../../README.md)) deliberately left two frame injection sinks
unfixed pending this scope decision. This ADR records what each subsystem
actually is, how reachable it is, whether the working vault uses it, and how it
couples to the core — so the keep/disable/remove decision is evidence-based.

### Findings (verified against code + the working vault)

| Subsystem | Default | Working-vault usage | Coupling to core DB | Notes |
| --- | --- | --- | --- | --- |
| **MKit / `.mkit` installer** (~1.7k LOC, `main.ts` viewer + import) | on (registers `.mkit` ext) | **Unused** — 0 `.mkit` files in vault | Low — separate file viewer / importer | Untrusted-input surface: imports context MDB tables, frame defs, creates spaces. |
| **HTML export** (`SpaceExport`, `SpaceHeader.tsx:120` button; `export/toHtml/*`) | on (button visible) | **Unused** — 0 generated `.html` next to notes | Uses the frame→HTML pipeline (runs `executable.ts`) | Off-core convenience feature. |
| **`spaceSubFolder` move** (`commands.tsx:73` `move-space-folder`) | `.notidian` (`settings.ts:51`); legacy roots normalized at load (`main.ts:177`) | Already `.notidian` everywhere — 0 `.space`/`.makemd` dirs | Low | Command can relocate runtime storage off `.notidian`. |
| **Basics / Flow editor** (~7k LOC, `basics:true`, `MakeBasicsPlugin`, `main.ts:669`) | on | UX feature (inline flow editing) — not detectable from vault files | Separate plugin object; patches the markdown editor, not the DB engine | Largest LOC block. |
| **Frames runtime + `executable.ts` `new Function`** | on (core) | **Used** — every space has a `main` frame (`views.mdb`) | **On the core path** — see below | Hosts the RCE sink. |

### The critical coupling finding

The bead framed everything as "reachable, off-core, default-on." That is wrong
for frames:

- The **spreadsheet table view** (`SpaceView/Contexts/TableView/*`) is standalone
  React — it does **not** use the frame runtime.
- But **`SpaceOuter` (the space shell) always renders through `FrameInstanceView`**
  (`SpaceOuter.tsx:200-225`, unconditional), and the **list view**
  (`ContextListInstance`) renders through `FrameInstance` too. Opening any space
  therefore executes that space's `main` layout frame via
  `executeTreeNode` → `buildExecutable` → **`new Function("with(this){…}")`**
  (`core/utils/frames/executable.ts:18-19`).

So the frames runtime is **load-bearing for core view rendering**, not a
removable sidecar. The two deferred ebz sinks both live here:

1. **`executable.ts` `new Function`** — compiles frame node props/styles/actions
   into JS executed with `$event,$value,$state,$saveState,$api` (full API write
   access). The code comes from frame defs: plugin-shipped default kits (trusted)
   **and** user/`.mkit`-imported frames and `views.mdb` `main`-frame props
   (untrusted under the elevated threat model where AI agents write to the vault).
   This is an RCE vector if an untrusted frame def carries code.
2. **`TextNodeView` frame text** — `dangerouslySetInnerHTML` of frame text content.

Consequence: "remove frames" would require rewriting `SpaceOuter`/list-view
rendering — large and risky. The realistic security action is to **harden the
sink with a trust boundary** (run code only for plugin-shipped frames; gate
user/imported frame code behind an explicit opt-in), mirroring the sticker
chokepoint's trusted-vs-untrusted split (ADR / bd Notidian-ebz).

## Decision (recommended; pending ratification)

Split the work by separability and evidence:

1. **Shed the unused, off-thesis subsystems** — MKit/`.mkit` installer and HTML
   export. They are unused in the vault and off-thesis for a folder-backed
   Notidian-only engine. Disable-by-default first (reversible), then staged
   removal of code/commands/CSS/settings once confirmed unmissed.
2. **Lock `spaceSubFolder` to `.notidian`** — remove/internalize the
   `move-space-folder` command so runtime storage cannot leave `.notidian`. Safe:
   already `.notidian` everywhere.
3. **Basics/Flow editor** — disable-by-default (reversible) **iff** the owner does
   not rely on inline Flow editing; otherwise keep. Defer removal.
4. **Frames runtime** — keep (load-bearing) and **harden the RCE sink with a
   trust boundary**: only plugin-shipped default-kit frames may compile/run code
   via `new Function`; user/imported frame code is gated behind an explicit
   default-off opt-in. Sanitize the `TextNodeView` frame-text sink via
   `shared/utils/sanitize.ts`. This closes the deferred ebz sinks while keeping
   default space/list rendering working.

Disable-by-default is reversible and only changes fresh/unset state; existing
saved settings persist, so it does not silently break the current setup.

## Alternatives Considered

- **Remove the frames runtime entirely.** Rejected: `SpaceOuter`/list views render
  through it; removal is a view-layer rewrite, not a deletion.
- **Keep everything enabled, harden nothing.** Rejected: leaves an RCE-capable
  sink reachable under the elevated (AI-writes-to-vault) threat model the ebz
  sweep adopted.
- **Disable frame code execution globally (no trust boundary).** Rejected: the
  plugin-shipped `main` frame uses code; a blanket gate would break default
  rendering.

## Consequences

- Smaller default attack surface and a closed RCE vector once (1),(2),(4) land.
- `main.js` shrinks if (1) proceeds to removal (currently 5.5 MB).
- A frames trust boundary adds a trusted-source concept to the frame loader.
- Tradeoff: a default-off gate on user frame code means a user who authored a
  dynamic custom frame must opt in to run it.

## Outcome

Landed now (safe, build-verifiable, no core-render-path risk):

- **MKit/`.mkit` installer disabled by default** — new `mkitInstallerEnabled`
  setting (default `false`) gates the `.mkit` view + extension registration
  (`main.ts`). Closes the primary untrusted-frame *delivery* vector. The
  space-template path (`kits.ts:26` → `installSpaceKit`) is deliberately
  untouched (in-vault, trusted).
- **`spaceSubFolder` locked** — the `move-space-folder` command was removed
  (`commands.tsx`); storage is normalized to the plugin root on load, so it can
  no longer be relocated off `.notidian`.

Kept (no change):

- **Frames runtime** — load-bearing for core view rendering; not removable.
- **Basics/Flow editor** — a UX feature (inline flow editing) with no security
  stake and uncertain usage; flipping its default is also complicated by the
  legacy `makerMode`→`basics` derivation (`main.ts:664`). Left enabled pending
  confirmation it is unused.

Landed flag-gated (bd Notidian-vke, default-OFF behind `hardenFrameExecution`,
pending live vault verification — see `docs/AUTONOMOUS-REVIEW-QUEUE.md`):

- **Frame-execution sink hardening**: (a) the `new Function` trust boundary —
  `$api` is withheld from prop/style evaluation of **user/imported** frame nodes
  while plugin-shipped kit frames and user-triggered actions keep it. Trust is a
  **non-persisted provenance marker** (`trust.ts`) stamped only on nodes whose
  code is resolved from `superstate.kit` at expansion time (`ast.ts`
  `getFrameNodesByPath` `$kit` branch); it is a module-private, non-enumerable,
  Symbol-keyed own property, so stored/imported data (a `Record<string,string>`
  DBRow) can never carry it. Trust is explicitly **not** derived from
  `node.ref`: `ref` is a persisted, attacker-controllable column, so an earlier
  `ref.startsWith("spaces://$kit/")` check was unsound — any stored row could
  forge the prefix and silently regain `$api` on every render (a silent-on-render
  RCE), and legit user frames embedding kit elements persist identical `$kit`
  refs, making the string indistinguishable from a forgery even in principle.
  Verification against `schemas/kits/*`
  **refuted** the bead's "no default prop/style needs $api" assumption — the
  `list`/`calendar`/`ui` kits call `$api.path.label`/`$api.date.*` in props AND
  styles — so the chosen design is `$api`-out-of-prop-scope *only for untrusted
  nodes*, not a blanket gate. (b) the `TextNodeView` frame-text sink is routed
  through the new `sanitizeFrameText` (a DOM HTML sanitizer that keeps formatting,
  not `escapeHtml`, because `onBlur` reads `innerHTML`). Both are gated default-OFF
  because they change the core render path and cannot be verified offline.

Still deferred (NOT done autonomously — needs live vault verification):
- **HTML export disable + staged removal** of the disabled subsystems
  (bd Notidian-ala, P3).

## Implementation Notes (on ratification)

Entry points: `main.ts:669` (Basics), `.mkit` viewer/import registration,
`SpaceHeader.tsx:120` + `export/toHtml/*` (HTML export), `commands.tsx:73`
(`move-space-folder`), `core/utils/frames/executable.ts` +
`core/react/context/FrameInstanceContext.tsx` (frame execution),
`SpaceView/Frames/EditorNodes/TextNodeView.tsx` (frame text).
