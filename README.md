# Notidian

Notidian is an independent fork of Make.md for Obsidian. The fork is focused on making local Markdown files behave like a durable, Notion-style database system without separating data governance from Obsidian's native properties.

## Direction

Notidian treats Obsidian Markdown files and frontmatter properties as the canonical data layer:

- A row is a file.
- A user-editable property is frontmatter.
- Folder and table views are projections over files, not a separate source of truth.
- Existing Obsidian tools such as Properties, Bases, Dataview, scripts, and direct YAML edits should see the same data.

The first Notidian branch already changes folder contexts so existing frontmatter properties are materialized as visible context columns and kept synchronized as new properties appear.

## Compatibility

Notidian uses the Obsidian plugin id `notidian`. This means it installs separately from the original `make-md` plugin.

On first load, Notidian prefers its own plugin data directory:

```text
.obsidian/plugins/notidian
```

If Notidian data does not exist yet, it can read legacy Make.md data from:

```text
.obsidian/plugins/make-md
```

New writes target the Notidian plugin directory. Keep a backup of your vault before switching plugins.

## Status

This fork is in active development. The immediate roadmap is:

1. Rebrand the fork as Notidian.
2. Keep frontmatter properties canonical across contexts.
3. Move view definitions toward Obsidian Bases semantics.
4. Reduce Make.md-specific context storage to compatibility and cache behavior.

## Development

```bash
npm install
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

## Architecture Decisions

The core Notidian architecture decisions are recorded in [docs/adr](docs/adr/README.md), including why ordinary note data remains canonical in Obsidian files/frontmatter, why context MDB is retained as a view/configuration layer, and why page title edits are implemented as controlled file rename transactions.

## Credits

Notidian is forked from Make.md, which is licensed under the MIT License.

Original project: https://github.com/Make-md/makemd

Parts of the Flow Editor are based on Hover Editor:
https://github.com/nothingislost/obsidian-hover-editor

Dataview syncing was adapted with help from Metadata Menu:
https://github.com/mdelobelle/metadatamenu
