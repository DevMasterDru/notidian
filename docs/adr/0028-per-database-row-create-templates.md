# ADR 0028: Per-Database Row-Create Templates — Where Templates Live, What They Seed, How They Are Chosen, and How They Interact with Schema Defaults

## Status

Accepted — implemented 2026-06-27.

The owner pulled the next Notion-parity row-create step after grouped-row add.
The recommended contract below was implemented by bd `Notidian-2w0.1`: shared
database row-create routing now honors a space's default template from table row
creation, grouped-row add, the context create modal, `api.context.insert`, and
context-cell linked-row creation. Template creation copies the `.md` template's
frontmatter and body and skips Type Profile defaults; no-template creation keeps
the existing `newPathInSpace` Type Profile default behavior. Caller-supplied
create values, such as grouped-row inherited fields or API insert row values, are
written after the row exists and intentionally override template frontmatter for
the fields the explicit create action supplies.

## Date

2026-06-15

## Context

### What already exists (this grounds every option below)

Per-database templates are **not greenfield**, and the storage question is
**already answered by the shipped design** — the open part is wiring and UX, not
invention.

- **Templates are file-canonical `.md` notes.** A space's templates live as
  ordinary files under `{space}/{spaceSubFolder}/templates/{name}`
  (`filesystemAdapter.ts` `readTemplates`/`saveTemplate`/`deleteTemplate`,
  `spaceSubFolder` is locked per ADR 0018). Creating from a template is a plain
  file copy of the whole note — frontmatter **and** body — via
  `superstate.spaceManager.copyPath(...)` in `newTemplateInSpace`
  (`src/core/superstate/utils/spaces.ts:450`). No MDB blob, no `source:notidian`
  marker, no hidden authority. The template is just a note you can open and edit.
- **A per-space default template pointer already exists.** `space.metadata.template`
  (the `spaceTemplateKey` field, persisted in the space's MDB *as view config*, not
  as row data) names the default template; `space.metadata.templateName` optionally
  holds a formula that computes the **new file's name**
  (`setTemplateInSpace`/`setTemplateNameInSpace`, `spaces.ts:242`). This is exactly
  the "MDB stores view config, never the relationship/data itself" partition from
  ADR 0001/0014/0017 — the template *content* is canonical in the `.md`; the MDB
  only remembers *which* template is the default.
- **A per-database template picker already exists.** `showSpaceAddMenu.tsx:207`
  enumerates `space.templates` (the folder listing) and offers each as a "create
  from template" menu entry. So "single default vs picker" is **already both** in
  the navigator surface.
- **The navigator/sidebar create path already applies templates.** `ui.tsx`
  `defaultAdd` (`src/core/middleware/ui.tsx:72`) and `showSpaceAddMenu`'s default
  create (`:90`) both branch: if `space.metadata.template?.length > 0`, call
  `newTemplateInSpace` (copy the template); else `newPathInSpace` (empty file).

### What is broken / missing, concretely

The gap is **narrow and specific**: the in-table and in-context row-create
chokepoints bypass templates entirely and always produce an empty file. There are
exactly three such call sites, all calling `newPathInSpace(..., "md", name, true)`
directly (never `newTemplateInSpace`):

- **Table "new row"** — `TableView.tsx:803` `newRow` → `newPathInSpace` for the
  default context schema (the `+`/inline title-entry add).
- **API `insert`** — `api.ts:295` (the programmatic / paste / frame row-create path)
  → `newPathInSpace`, then `saveProperties` of the incoming row.
- **Context cell new-link** — `ContextCell.tsx:113` (typing a not-yet-existing
  `[[link]]` into a relation cell mints a new row) → `newPathInSpace`.

Pre-implementation, a user who set a default template for a database got it from
the sidebar `+` but **not** when adding a row in the table view, modal, API insert,
or context-cell link minting path. That was the bug epic item (2) named: "space
template helpers exist; modal creates empty file." As of `Notidian-2w0.1`, those
database row-create paths share the same template-aware helper.

### How templates interact with the Type Profile defaults already shipped

This interaction is **already decided in one direction and must be preserved**.
`applyNewRowTypeProfileDefaults` (`src/core/utils/contexts/typeProfileDefaults.ts`,
bd `Notidian-drv`) seeds a new row's frontmatter from the database hub note's Type
Profile (`newPropertyDefaults`). Its own doc comment records the precedence
decision:

> `newTemplateInSpace` (a configured body template) … the template IS the
> authored new-row scaffold; layering schema defaults could overwrite the user's
> intentional template values. **The template wins.** … Every wired path creates
> an empty file first, so defaults never overwrite existing frontmatter.

So today: template-create paths get **no** Type Profile seeding (template wins,
unconditionally); empty-create paths get Type Profile seeding. Wiring templates
into the table path must keep that contract coherent — see Question (d).

### Constraints any answer must respect

- **C1 — File/frontmatter authority (ADR 0001/0014/0017).** The template's content
  is canonical in its `.md` file (frontmatter + body, copied). The MDB may store
  only the *pointer* to the default template (view config), never the template body
  and never a durable per-row marker. No `source:notidian` MDB blob is created.
- **C2 — Additive, non-destructive.** Templates only seed a *newly created* file.
  No existing file's frontmatter or body is ever overwritten. Absence of a template
  must behave exactly as today (empty file + Type Profile defaults).
- **C3 — One authority for "what a new row starts as."** Template and Type Profile
  defaults must have a deterministic, documented precedence — never two writers
  silently fighting over the same field.
- **C4 — Cheap, reversible, single-user-scaled.** Reuse the shipped template
  storage and helpers; no new persisted schema, no migration of existing notes.

The four open questions, each with options + a recommendation:

---

## Question (a) — Where does the template live, and who owns it?

**Decision needed:** Confirm the canonical home and ownership for a per-DB
row-create template.

- **Option A1 — File-canonical `.md` template in the space's template folder
  (status quo storage, recommended).** Keep `{space}/{spaceSubFolder}/templates/{name}.md`
  as the home; creating a row copies the whole note (frontmatter + body). The MDB
  stores only `space.metadata.template` (the default pointer) and the optional
  `templateName` naming formula — both *view config*, not row data. The template is
  an openable, editable note; nothing hidden.
- **Option A2 — MDB-owned template blob.** Store the template payload inside the
  space's context MDB. Rejected on sight: it makes Notidian own durable note
  *content* without an explicit `source:notidian` marker, directly violating ADR
  0017's "no silent MDB authority" rule, and it hides the template from the vault
  (not openable/editable as a note). Only ever permissible with an explicit
  `source:notidian` marker — and even then it buys nothing over a real file.
- **Option A3 — A frontmatter pointer on the hub note** (e.g. `template: [[…]]` in
  the database's hub `.md`). Keeps the pointer file-canonical too. Viable, but it
  duplicates the `space.metadata.template` pointer that already works, and it would
  need a second resolution path; no benefit for a single-user tool.

**Recommended: A1 (file-canonical `.md` template, MDB holds only the default
pointer).** One line: it is already the shipped storage model, it is the literal
expression of the ADR 0001/0014/0017 partition (content canonical in the file,
MDB holds only view config), and it needs zero new persistence and zero migration.

## Question (b) — What does a template seed: frontmatter, body, or both?

**Decision needed:** Define the templated payload for a created row.

- **Option B1 — Frontmatter + body (status quo of `newTemplateInSpace`,
  recommended).** `copyPath` already copies the whole note. A database row in
  Notidian *is* a note; a Notion-parity "template" sets both the row's properties
  (frontmatter) and the page body (the note content shown when you open the row).
  This is what users mean by a template and what the helper already does.
- **Option B2 — Frontmatter-only.** Seed default property values but no body.
  This is *already covered* by the Type Profile `newPropertyDefaults` mechanism
  (`applyNewRowTypeProfileDefaults`); a frontmatter-only "template" would duplicate
  it with a worse authoring surface. Use Type Profile for property defaults;
  reserve templates for the full-note case.
- **Option B3 — Body-only.** Seed page body but ignore template frontmatter.
  Surprising (a `.md` template naturally carries frontmatter) and it throws away
  half the file the user authored; no clear use case over B1.

**Recommended: B1 (frontmatter + body).** One line: a row is a note, so the
Notion-equivalent template seeds the whole note — and frontmatter-only is already
served better by Type Profile defaults, so templates should own the case those
defaults can't (page body + non-default-shaped frontmatter).

## Question (c) — UX: a single default, or a per-database picker?

**Decision needed:** How does the user choose/define the template at create time?

- **Option C1 — Single default applied automatically + optional picker for the
  rest (recommended).** Keep `space.metadata.template` as the **default** that is
  applied silently on every row create (table and sidebar alike, once Question's
  wiring lands), and keep the existing `space.templates` menu picker for choosing a
  *non-default* template explicitly. This is exactly today's navigator behavior,
  extended to the table create path. Zero new modal: the table `+` honors the
  default; a "new row from template …" submenu (reusing `showSpaceAddMenu`'s
  existing enumeration) offers the alternatives.
- **Option C2 — Always prompt with a picker.** Force a template choice on every
  row create. Heavy friction for the common case (most rows want the default or
  no template); rejected.
- **Option C3 — Single default only, no picker.** Simpler, but it discards the
  multi-template picker that *already exists* in the navigator — a regression in
  capability.

**Recommended: C1 (single default auto-applied + optional picker).** One line:
it matches the bead's stated preference and the already-shipped navigator UX, gives
the frictionless common path (default just works) without losing the
already-present multi-template picker, and adds no mandatory modal.

## Question (d) — Template vs Type Profile `newPropertyDefaults`: override or merge?

**Decision needed:** When a database has *both* a row-create template and Type
Profile property defaults, which writes which frontmatter fields?

- **Option D1 — Template wins wholesale; Type Profile is skipped when a template
  applies (status quo precedent, recommended).** This is the contract
  `applyNewRowTypeProfileDefaults` already documents ("the template wins"). When a
  row is created from a template, the template's frontmatter+body is the new row;
  Type Profile defaults are not layered. When no template applies, Type Profile
  defaults seed the empty file (today's behavior, unchanged). Deterministic, single
  authority per row create, already implemented.
- **Option D2 — Field-level merge: Type Profile fills only fields the template
  leaves absent.** Copy the template, then add any Type Profile default for a field
  the template did not set (never overwrite a template-set field). More "complete"
  rows, but it introduces **two writers** for one row's frontmatter and a subtle
  precedence rule (what about a template field set to empty string vs absent?) —
  more surface for the owner to reason about, and it can silently inject fields the
  template author intentionally omitted (tension with C2/C3).
- **Option D3 — Type Profile wins (override the template's matching fields).**
  Backwards from intent: the template is the *more specific* authored artifact;
  letting generic schema defaults overwrite it defeats the point of a template.
  Rejected.

**Recommended: D1 (template wins wholesale; Type Profile only seeds the
no-template path).** One line: it is the precedent already shipped and documented,
it keeps exactly one writer per row create (no merge-precedence ambiguity, C3),
and the two mechanisms cleanly divide the space — Type Profile owns "property
defaults for plain new rows," templates own "full authored new-row scaffold." If
the owner later wants merge ergonomics, D2 is the documented future opt-in (a
per-DB "fill gaps from schema defaults" flag), not the default.

---

## Consequences

- **If accepted as recommended (A1 / B1 / C1 / D1):** the only code to build is
  the **wiring**, and it is small and safe. The three empty-create chokepoints
  (`TableView.tsx` `newRow`, `api.ts` `insert`, `ContextCell.tsx`) gain the same
  `space.metadata.template?.length > 0 ? newTemplateInSpace(...) : newPathInSpace(...)`
  branch the navigator already uses — ideally extracted into one shared
  `createRowInSpace` helper so all create paths agree. Type Profile seeding stays
  exactly as-is (it already skips the template path). No new persistence, no
  migration, no new MDB authority, nothing the user did not target is written.
- **The contract is the gate, not the engine.** Storage and helpers are done; this
  decision unblocks a thin wiring bead without gambling quota on the wrong product
  direction (e.g. an MDB template blob, a forced picker, or a merge precedence the
  owner did not ask for).

### Optional default-OFF spike (offered, not built)

If wiring the table create path to honor the existing default template feels low
enough risk to validate live, a minimal spike is: extract one
`createRowInSpace(superstate, space, name, location)` helper that mirrors
`ui.tsx` `defaultAdd`'s template branch, route the three call sites through it,
and gate the table/context paths' template honoring behind a default-OFF
`applyRowTemplateOnTableCreate` setting (sidebar behavior unchanged, table behavior
unchanged when OFF). That makes the owner's current vault byte-for-byte identical
until they flip the flag and live-verify a template actually lands on a table-added
row. **Not built here** — it presupposes the owner picks A1/B1/C1/D1; the spike is
the first task of the follow-up implementation bead.

## Ruled-out alternatives (summary)

- **MDB-owned template blob (A2).** Makes Notidian own durable note content without
  an explicit `source:notidian` marker (violates ADR 0017) and hides the template
  from the vault; a real `.md` file is strictly better and already shipped.
- **Frontmatter-only templates (B2).** Duplicates the Type Profile
  `newPropertyDefaults` mechanism with a worse authoring surface; templates should
  own the full-note case those defaults cannot serve.
- **Always-prompt picker (C2).** Friction on the common path; the default-plus-
  optional-picker already shipped in the navigator is better.
- **Type Profile overrides the template (D3).** Lets generic schema defaults clobber
  the more-specific authored template — defeats the purpose of a template.
- **Field-level template+schema merge as the default (D2).** Introduces two writers
  and a subtle precedence rule for one row's frontmatter; deferred to a documented
  per-DB opt-in rather than the default.

## Cross-links

- Epic: bd `Notidian-2w0` (Notion-parity roadmap), item (2).
- This decision: bd `Notidian-e29` (stays OPEN awaiting the owner's pick).
- Shipped template storage/helpers: `src/core/superstate/utils/spaces.ts`
  (`newTemplateInSpace`, `saveSpaceTemplate`, `setTemplateInSpace`,
  `setTemplateNameInSpace`), `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts`
  (`readTemplates`/`saveTemplate`/`deleteTemplate`, `spaceTemplateKey`).
- Navigator paths that already apply templates: `src/core/middleware/ui.tsx`
  (`defaultAdd`), `src/core/react/components/UI/Menus/navigator/showSpaceAddMenu.tsx`.
- Empty-create chokepoints to wire: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
  (`newRow`), `src/core/superstate/api.ts` (`insert`),
  `src/core/react/components/SpaceView/Contexts/DataTypeView/ContextCell.tsx`.
- Type Profile interaction: `src/core/utils/contexts/typeProfileDefaults.ts`
  (`applyNewRowTypeProfileDefaults`, bd `Notidian-drv` — "the template wins").
- Authority basis: ADR 0001, ADR 0014, ADR 0017, ADR 0018 (`spaceSubFolder` lock).
