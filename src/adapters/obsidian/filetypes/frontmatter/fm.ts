import { getAllAbstractFilesInVault } from "adapters/obsidian/utils/file";
import { saveProperties } from "core/superstate/utils/spaces";
import MakeMDPlugin from "main";
import {
  App,
  CachedMetadata,
  FrontMatterCache,
  TAbstractFile,
  TFile
} from "obsidian";
import { PathPropertyName } from "shared/types/context";
import { DBTable, SpaceTable } from "shared/types/mdb";
import { onlyUniquePropCaseInsensitive, uniq } from "shared/utils/array";

import { defaultValueForType, parseMDBStringValue, yamlTypeToMDBType } from "utils/properties";

// NOTE: a `stripFrontmatterFromString` helper formerly lived here with a
// greedy/unanchored regex `/---(.|\n)*---/` that over-stripped body prose. It
// had zero production callers and the repo already has two correct, in-use
// frontmatter strippers — `stripFrontmatter` (src/core/utils/spaceNoteBody.ts,
// anchored/lazy/CRLF-safe string form) and the Obsidian `frontmatterPosition`
// offset slice (cache-backed, authoritative). It was deleted per ADR 0036
// (Option C). For any future body-minus-frontmatter need, use one of those two.
export const getAllFrontmatterKeys = (plugin: MakeMDPlugin): string[] => {
  return uniq(getAllAbstractFilesInVault(plugin.app).flatMap(f => Object.keys(frontMatterForFile(plugin.app, f) ?? {}) ?? []));
}

export const frontMatterForFile = (app: App, file: TAbstractFile): FrontMatterCache => {
  let currentCache!: CachedMetadata;
  if (file instanceof TFile && app.metadataCache.getFileCache(file) !== null) {
    currentCache = app.metadataCache.getFileCache(file);
  }
  return currentCache?.frontmatter;
};

export const mergeTableData = (
  mdb: SpaceTable,
  yamlmdb: DBTable,
  types: Record<string, string>
): SpaceTable => {
  return {
    ...mdb,
    cols: [
      ...mdb.cols,
      ...yamlmdb.cols
        .filter(
          (f) => !mdb.cols.find((g) => g.name.toLowerCase() == f.toLowerCase())
        )
        .map((f) => ({
          name: f,
          schemaId: mdb.schema.id,
          type: yamlTypeToMDBType(types[f]),
        })),
    ].filter(onlyUniquePropCaseInsensitive("name")),
    rows: mdb.rows.map((r) => {
      const fmRow = yamlmdb.rows.find((f) => f[PathPropertyName] == r[PathPropertyName]);
      if (fmRow) {
        return {
          ...r,
          ...fmRow,
        };
      }
      return r;
    }),
  };
};
// NOTE: a module-private `valueForDataview(type, value)` helper formerly lived
// here that blindly wrapped any `link`/`context` value as `[[${value}]]` with no
// idempotence guard — so a value already containing a wikilink would double-wrap
// (`[[[[x]]]]`). It had zero callers (full-tree symbol grep found only its own
// definition) and was deleted in the same ADR 0036 (Option C) spirit as the dead
// `stripFrontmatterFromString` above: a defective, unused helper is pure liability.
// Any future link-serialization need should use the canonical, type-aware
// serializers — `parseProperty` (src/utils/parsers.ts, which routes link/context
// types through `parseLinkString`) and `utils/serializers` — not a bespoke,
// non-idempotent `[[ ]]` wrap.
export const renameFrontmatterKey = (
  plugin: MakeMDPlugin,
  path: string,
  key: string,
  name: string
) => {
  plugin.superstate.spaceManager.renameProperty(path, key, name);
};


export const changeFrontmatterType = (
  plugin: MakeMDPlugin,
  path: string,
  key: string,
  type: string
) => {
  saveProperties(plugin.superstate, path, {
    [key]: defaultValueForType(type),
  });
};

export const deleteFrontmatterValue = (
  plugin: MakeMDPlugin,
  path: string,
  key: string
) => {
  void plugin.superstate.spaceManager.deleteProperty(path, key).catch(error => {
    console.error(`Failed to delete frontmatter property ${key} from ${path}:`, error);
  });
}

export const saveFrontmatterValue = (
  plugin: MakeMDPlugin,
  path: string,
  key: string,
  value: string,
  type: string,
) => {

  saveProperties(plugin.superstate, path, {
    [key]: parseMDBStringValue(type, value, true),
  });
  
};

