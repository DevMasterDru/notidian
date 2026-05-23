# Notidian Rebrand Design

## Goal

Rename this fork from Make.md to Notidian so it can stand as an independent Obsidian plugin while preserving a migration path from existing Make.md plugin data.

## Decision

Use **Notidian** as the product and plugin name for this fork.

Use **notidian** as the Obsidian plugin id, package name, repository name target, URL scheme target, and new plugin data directory. This deliberately makes the fork install as a distinct plugin from `make-md` instead of pretending to be the original plugin.

## Constraints

- Keep MIT attribution to the original Make.md project.
- Do not rename broad internal TypeScript symbols such as `MakeMDPlugin`, `MakeMDSettings`, or `makemd-core` in this phase. Those names are implementation lineage and changing them now would create high-risk churn without improving the user-facing product.
- Do not change `spaces://` internal URIs in this phase. They are data model identifiers, not brand identity.
- Keep the upstream `github:make-md/vaul` dependency untouched until the dependency is replaced or vendored deliberately.
- Do not read or modify any path whose name contains `archive` or `ignore`, following the repo instructions.

## Identity Surface

The rebrand must update:

- `manifest.json`
  - `id`: `notidian`
  - `name`: `Notidian`
  - description and author metadata
- `package.json` and `package-lock.json`
  - `name`: `notidian`
  - product description
- README
  - product name, positioning, badges, attribution, and migration notes
- visible strings in localization and startup/status messages
- Obsidian protocol URLs that include the old plugin id
- adapter ids that use `make.md` as a visible namespace

## Migration Behavior

Changing the Obsidian plugin id means Obsidian will load Notidian from `.obsidian/plugins/notidian`. Existing Make.md installations may still have data in `.obsidian/plugins/make-md`.

For the first rebrand phase, Notidian should:

1. Prefer the new Notidian data path.
2. Read legacy Make.md data paths when the new data path does not exist.
3. Keep writing future data to the Notidian path.
4. Document the migration behavior clearly in README.

This avoids silently losing access to existing `Spaces.mdb` and settings data while still letting Notidian become independent.

## Out Of Scope

- Full Bases-compatible view engine.
- Complete internal type/module rename.
- Repository rename through GitHub settings.
- Trademark filing or legal clearance.
- Dependency replacement for `github:make-md/vaul`.

## Verification

- Add a small identity test that asserts the package and manifest expose the Notidian identity.
- Run the existing Jest suite.
- Run TypeScript checking.
- Run production build and confirm the generated tracked bundle is clean.

