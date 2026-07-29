import { spaceContextsKey, spaceFilenameTemplateKey, spaceJoinsKey, spaceLinksKey, spaceSortKey, spaceTemplateKey, spaceTemplateNameKey } from "core/types/space";
import { reorderPathsInContext } from "core/utils/contexts/context";
import { applyNewRowTypeProfileDefaults } from "core/utils/contexts/typeProfileDefaults";
import { runFormulaWithContext } from "core/utils/formula/parser";
import { ensureArray, ensureBoolean, ensureNumber, ensureString, ensureStringValueFromSet } from "core/utils/strings";
import { compareByField, compareByFieldCaseInsensitive, compareByFieldDeep, compareByFieldNumerical } from "core/utils/tree";
import { isTouchScreen } from "core/utils/ui/screen";
import { Superstate } from "makemd-core";
import i18n from "shared/i18n";
import { SpaceProperty } from "shared/types/mdb";
import { MDBFrame } from "shared/types/mframe";
import { TargetLocation } from "shared/types/path";
import { CacheState, PathState, SpaceState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { FilterDef, FilterGroupDef, JoinDefGroup, SpaceDefinition, SpaceSort } from "shared/types/spaceDef";
import { SpaceInfo } from "shared/types/spaceInfo";
import { PathStateWithRank } from "shared/types/superstate";
import { sanitizeColumnName } from "shared/utils/sanitizers";
import { movePath } from "shared/utils/uri";
import { defaultValueForType } from "utils/properties";
import { deletePath } from "./path";
import { addTagToPath, deleteTagFromPath } from "./tags";

const parseSpaceSort = (value: any) : SpaceSort => {
  return {
      field: ensureString(value?.['field'] ?? 'rank'),
      asc: ensureBoolean(value?.['asc']),
      group: ensureBoolean(value?.['group']),
      recursive: ensureBoolean(value?.['recursive'])
  }
}

const fixSpaceDefType = (type: string) : string => {
  if (type == 'fileprop') return 'file';
  if (type == 'filemeta') return 'path';
  return ensureString(type)
}

const parseSpaceFilterGroupFilter = (value: any) : FilterDef => {
    return {
        type: fixSpaceDefType(value['type']),
        fType: ensureString(value['fType']),
        field: ensureString(value['field']),
        fn: ensureString(value['fn']),
        value: ensureString(value['value']),
    }
}
const parseSpaceFilterGroup = (value: any) : FilterGroupDef => {
    return {type: ensureStringValueFromSet(value['type'], ['any', 'all'], 'any') as 'any' | 'all',
    trueFalse: value['truefalse'] ? true : false,
    filters: ensureArray(value['filters']).map(f => parseSpaceFilterGroupFilter(f))
}
}

const parseSpaceJoinGroup = (value: any) : JoinDefGroup => {
    return {
        recursive: ensureBoolean(value['recursive']),
        path: ensureString(value['path']),
        type: ensureStringValueFromSet(value['type'], ['any', 'all'], 'any') as 'any' | 'all',
        groups: ensureArray(value['groups']).map(f => parseSpaceFilterGroup(f))
    }
  }

export const parseSpaceMetadata = (metadata: Record<string, any>, settings: MakeMDSettings) : SpaceDefinition => {
    return {
      sort: parseSpaceSort(metadata[spaceSortKey]), 
      joins: ensureArray(metadata[spaceJoinsKey]).map(f => parseSpaceJoinGroup(f)),
      contexts: ensureArray(metadata[spaceContextsKey]), 
      links: ensureArray(metadata[spaceLinksKey]), 
      template: ensureString(metadata[spaceTemplateKey]),
      templateName: ensureString(metadata[spaceTemplateNameKey]),
      defaultSticker: ensureString(metadata.defaultSticker),
      defaultColor: ensureString(metadata.defaultColor),
      readMode: ensureBoolean(metadata.readMode),
      fullWidth: ensureBoolean(metadata.fullWidth),
      noteBodyCollapsed: ensureBoolean(metadata.noteBodyCollapsed),
      noteBodyHeight: ensureNumber(metadata.noteBodyHeight),
      activeHubTab: ensureString(metadata.activeHubTab) || undefined,
      filenameTemplate: ensureString(metadata[spaceFilenameTemplateKey]),
    }
}

type TreeNodeType = 'space' | "file" | 'group' | 'new'
export interface TreeNode {
  id: string;
  parentId: string;
  depth: number;
  index: number;
  space: string;
  sortable?: boolean;
  // True ONLY on nodes emitted by filterTreeByQuery (a Navigator text filter is
  // active). Marks the node as belonging to a sparse, re-indexed, ancestor-only
  // projection whose depth/parentId are NOT the real tree's, so drag/drop rank &
  // parent math (getProjection / dropPathsInTree) must not run against it
  // (Notidian-21l4). Distinct from `sortable`, which independently means "this
  // space is manually rank-ordered" and is false for any non-rank sort (name,
  // date, ...) in the NORMAL, unfiltered tree -- so it can never be reused as the
  // DnD-inert signal without breaking move-between-parents in sorted folders.
  filtered?: boolean;
  type: TreeNodeType,
  path: string;
  item?: PathStateWithRank;
  childrenCount: number;
  collapsed: boolean;
  rank: number;
}
export const spaceToTreeNode = (
  path: PathStateWithRank,
  collapsed: boolean,
  sortable: boolean,
  depth: number,
  parentId: string,
  parentPath: string,
  childrenCount: number,

): TreeNode => {
  return {
    id: parentId ? parentId +'/'+ path.path : path.path,
    parentId,
    depth,
    index: 0,
    space: parentPath,
    path: path.path,
    item: path,
    rank: path?.rank,
    collapsed: collapsed,
    sortable: sortable,
    childrenCount: childrenCount,
    type: 'space',
  };
};
export const pathStateToTreeNode = (
  superstate: Superstate,
  item: PathStateWithRank,
  space: string,
  path: string,
  depth: number,
  i: number,
  collapsed: boolean,
  sortable: boolean,
  childrenCount: number,
  parentId: string,

) : TreeNode => ({
  item: item,
  space,
  id: parentId + "/" + item.path,
  parentId: parentId,
  depth: depth,
  path,
  index: i,
  collapsed,
  sortable,
  childrenCount,
  rank: item.rank,
  type: 'file',
});

// ---------------------------------------------------------------------------
// Navigator text filter (bd Notidian-nrjb, gated by
// settings.enableNavigatorTextFilter). PURE + offline: reads only the
// already-loaded superstate.pathsIndex/spacesIndex Maps (in-memory caches) --
// unlike treeForRoot/treeForSpace above, it never calls superstate.getSpaceItems
// (which side-effects a spaceManager.loadPath per item), so it is safe to
// recompute on every keystroke of a large vault without touching the
// filesystem.
// ---------------------------------------------------------------------------

// The same display-name resolution SpaceTreeItem uses to render a row's label
// (label.name -> name -> raw path), so the filter matches what the user sees.
const navigatorFilterDisplayName = (pathState: PathState, path: string): string =>
  pathState?.label?.name ?? pathState?.name ?? path;

const navigatorFilterIsMatch = (
  pathState: PathState,
  path: string,
  queryLower: string
): boolean => {
  if (queryLower.length === 0) return true; // empty query => passthrough (match all)
  if (
    navigatorFilterDisplayName(pathState, path).toLowerCase().includes(queryLower)
  )
    return true;
  return path.toLowerCase().includes(queryLower);
};

/**
 * Build a flattened TreeNode[] of every non-hidden path (file or space) whose
 * display name or full path contains `query` (case-insensitive; a blank query
 * matches everything), PLUS every ancestor of a match -- walked upward via
 * PathState.parent, stopping at (and including) the first `activeViewSpaces`
 * root reached, or at a dead end -- so a match stays reachable regardless of
 * the persisted expandedSpaces collapse state.
 *
 * This intentionally does NOT reuse the treeForRoot/treeForSpace recursion:
 * those walk real space membership (superstate.getSpaceItems), which is
 * correct for the always-expanded-by-user tree but would force a
 * spaceManager.loadPath call for every path in the vault on every keystroke.
 * PathState.parent is the real filesystem/space container for the common
 * folder-based case this bead targets ("vault file tree / navigator"); a path
 * whose parent chain never reaches a view root still renders (as its own
 * depth-0 result group) rather than being dropped.
 *
 * GHOST ANCESTORS (live-verify catch, Notidian-nrjb): some `.parent` chains
 * point at a synthetic container with no PathState entry of its own -- e.g. a
 * tag-space's parent is the literal string "spaces:/", which superstate never
 * indexes as a path. TreeItem/SpaceTreeItem reads `data.item.path`
 * unconditionally (no optional chaining), so ever emitting a TreeNode with no
 * `item` crashes the whole navigator's ErrorBoundary the instant a query
 * matches a tag-space (e.g. typing a substring of a tag name). Every ancestor
 * is therefore required to have a REAL pathsIndex entry (`isRenderable`) to be
 * (a) emitted as a node at all and (b) treated as a valid parent/depth link;
 * a ghost is still walked over (so the walk does not stop short of a real
 * grandparent) but is silently skipped rather than rendered.
 *
 * HIDDEN ANCESTORS (review catch, Notidian-nrjb): `PathState.hidden` is
 * computed per-path by `excludePathPredicate` (src/utils/hide.ts) -- it is
 * NOT inherited/cascaded from parent to child in the indexer. So a hidden
 * folder's own children are not automatically hidden themselves; if such a
 * child matches the query, the step-2 ancestor walk above still force-includes
 * the hidden folder's real PathState. `isRenderable` therefore also excludes
 * `hidden` paths (not just ghosts) from ever being emitted as a node or
 * treated as a valid parent/depth link -- a hidden ancestor is silently
 * skipped rather than rendered as a full node with its own name/sticker/path
 * (which would otherwise leak hidden content through the filter).
 *
 * RE-PARENTING PAST A NON-RENDERABLE ANCESTOR (review catch, Notidian-nrjb):
 * skipping a hidden (or ghost) ancestor's own node must not orphan the match
 * that sits below it. `nearestRenderableAncestor` walks upward past any
 * number of consecutive non-renderable hops (hidden folders, ghosts, or a mix)
 * to the nearest ancestor that IS renderable and was reached by the step-2
 * walk -- depth, parentId, and childCounts all attribute to that ancestor, not
 * to the immediate (possibly non-renderable) `.parent`. So a match under a
 * hidden folder nests under the real, visible grandparent (e.g. the view
 * root) instead of rendering as a disconnected top-level "group" -- the walk
 * only bottoms out at depth 0 / parentId null when there is truly no
 * renderable ancestor left to reach (a dead end, or nothing but ghosts all the
 * way up, exactly the pre-existing ghost-ancestor case).
 */
export const filterTreeByQuery = (
  superstate: Superstate,
  activeViewSpaces: PathState[],
  query: string,
  additionalMatchPaths?: ReadonlySet<string>
): TreeNode[] => {
  const queryLower = (query ?? "").trim().toLowerCase();
  const rootPaths = new Set(
    (activeViewSpaces ?? []).filter((f) => f).map((f) => f.path)
  );
  const isRenderable = (path: string) => {
    const pathState = superstate.pathsIndex.get(path);
    return !!pathState && !pathState.hidden;
  };

  // 1. Every non-hidden path whose name/path or derived content index matches.
  // The optional set is path-only: body text never crosses into this
  // synchronous tree projection.
  const matchedPaths: string[] = [];
  for (const [path, pathState] of superstate.pathsIndex) {
    if (!pathState || pathState.hidden) continue;
    if (
      navigatorFilterIsMatch(pathState, path, queryLower) ||
      additionalMatchPaths?.has(path)
    ) {
      matchedPaths.push(path);
    }
  }

  // 2. Force-include every ancestor of a match, regardless of collapse state.
  // Bounded by a per-walk visited-set so malformed/cyclic parent data can
  // never spin forever. May accumulate ghost (non-renderable) ancestors --
  // filtered out below, never emitted.
  const includedPaths = new Set<string>();
  matchedPaths.forEach((path) => {
    const visited = new Set<string>();
    let current: string | undefined = path;
    while (current && !visited.has(current)) {
      includedPaths.add(current);
      visited.add(current);
      if (rootPaths.has(current)) break;
      const parent = superstate.pathsIndex.get(current)?.parent;
      current = parent && parent.length > 0 ? parent : undefined;
    }
  });

  // 3. nearestRenderableAncestor(path) walks upward from path's immediate
  // `.parent`, skipping any number of consecutive non-renderable hops (hidden
  // folders, ghosts, or a mix), to the first ancestor that is BOTH renderable
  // and was reached by the step-2 inclusion walk. Bounded by a per-call
  // visited-set (guards a self/cyclic parent) and memoized. Returns undefined
  // at a genuine dead end (no PathState, or nothing but ghosts/hidden hops all
  // the way up) -- the same terminal case the pre-existing ghost-ancestor
  // handling already covered.
  const nearestAncestorCache = new Map<string, string | undefined>();
  const nearestRenderableAncestor = (path: string): string | undefined => {
    if (nearestAncestorCache.has(path)) return nearestAncestorCache.get(path);
    nearestAncestorCache.set(path, undefined); // cycle guard placeholder
    const visited = new Set<string>([path]);
    let current = superstate.pathsIndex.get(path)?.parent;
    let ancestor: string | undefined;
    while (current && current.length > 0 && !visited.has(current)) {
      visited.add(current);
      if (isRenderable(current) && includedPaths.has(current)) {
        ancestor = current;
        break;
      }
      current = superstate.pathsIndex.get(current)?.parent;
    }
    nearestAncestorCache.set(path, ancestor);
    return ancestor;
  };
  // A view root always renders at depth 0 with no parent, even if its own
  // `.parent` chain continues beyond the root boundary.
  const ancestorOf = (path: string): string | undefined =>
    rootPaths.has(path) ? undefined : nearestRenderableAncestor(path);

  // depth = distance from the nearest RENDERABLE included ancestor (0 at a
  // view root, or at a dead end past only ghost/hidden hops). Memoized; the
  // same placeholder cache trick guards a self/cyclic parent from recursing
  // forever.
  const depthCache = new Map<string, number>();
  const depthOf = (path: string): number => {
    if (depthCache.has(path)) return depthCache.get(path);
    depthCache.set(path, 0);
    const ancestor = ancestorOf(path);
    const depth = ancestor ? depthOf(ancestor) + 1 : 0;
    depthCache.set(path, depth);
    return depth;
  };

  // 4. Drop ghost AND hidden ancestors, then emit in strict DFS PRE-ORDER of the
  // rendered tree so every subtree is CONTIGUOUS. The depth-indented flat
  // renderer (SpaceTreeItem indents purely by `depth`; VirtualizedList draws in
  // array order; the child-count guide line spans `childrenCount` following
  // rows) reads nesting SOLELY from `depth` + position, so each node must sit
  // immediately under its own parent's subtree.
  //
  // A plain lexical string sort does NOT guarantee this. It only guarantees
  // "ancestor before descendant"; it does NOT keep a subtree contiguous, because
  // '/' (0x2F) is not the lowest separator: a sibling FILE whose name extends a
  // sibling FOLDER's name with a space (0x20), '-' (0x2D) or '.' (0x2E) sorts
  // BETWEEN the folder and the folder's own descendants (e.g. "Projects", then
  // "Projects Overview.md", then "Projects/Sub"), so "Projects/Sub" would render
  // one level deeper than the FILE just above it and appear mis-parented under
  // it. Instead: group every renderable path under its RENDERED parent
  // (ancestorOf -- already accounts for re-parenting past hidden/ghost hops),
  // order siblings by path SEGMENTS, then walk the forest depth-first. This
  // mirrors the contiguous output the non-filter treeForRoot/treeForSpace
  // recursion already produces.
  const renderablePaths = [...includedPaths].filter(isRenderable);
  // Segment-wise compare: a whole path segment ('/'-delimited) is the unit, so a
  // folder ("Projects") always sorts before any sibling whose first segment
  // merely extends it ("Projects Overview.md"), and an ancestor (fewer segments,
  // shared prefix) always sorts before its descendants.
  const compareBySegments = (a: string, b: string): number => {
    const as = a.split("/");
    const bs = b.split("/");
    const shared = Math.min(as.length, bs.length);
    for (let i = 0; i < shared; i++) {
      if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
    }
    return as.length - bs.length;
  };
  const segmentOrdered = [...renderablePaths].sort(compareBySegments);
  // Bucket every renderable path under its rendered parent (null == a forest
  // root: a view root, or a match whose only ancestors were ghost/hidden). Each
  // bucket inherits segmentOrdered's sibling order.
  const childrenByRenderedParent = new Map<string | null, string[]>();
  segmentOrdered.forEach((path) => {
    const parent = ancestorOf(path) ?? null;
    const siblings = childrenByRenderedParent.get(parent);
    if (siblings) siblings.push(path);
    else childrenByRenderedParent.set(parent, [path]);
  });
  const sortedPaths: string[] = [];
  const emitted = new Set<string>();
  const emitSubtree = (path: string) => {
    if (emitted.has(path)) return; // forest is acyclic by construction; defensive
    emitted.add(path);
    sortedPaths.push(path);
    (childrenByRenderedParent.get(path) ?? []).forEach(emitSubtree);
  };
  (childrenByRenderedParent.get(null) ?? []).forEach(emitSubtree);
  // Safety net: a malformed/cyclic ancestor link must never DROP a renderable
  // path from the result (only mis-order it). Sweep any node the forest walk
  // missed, in segment order, so the emitted set always equals renderablePaths.
  segmentOrdered.forEach(emitSubtree);

  // Children-count is the TOTAL number of INCLUDED, RENDERABLE flattened
  // DESCENDANTS a node renders above (every row nested under it in this
  // filtered result), not just its direct children -- so it matches the
  // NON-filter tree, where spaceToTreeNode receives `tree.length` (the whole
  // accumulated subtree). The CSS `--childrenCount` guide line is sized as
  // `childrenCount * rowHeight` (SpaceTreeItem), i.e. it must span every row of
  // the subtree below the node; a direct-child count draws the line short for
  // any space with grandchildren. Each path therefore increments EVERY rendered
  // ancestor up its re-parented chain (ancestorOf already re-parents past
  // hidden/ghost hops), bounded by a per-walk visited-set against any malformed
  // cycle (the forest is acyclic by construction).
  const childCounts = new Map<string, number>();
  sortedPaths.forEach((path) => {
    const visited = new Set<string>();
    let ancestor = ancestorOf(path);
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      childCounts.set(ancestor, (childCounts.get(ancestor) ?? 0) + 1);
      ancestor = ancestorOf(ancestor);
    }
  });

  return sortedPaths.map((path, index) => {
    const pathState = superstate.pathsIndex.get(path);
    const depth = depthOf(path);
    const parentId = ancestorOf(path) ?? null;
    const isSpace = superstate.spacesIndex.has(path);
    // Every depth-0 result renders as a "group" (root section) header, exactly
    // like treeForRoot's own root node -- avoids the negative CSS indentation
    // spacing 'space'-type rows assume they never sit at depth 0.
    const type: TreeNode["type"] = depth === 0 ? "group" : isSpace ? "space" : "file";
    return {
      id: path,
      parentId,
      depth,
      index,
      space: parentId ?? path,
      sortable: false,
      // Filter-active projection -> DnD is inert on every emitted node (see
      // TreeNode.filtered / Notidian-21l4). `filtered` is the ONLY signal the
      // drag handlers key off; `sortable:false` here is unrelated (nothing in a
      // filtered view is rank-ordered) and must NOT be what gates DnD, or normal
      // non-rank-sorted rows would break too.
      filtered: true,
      type,
      path,
      item: { ...pathState, rank: pathState.rank ?? 0 } as PathStateWithRank,
      childrenCount: childCounts.get(path) ?? 0,
      collapsed: false,
      rank: pathState.rank ?? 0,
    };
  });
};

export const spaceRowHeight = (superstate: Superstate, preset: number, section: boolean) => {
  const spaceHeight = preset ?? (isTouchScreen(superstate.ui) ? 40 : 29);
  return spaceHeight + (section ? 10 : 0);
}

export const defaultSpaceSort = {
  field: "rank",
  asc: true,
  group: true,
  recursive: false,
}

export const spaceSortFn =
  (sortStrategy: SpaceSort) =>
  (a: CacheState, b: CacheState) => {
    if (sortStrategy.field == "rank") {
      return (a.rank - b.rank);
    }
    const sortFns = [];
    if (sortStrategy.group) {
      sortFns.push(compareByField("type", false))
    }
    if (sortStrategy.field == 'number') {
      sortFns.push(compareByFieldNumerical('name', sortStrategy.asc));
    } else 
    if (sortStrategy.field == 'name')
    
    {
      sortFns.push(compareByFieldCaseInsensitive(sortStrategy.field, sortStrategy.asc));
    } else if (sortStrategy.field.startsWith('props')) {
      const propName = sortStrategy.field.split('.')[1];
      const fieldFunc = (obj: Record<string, any>) => obj?.metadata?.property?.[propName]
      sortFns.push(compareByFieldDeep(fieldFunc, sortStrategy.asc));
    }
    else {
      const fieldFunc = (obj: Record<string, any>) => obj?.metadata?.file?.[sortStrategy.field]
sortFns.push(compareByFieldDeep(fieldFunc, sortStrategy.asc))
    }
    return sortFns.reduce((p, c) => {
      return p == 0 ? c(a, b) : p;
    }, 0);
  };



export const updatePathRankInSpace = async (
  superstate: Superstate,
  path: string,
  rank: number,
  space: string
) => {

  const spaceState = superstate.spacesIndex.get(space);
if (!spaceState) return;

    const fixedRank = rank;
    superstate.addToContextStateQueue(() => reorderPathsInContext(superstate.spaceManager, [path], fixedRank, spaceState.space).then(f => {
      const promises = [...superstate.spacesMap.getInverse(spaceState.path)].map(f => superstate.reloadPath(f));
    return Promise.all(promises);
    }).then(reloads => {
      if (reloads.some(Boolean)) superstate.dispatchEvent("spaceStateUpdated", {path: spaceState.path});
    }))
    
    
};



export const movePathToNewSpaceAtIndex = async (
  superstate: Superstate,
  item: PathState,
  newParent: string,
  index: number,
  copy?: boolean
) => {
  if (!item) return;
  //pre-save before vault change happens so we can save the rank
  const currentPathState = superstate.pathsIndex.get(item.path);
  if (!currentPathState) return;
  const newPath =
    newParent == "/" ? currentPathState.name : newParent + "/" + currentPathState.name;
  
  if (await superstate.spaceManager.pathExists(newPath)) {

    superstate.ui.notify(i18n.notice.fileExists);
    return;
  }
    
      if (copy) {
        await superstate.spaceManager.copyPath(item.path, newParent)
      } else {
        const renamed = await superstate.spaceManager.renamePath(
          item.path,
          movePath(item.path, newParent)
        );
        if (!renamed) return;
      }
      updatePathRankInSpace(superstate,newPath, index, newParent)
    
  
};

export const setTemplateInSpace = (superstate: Superstate, path: string, template: string) => {
  saveSpaceMetadataValue(superstate, path, "template", template)

}

export const setTemplateNameInSpace = (superstate: Superstate, path: string, templateName: string) => {
  saveSpaceMetadataValue(superstate, path, "templateName", templateName)

}

export const insertContextInSpace = (superstate: Superstate, path: string, newTag: string) => {
  const spaceCache = superstate.spacesIndex.get(path);
  const contexts = [...spaceCache.metadata.contexts.filter(f => f != newTag), newTag]
;
  saveSpaceMetadataValue(superstate, path, "contexts", contexts)
}

export const removeContextInSpace = (superstate: Superstate, path: string, oldTag: string) => {
  const spaceCache = superstate.spacesIndex.get(path);
  const contexts = spaceCache.metadata.contexts.filter(f => f != oldTag)
  saveSpaceMetadataValue(superstate, path, "contexts", contexts)
}

export const renameContextInSpace = (superstate: Superstate, path: string, oldTag: string, newTag: string) => {
  const spaceCache = superstate.spacesIndex.get(path);
  const contexts = spaceCache.metadata.contexts.map(f => f == oldTag ? newTag : f)
  saveSpaceMetadataValue(superstate, path,"contexts", contexts)
}

export const createSpace = async (
  superstate: Superstate,
  path: string,
  newSpace?: SpaceDefinition,
) => {


  const space = superstate.spacesIndex.get(path);

  let newSpaceCache;
  if (space) {
    if (!superstate.pathsIndex.has(path)) {
      return await superstate.reloadSpace(space.space)
      return;
    }
    if (newSpace)
      {
        newSpaceCache =  await saveSpaceCache(superstate, space.space, newSpace)
      } else {
        return;
      }
  } else {
    const spaceInfo = superstate.spaceManager.spaceInfoForPath(path);

    if (spaceInfo.readOnly) {
      return await superstate.reloadSpace(spaceInfo)
    }
    await superstate.spaceManager.createSpace(spaceInfo.name, superstate.spaceManager.parentPathForPath(spaceInfo.path), newSpace);
    
    if (newSpace) {

      await saveSpaceCache(superstate, spaceInfo, newSpace)
      newSpaceCache = await superstate.reloadSpace(spaceInfo, newSpace)
  } else {
    newSpaceCache = await superstate.reloadSpace(spaceInfo)
  }
  }
  superstate.onSpaceDefinitionChanged(newSpaceCache, null);
  return newSpaceCache;
};



export const saveSpaceMetadataValue = async (superstate: Superstate, space: string, key: keyof SpaceDefinition, value: any) => {
  await superstate.spaceManager.saveSpace(space, (metadata) => ({...metadata, [key]: value}))
  const spaceCache = superstate.spacesIndex.get(space)
  await superstate.updateSpaceMetadata(space, { ...spaceCache.metadata, [key]: value})
}

export const saveSpaceProperties = async (superstate: Superstate, space: string, properties: Record<string, any>) => {
  
    superstate.spaceManager.saveSpace(space, (metadata) => (metadata), properties)
  }

export const saveSpaceCache = async (superstate: Superstate, spaceInfo: SpaceInfo, metadata: SpaceDefinition) => {
  await superstate.spaceManager.saveSpace(spaceInfo.path, (oldMetadata) => ({...oldMetadata, ...metadata}));

  return superstate.updateSpaceMetadata(spaceInfo.path, metadata)
}

export const addPathToSpaceAtIndex = async (
  superstate: Superstate, space: SpaceState, path: string, rank?: number) => {
    if (space.type == 'tag') {
    return addTagToPath(superstate, path, space.name);
    } else {
      return pinPathToSpaceAtIndex(superstate, space, path, rank)
    }
  }

  export const addPathsToSpaceAtIndex = async (
    superstate: Superstate, space: SpaceState, path: string, rank?: number) => {
      if (space.type == 'tag') {
      return addTagToPath(superstate, path, space.name);
      } else {
        return pinPathToSpaceAtIndex(superstate, space, path, rank)
      }
    }

    export const defaultSpace = async (superstate: Superstate, activeFile: PathState) : Promise<SpaceState> =>
      {
        let spaceState = null;
        if (superstate.settings.newFileLocation == "folder") {
          spaceState = superstate.spacesIndex.get(superstate.settings.newFileFolderPath)
        } else if (superstate.settings.newFileLocation == "current" && activeFile && activeFile.type == 'space') {
          spaceState = superstate.spacesIndex.get(activeFile.path)
        } else if (activeFile) {
          spaceState = superstate.spacesIndex.get(activeFile.parent)
        }
        if (!spaceState) {
          spaceState = superstate.spacesIndex.get('/');
        }
        return spaceState;
      }
  
export const pinPathToSpaceAtIndex = async (
  superstate: Superstate,
  space: SpaceState,
  path: string,
  rank?: number
) => {
  if (path == space.path) {
    // superstate.ui.notify('Pinning space to itself not currently allowed')
    return;
  }
    const spaceExists = ensureArray(space.metadata.links) ?? []
    const pathExists = spaceExists.find((f) => f == path);
    if (!pathExists) {
      spaceExists.push(path)
    }
    
  await saveSpaceCache(superstate, space.space, {...space.metadata, links: spaceExists});  

  await superstate.reloadPath(path, true).then(reloaded => {
    if (reloaded) superstate.dispatchEvent("pathStateUpdated", {path: path});
  })
  updatePathRankInSpace(superstate,path, rank, space.path)

};


export const removeSpace = async (superstate: Superstate, space: string) => {
const spaceCache = superstate.spacesIndex.get(space)
if (!spaceCache) return;
if (spaceCache.type == 'tag') {
  superstate.onTagDeleted(spaceCache.name)
} else if (spaceCache.type == 'folder') {
  await deletePath(superstate, spaceCache.path)
}
  
};

export const updateSpaceSort = (
  superstate: Superstate,
  path: string,
  sort: SpaceSort
) => {
  const space = superstate.spacesIndex.get(path);

  if (space)
  saveSpaceCache(superstate, space.space, {
    ...space.metadata,
    sort
  })
};


export const metadataPathForSpace = (superstate: Superstate, space: SpaceInfo) => {
  if (superstate.settings.enableFolderNote) {
    return space.notePath;
  }
  return space.defPath 
}

export const saveSpaceTemplate = async (
  superstate: Superstate,
  path: string,
  space: string
) => {
  const spaceCache = superstate.spacesIndex.get(space);
  if (!spaceCache) return;
  await superstate.spaceManager.saveTemplate(path, spaceCache.path)
  superstate.ui.notify(i18n.notice.templateSaved + spaceCache.name)
}

export const removePathsFromSpace = async (
  superstate: Superstate,
  spacePath: string,
  paths: string[]
) => {
const space = superstate.spacesIndex.get(spacePath);
if (!space) return;
  
  if (space.type == 'tag') {
    paths.forEach(path => deleteTagFromPath(superstate, path, space.name))
  } else if (space.type == 'folder' || space.type == 'vault') {

  await saveSpaceMetadataValue(superstate, space.path, "links", space.metadata.links.filter(f => !paths.some(g => g == f)))
  
}
}

export const newTemplateInSpace = async (
  superstate: Superstate,
  space: SpaceState,
  name: string,
  location?: TargetLocation
) => {
  return newTemplatePathInSpace(superstate, space, name, {
    dontOpen: false,
    location,
  });
};

export const newTemplatePathInSpace = async (
  superstate: Superstate,
  space: SpaceState,
  templateName: string,
  options?: {
    dontOpen?: boolean;
    fallbackName?: string;
    location?: TargetLocation;
  }
) => {
  let newName: string | undefined = options?.fallbackName;
  try {
    if (space.metadata.templateName?.length > 0) {
      const result = runFormulaWithContext(
        superstate.formulaContext,
        superstate.pathsIndex,
        superstate.spacesMap,
        space.metadata.templateName,
        {},
        {},
        superstate.pathsIndex.get(space.path)
      );
      if (result?.length > 0) newName = result;
    }
  } catch (e) {
  }
  const templatePath =
    `${space.path}/${superstate.settings.spaceSubFolder}/templates/${templateName}`;
  if (!(await superstate.spaceManager.pathExists(templatePath))) {
    return newPathInSpace(
      superstate,
      space,
      "md",
      options?.fallbackName,
      options?.dontOpen,
      null,
      options?.location
    );
  }
  const newPath = await superstate.spaceManager.copyPath(
    templatePath,
    space.path,
    newName
  );
  if (newPath && !options?.dontOpen)
    superstate.ui.openPath(newPath, options?.location);
  return newPath;
};

export const newRowPathInSpace = async (
  superstate: Superstate,
  space: SpaceState,
  name: string,
  dontOpen?: boolean,
  location?: TargetLocation
) => {
  if (space?.metadata.template?.length > 0) {
    return newTemplatePathInSpace(superstate, space, space.metadata.template, {
      dontOpen,
      fallbackName: name,
      location,
    });
  }
  return newPathInSpace(
    superstate,
    space,
    "md",
    name,
    dontOpen,
    undefined,
    location
  );
};


export const newPathInSpace = async (
  superstate: Superstate,
  space: SpaceState,
  type: string,
  name: string,
  dontOpen?: boolean,
  content?: string,
  location?: TargetLocation
) => {
  let newPath;
if (space.type == 'tag') {

  newPath = await superstate.spaceManager.createItemAtPath(
    '/',
    type,
    name,
    content
  );
  await superstate.spaceManager.addTag(newPath, space.name);
} else {
    newPath = await superstate.spaceManager.createItemAtPath(
      space.path,
      type,
      name,
      content
    );
    // Seed a new folder-backed row with its database's Type Profile defaults
    // (Notidian-drv). No-op unless the hub note declares a profile with defaults.
    if (type == "md" && typeof newPath == "string" && newPath) {
      await applyNewRowTypeProfileDefaults(superstate, space.path, newPath);
    }
}
    if (!dontOpen) {
      superstate.ui.openPath(newPath, location);
    }
return newPath
};

export const saveLabel = (superstate: Superstate, path: string, label: string, value: string) => {
  superstate.spaceManager.saveLabel(path, label, value);
}

export  const saveNewProperty = async (superstate: Superstate, path: string, property: SpaceProperty) => {
  const saveProperty = (
    tableData : MDBFrame,
    newColumn: SpaceProperty,
    oldColumn?: SpaceProperty
  ): boolean => {
    const column = {
      ...newColumn,
      name: sanitizeColumnName(newColumn.name),
    };
    const mdbtable = tableData;

    if (column.name == "") {
      superstate.ui.notify(i18n.notice.noPropertyName);
      return false;
    }
    if (
      (!oldColumn &&
        mdbtable.cols.find(
          (f) => f.name.toLowerCase() == column.name.toLowerCase()
        )) ||
      (oldColumn &&
        oldColumn.name != column.name &&
        mdbtable.cols.find(
          (f) => f.name.toLowerCase() == column.name.toLowerCase()
        ))
    ) {
      superstate.ui.notify(i18n.notice.duplicatePropertyName);
      return false;
    }
    
    const oldFieldIndex = oldColumn
      ? mdbtable.cols.findIndex((f) => f.name == oldColumn.name)
      : -1;
    const newFields: SpaceProperty[] =
      oldFieldIndex == -1
        ? [...mdbtable.cols, column]
        : mdbtable.cols.map((f, i) => (i == oldFieldIndex ? column : f));
    const newTable = {
      ...mdbtable,
      cols: newFields ?? [],
    };
    superstate.spaceManager.saveFrame(path, newTable as MDBFrame);
    return true;
  };
  if (superstate.spacesIndex.has(path)) {
    const tableData = await superstate.spaceManager.readFrame(path, 'main');
    saveProperty(tableData, {...property, schemaId: "main"});
} else {
  superstate.spaceManager.saveProperties(path, { [property.name]: defaultValueForType(property.type) });
}
}

export const saveProperties = (superstate: Superstate, path: string, properties: Record<string, any>) => {
    if (superstate.spacesIndex.has(path)) {
        return saveSpaceProperties(superstate, path, properties)
    } else {
      return superstate.spaceManager.saveProperties(path, properties);
    }
};

export const renameProperty = (superstate: Superstate, path: string, oldName: string, newName: string) => {
    if (superstate.spacesIndex.has(path)) {
        superstate.spaceManager.renameProperty(metadataPathForSpace(superstate, superstate.spacesIndex.get(path).space), oldName, newName)
        return;
    }
  superstate.spaceManager.renameProperty(path, oldName, newName);
}

export const deleteProperty = (superstate: Superstate, path: string, name: string) => {
    if (superstate.spacesIndex.has(path)) {
        return superstate.spaceManager.deleteProperty(metadataPathForSpace(superstate, superstate.spacesIndex.get(path).space), name)
    }
  return superstate.spaceManager.deleteProperty(path, name);
}
