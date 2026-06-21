import { getAbstractFileAtPath } from "adapters/obsidian/utils/file";
import MakeMDPlugin from "main";
import { SpaceManager } from "makemd-core";
import {
  App,
  CachedMetadata,
  Pos,
  TFile,
  TFolder,
  getAllTags
} from "obsidian";
import { MakeMDSettings } from "shared/types/settings";
import { uniq } from "shared/utils/array";
import { parseMultiString } from "utils/parsers";
import { serializeMultiDisplayString } from "utils/serializers";
import { stringFromTag, tagPathToTag, validateName } from "utils/tags";


const tagKeys = ["tags"];

type TagsFrontmatter = Record<string, any>;

const appForManager = (manager: SpaceManager, path: string): App | null => {
  const spaceAdapter =
    typeof (manager as any).adapterForPath === "function"
      ? (manager as any).adapterForPath(path)
      : (manager as any).primarySpaceAdapter;
  const fileSystem = spaceAdapter?.fileSystem;
  const fileSystemAdapter =
    typeof fileSystem?.adapterForPath === "function"
      ? fileSystem.adapterForPath(path)
      : fileSystem?.primary;

  return (
    fileSystemAdapter?.plugin?.app ??
    fileSystem?.primary?.plugin?.app ??
    spaceAdapter?.plugin?.app ??
    (manager as any).plugin?.app ??
    null
  );
};

const rawFrontmatterForPath = (
  manager: SpaceManager,
  path: string
): TagsFrontmatter | null => {
  try {
    const app = appForManager(manager, path);
    const file = app?.vault?.getAbstractFileByPath?.(path);
    return file
      ? app?.metadataCache?.getFileCache?.(file as TFile)?.frontmatter ?? null
      : null;
  } catch {
    return null;
  }
};

const readTagFrontmatter = async (
  manager: SpaceManager,
  path: string
): Promise<TagsFrontmatter> => {
  return (
    rawFrontmatterForPath(manager, path) ?? (await manager.readProperties(path))
  );
};

const tagsFromPropertyValue = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((f) => f?.toString?.() ?? "").filter((f) => f.length > 0);
  }
  if (typeof value === "string") {
    return parseMultiString(value).filter((f) => f.length > 0);
  }
  return [];
};

const tagPropertyValueForOriginalShape = (value: any, tags: string[]) => {
  if (Array.isArray(value)) {
    return tags;
  }
  if (typeof value === "string") {
    return serializeMultiDisplayString(tags);
  }
  return tags[0] ?? "";
};



export const loadTags = (app: App, settings: MakeMDSettings) : string[] => {
  const folder =
    settings.spacesFolder == ""
      ? app.vault.getRoot()
      : (getAbstractFileAtPath(
          app,
          settings.spacesFolder
        ) as TFolder);
  return uniq([
    ...Object.keys(app.metadataCache.getTags()).map(f => f.toLowerCase()),
    ...(folder?.children
      .filter(
        (f) =>
          f instanceof TFolder && f.name.charAt(0) == "#"
      )
      .map((f) => tagPathToTag(f.name)) ?? []),
  ]);
};

const tagExists = (currentCache: CachedMetadata, findTag: string): boolean => {
  let currentTags: string[] = [];
  if (getAllTags(currentCache)) {
    //@ts-ignore
    currentTags = getAllTags(currentCache);
  }
  return currentTags.find((tag) => tag.toLowerCase() == findTag.toLowerCase())
    ? true
    : false;
};

export const getAllFilesForTag = (plugin: MakeMDPlugin, tag: string) => {
  const tagsCache: string[] = [];

  (() => {
    plugin.app.vault.getMarkdownFiles().forEach((tfile) => {
      let currentCache!: CachedMetadata;
      if (plugin.app.metadataCache.getFileCache(tfile) !== null) {
        //@ts-ignore
        currentCache = plugin.app.metadataCache.getFileCache(tfile);
      }
      const relativePath: string = tfile.path;
      const hasTag: boolean = tagExists(currentCache, tag);
      if (hasTag) {
        tagsCache.push(relativePath);
      }
    });
  })();
  return tagsCache;
};

export const addTagToProperties = (manager: SpaceManager, tag: string, path: string) => {
  const newTag = validateName(tag);
  editTagInProperties(manager, "", newTag, path);
};

const positionsForTag = (plugin: MakeMDPlugin, tag: string, file: TFile) => {
  const currentCache = plugin.app.metadataCache.getFileCache(file);
  if (currentCache.tags) {
    const positions = currentCache.tags
      .filter((f) => f.tag.toLowerCase() == tag.toLowerCase())
      .map((f) => f.position)
      .sort((a: Record<string, any>, b: Record<string, any>) => {
        if (a.start.offset < b.start.offset) {
          return -1;
        }
        if (a.start.offset > b.start.offset) {
          return 1;
        }
        return 0;
      });
    return positions;
  }
  return [];
};

export const removeTagFromMarkdownFile = (plugin: MakeMDPlugin, tag: string, file: TFile) => {

  const pos = positionsForTag(plugin, tag, file);
  removeTagInProperties(plugin.superstate.spaceManager, tag, file.path);
  editTagInFileBody(plugin, tag, "", pos, file);
};

export const renameTagInMarkdownFile = async (plugin: MakeMDPlugin, tag: string, newTag: string, tFile: TFile) => {
  const positions = positionsForTag(plugin, tag, tFile);
  if (positions.length > 0) {
    await editTagInFileBody(plugin, tag, newTag, positions, tFile);
  } else {
    await editTagInProperties(plugin.superstate.spaceManager, tag, newTag, tFile.path);
  }
}

const removeTagInProperties = async (manager: SpaceManager, oldTag: string, path: string) => {
  
  const fm = await readTagFrontmatter(manager, path);
  const oldTagName = stringFromTag(oldTag).toLowerCase();
  const processKey = (value: string | string[]) => {
    const tags = tagsFromPropertyValue(value).filter(
      (f) => oldTagName != f.toLowerCase()
    );
    return tagPropertyValueForOriginalShape(value, tags);
  };
  
  const editKeys = tagKeys.filter((f) => {
    return tagsFromPropertyValue(fm?.[f]).some(
      (g) => g.toLowerCase() == oldTagName
    );
  });
  for (const tag of editKeys) {
    await manager.saveProperties(path, { [tag]: processKey(fm[tag]) });
  }
  
};

const editTagInProperties = async (
  manager: SpaceManager,
  oldTag: string,
  newTag: string,
  path: string
) => {
  
  const addTag = (value: string | string[]) => {
    const tags = uniq([
      ...tagsFromPropertyValue(value),
      stringFromTag(newTag),
    ]).filter(f => f?.length > 0);
    return tagPropertyValueForOriginalShape(value, tags);
  };
  const fm = await readTagFrontmatter(manager, path);
    if (fm) {
      // Match the old tag CASE-INSENSITIVELY. The frontmatter `tags:` property
      // is the canonical property store and is case-PRESERVING (rawFrontmatter
      // -> metadataCache; tagsFromPropertyValue only .toString()s, never
      // folds), so the stored value can be mixed-case ('Foo') from a hand-typed
      // array or addTagToProperties (validateName trims only). But `oldTag`
      // arrives here case-FOLDED — renameTag feeds the lowercased fold to
      // spaceManager.renameTag -> renameTagForFile -> renameTagInMarkdownFile
      // (Notidian-ehfz). A case-SENSITIVE `stringFromTag(oldTag) == g` then
      // failed to match 'Foo' against folded 'foo', fell into the else branch,
      // and APPENDED the new tag while orphaning the old one (silent
      // property-store corruption / partial rename). Lowercasing both sides
      // mirrors removeTagInProperties (which already folds, lines 183/186/193)
      // and is the only case-sensitive tag sink that was left out. The
      // other sinks — positionsForTag, editTagInFileBody, tagExists, and the
      // non-md branch in filesystem.ts — are already case-insensitive.
      const oldTagName = stringFromTag(oldTag).toLowerCase();
      const processKey = (value: string | string[]) => {
        const tags = uniq(
          tagsFromPropertyValue(value).map((f) =>
            oldTagName == f.toLowerCase() ? stringFromTag(newTag) : f
          )
        ).filter(f => f?.length > 0);
        return tagPropertyValueForOriginalShape(value, tags);
      };

      const editKeys = tagKeys.filter((f) => {
        return tagsFromPropertyValue(fm[f]).some(
          (g) => g.toLowerCase() == oldTagName
        );
      });
      if (editKeys.length > 0) {
        for (const key of editKeys) {
          await manager.saveProperties(path, {
            [key]: processKey(fm[key]),
          });
        }
      } else {
        await manager.saveProperties(path, {
          tags: addTag(fm["tags"]),
        });
        
      }
    } else {
      await manager.saveProperties(path, {
        tags: stringFromTag(newTag),
      });
      
    }

};

const editTagInFileBody = async (
  plugin: MakeMDPlugin,
  oldTag: string,
  newTag: string,
  positions: Pos[],
  file: TFile
) => {
  if (positions.length == 0) return false;
  const original = await plugin.files.readTextFromFile(file.path);
  let text = original;
  let offset = 0;
  for (const { start, end } of positions) {
    const startOff = start.offset + offset;
    const endOff = end.offset + offset;
    if (text.slice(startOff, endOff).toLowerCase() !== oldTag.toLocaleLowerCase()) {
      return false;
    }
    // Splice over the ACTUAL in-file span [startOff, endOff), NOT oldTag.length.
    // The metadata-cache positions reflect the raw in-file occupancy, which can
    // DIFFER from oldTag.length when oldTag is a case-fold: Unicode lowercasing
    // can change length (e.g. Turkish dotted capital 'İ' U+0130 folds to two
    // code units), so '#İstanbul'.length (9) != '#İstanbul'.toLowerCase().length
    // (10). renameTag now feeds the lowercased fold here (Notidian-ehfz); using
    // oldTag.length would over/under-cut and eat or leave neighbouring bytes
    // (e.g. swallow the trailing space). The real span and a per-position delta
    // keep the running offset correct across multiple occurrences regardless of
    // the source casing.
    const spanLength = endOff - startOff;
    text = text.slice(0, startOff) + newTag + text.slice(endOff);
    offset += newTag.length - spanLength;
  }
  if (text !== original) {
    await plugin.files.writeTextToFile(file.path, text);
    return true;
  }
};
