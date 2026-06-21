// ===========================================================================
// DEPTH (Notidian-754s) — characterization-with-fakes net for the navigator
// drag PLACEMENT-COMMIT authority in src/core/utils/dnd/dropPath.ts.
//
// Its projection sibling dragPath.ts (WHERE a drag lands) is already covered by
// dragPath.test.ts (Notidian-79hh). dropPath.ts is the other half: it takes the
// computed DragProjection and COMMITS it — deciding which superstate mutator
// fires (move / pin / rank / remove / addTag / reorderOpenSpace) and with which
// (path, space, index, copy?) arguments, for every decision branch:
//
//   dropPathInTree (single path):
//     parentId = insert ? over : projected.parentId
//     newSpace = depth==0 && !insert ? null : node(parentId).item.path
//     newRank  = parentId==null   ? activeSpaces.findIndex(path==overItem.id)
//              : parentId==overItem.id ? -1
//              : overItem.rank ?? -1
//     !active  -> commit `path`            with oldSpace = null
//      active  -> commit activeItem.item.path with oldSpace derived from active
//     the index handed down is `projected.sortable && newRank` (so a
//     non-sortable projection passes the boolean `false` as the index).
//
//   dropPathsInTree (multi path):
//     paths.length==1 delegates to dropPathInTree.
//     droppable = paths.filter(f => !nodeIsAncestorOfTarget(f, dropTarget.path))
//                 — the ANCESTOR-DROP GUARD (you cannot drop a folder into its
//                 own descendant; such paths are silently excluded).
//     !newSpace -> bail (no mutation at all).
//
//   dropPath(s)InSpaceAtIndex (the commit core):
//     same-space (oldSpacePath == newSpacePath) -> updatePathRankInSpace ONLY,
//       and RETURNS BEFORE the remove guard => a same-space reorder NEVER
//       removes the path (regression lock).
//     folder/vault: modifier=='link' || nodeIsAncestorOfTarget(path,space)
//       -> pinPathToSpaceAtIndex ; else movePathToNewSpaceAtIndex(copy = modifier=='copy').
//     tag: addTagToPath(path, space.name).
//     remove guard: oldSpacePath && oldSpacePath != newSpacePath
//       -> removePathsFromSpace(oldSpacePath, [path]). This is the
//       regression-critical cross-space cleanup: drift here either ORPHANS a
//       path (removes when it should not) or DUPLICATES it across spaces (fails
//       to remove the old membership). We pin both directions.
//
// METHOD: jest.mock the spaces/tags mutator modules (the pattern used by
// subItemCreate.test.ts and the contexts/__audit__ fake-adapter suites), drive
// the real dropPath exports with a fake superstate (just the indices + focuses
// the code reads), and assert WHICH spy fired with WHICH arguments per branch.
// No new sinks; the SUT is unchanged. tsc/jest/build verify offline.
// ===========================================================================

jest.mock("core/superstate/utils/spaces", () => ({
  movePathToNewSpaceAtIndex: jest.fn(),
  pinPathToSpaceAtIndex: jest.fn(),
  removePathsFromSpace: jest.fn(),
  updatePathRankInSpace: jest.fn(),
}));
jest.mock("core/superstate/utils/tags", () => ({
  addTagToPath: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  movePathToNewSpaceAtIndex,
  pinPathToSpaceAtIndex,
  removePathsFromSpace,
  updatePathRankInSpace,
} = require("core/superstate/utils/spaces");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { addTagToPath } = require("core/superstate/utils/tags");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  dropPathInTree,
  dropPathsInTree,
  dropPathInSpaceAtIndex,
  dropPathsInSpaceAtIndex,
  reorderOpenSpace,
} = require("./dropPath");

import type { TreeNode } from "core/superstate/utils/spaces";
import type { DragProjection } from "./dragPath";
import type { DropModifiers } from "core/react/components/Navigator/SpaceTree/SpaceTreeItem";
import type { PathState, SpaceState } from "shared/types/PathState";

// ---- fixtures ------------------------------------------------------------
// Only the fields dropPath actually reads are meaningful. A TreeNode here only
// needs id / parentId / depth / type / rank / item.path (the projected commit
// reads node.item.path) — the rest satisfy the shape.

type NodeOpts = {
  id: string;
  depth?: number;
  parentId?: string | null;
  type?: TreeNode["type"];
  rank?: number;
  noRank?: boolean; // leave node.rank undefined to exercise the `?? -1` fallback
  itemPath?: string;
};

const node = (o: NodeOpts): TreeNode =>
  ({
    id: o.id,
    parentId: o.parentId ?? null,
    depth: o.depth ?? 0,
    index: 0,
    space: "root",
    sortable: false,
    type: o.type ?? "file",
    path: o.itemPath ?? o.id,
    childrenCount: 0,
    collapsed: false,
    rank: o.noRank ? undefined : o.rank ?? 0,
    item: { path: o.itemPath ?? o.id } as TreeNode["item"],
  } as TreeNode);

const projection = (o: Partial<DragProjection>): DragProjection => ({
  depth: 0,
  overId: "",
  parentId: null as any,
  sortable: true,
  insert: false,
  droppable: true,
  copy: false,
  reorder: false,
  ...o,
});

// A fake superstate exposing only what dropPath reads: the two indices (so a
// path/space resolves), plus focuses/settings/spaceManager for reorderOpenSpace.
const makeSuperstate = (opts: {
  paths?: Record<string, Partial<PathState>>;
  spaces?: Record<string, Partial<SpaceState>>;
} = {}): any => {
  const pathsIndex = new Map<string, PathState>(
    Object.entries(opts.paths ?? {}).map(([k, v]) => [
      k,
      { path: k, ...v } as PathState,
    ])
  );
  const spacesIndex = new Map<string, SpaceState>(
    Object.entries(opts.spaces ?? {}).map(([k, v]) => [
      k,
      { path: k, name: k, ...v } as SpaceState,
    ])
  );
  return {
    pathsIndex,
    spacesIndex,
    focuses: [{ sticker: "", name: "wp", paths: [] as string[] }],
    settings: { currentWaypoint: 0 },
    spaceManager: { saveFocuses: jest.fn() },
  };
};

// A folder space at "Folder" whose row "Folder/a.md" exists in pathsIndex.
const folderWorld = (over: Record<string, any> = {}) =>
  makeSuperstate({
    paths: {
      "Folder/a.md": { path: "Folder/a.md" },
      "Other/b.md": { path: "Other/b.md" },
      ...over.paths,
    },
    spaces: {
      Folder: { path: "Folder", name: "Folder", type: "folder" },
      Other: { path: "Other", name: "Other", type: "folder" },
      Tagged: { path: "Tagged", name: "mytag", type: "tag" },
      ...over.spaces,
    },
  });

const MOVE: DropModifiers = "move";

beforeEach(() => {
  movePathToNewSpaceAtIndex.mockReset();
  pinPathToSpaceAtIndex.mockReset();
  removePathsFromSpace.mockReset();
  updatePathRankInSpace.mockReset();
  addTagToPath.mockReset();
});

// =========================================================================
// dropPathInSpaceAtIndex — the COMMIT CORE (every mutator branch)
// =========================================================================
describe("dropPathInSpaceAtIndex — commit-core dispatch", () => {
  it("bails (no mutation, returns false) when the path is not indexed", async () => {
    const ss = folderWorld();
    const r = await dropPathInSpaceAtIndex(
      ss,
      "Ghost/missing.md",
      null,
      "Folder",
      0,
      MOVE
    );
    expect(r).toBe(false);
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
    expect(updatePathRankInSpace).not.toHaveBeenCalled();
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("no newSpacePath => routes to the open-space (waypoint) reorder, not a space mutation", async () => {
    const ss = folderWorld();
    ss.focuses[0].paths = ["Folder/a.md", "x", "y"];
    await dropPathInSpaceAtIndex(ss, "Folder/a.md", null, null as any, 2, MOVE);
    // reorderOpenSpace ran (saveFocuses called); no space-membership mutator fired.
    expect(ss.spaceManager.saveFocuses).toHaveBeenCalled();
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(updatePathRankInSpace).not.toHaveBeenCalled();
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("MOVE into a different folder => movePathToNewSpaceAtIndex(copy=false) then removes from old space", async () => {
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Other/b.md", "Other", "Folder", 3, MOVE);

    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.pathsIndex.get("Other/b.md"),
      "Folder",
      3,
      false // modifier 'move' => copy=false
    );
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
    // cross-space cleanup: remove from the OLD space exactly once.
    expect(removePathsFromSpace).toHaveBeenCalledTimes(1);
    expect(removePathsFromSpace).toHaveBeenCalledWith(ss, "Other", ["Other/b.md"]);
  });

  it("COPY modifier => movePathToNewSpaceAtIndex(copy=true) but STILL removes from old space (copy flag != keep-membership)", async () => {
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Other/b.md", "Other", "Folder", 0, "copy");
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.pathsIndex.get("Other/b.md"),
      "Folder",
      0,
      true // copy=true
    );
    expect(removePathsFromSpace).toHaveBeenCalledWith(ss, "Other", ["Other/b.md"]);
  });

  it("LINK modifier into a folder => PIN (not move), never duplicating the file on disk", async () => {
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Other/b.md", "Other", "Folder", 2, "link");
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.spacesIndex.get("Folder"),
      "Other/b.md",
      2
    );
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("REGRESSION LOCK — ancestor drop PINS instead of moving (a folder cannot be moved into its own descendant)", async () => {
    // "Parent" folder dropped onto "Parent/Child": nodeIsAncestorOfTarget(path, space)
    // is true, so even a plain MOVE must PIN, never renamePath the folder into itself.
    const ss = makeSuperstate({
      paths: { Parent: { path: "Parent" } },
      spaces: {
        Parent: { path: "Parent", name: "Parent", type: "folder" },
        "Parent/Child": {
          path: "Parent/Child",
          name: "Child",
          type: "folder",
        },
      },
    });
    await dropPathInSpaceAtIndex(ss, "Parent", "RootSpace", "Parent/Child", 0, MOVE);
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.spacesIndex.get("Parent/Child"),
      "Parent",
      0
    );
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("REGRESSION LOCK — same-space reorder updates rank ONLY and NEVER removes (no orphaning)", async () => {
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Folder/a.md", "Folder", "Folder", 5, MOVE);
    expect(updatePathRankInSpace).toHaveBeenCalledTimes(1);
    expect(updatePathRankInSpace).toHaveBeenCalledWith(ss, "Folder/a.md", 5, "Folder");
    // The early return BEFORE the remove guard is the lock: a same-space drag
    // must never remove the path from its own space (that would orphan it).
    expect(removePathsFromSpace).not.toHaveBeenCalled();
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("REGRESSION LOCK — a null oldSpacePath (drag from a virtual/root context) moves but does NOT remove", async () => {
    // oldSpacePath falsy => the remove guard is skipped => no spurious removal.
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Other/b.md", null, "Folder", 0, MOVE);
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("drop onto a TAG space => addTagToPath(path, tag.NAME) and no folder mutators", async () => {
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Folder/a.md", null, "Tagged", 0, MOVE);
    expect(addTagToPath).toHaveBeenCalledTimes(1);
    // the NAME field is the tag, not the path
    expect(addTagToPath).toHaveBeenCalledWith(ss, "Folder/a.md", "mytag");
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("tag drop from a DIFFERENT old space still removes the old membership (cross-space cleanup applies to tags too)", async () => {
    const ss = folderWorld();
    await dropPathInSpaceAtIndex(ss, "Other/b.md", "Other", "Tagged", 0, MOVE);
    expect(addTagToPath).toHaveBeenCalledWith(ss, "Other/b.md", "mytag");
    expect(removePathsFromSpace).toHaveBeenCalledWith(ss, "Other", ["Other/b.md"]);
  });
});

// =========================================================================
// dropPathsInSpaceAtIndex — the multi-path commit core
// =========================================================================
describe("dropPathsInSpaceAtIndex — multi-path commit-core dispatch", () => {
  it("bails when the destination space is not indexed", async () => {
    const ss = folderWorld();
    await dropPathsInSpaceAtIndex(ss, ["Folder/a.md"], "Nope", 0, MOVE);
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
    expect(addTagToPath).not.toHaveBeenCalled();
  });

  it("MOVE => moves EACH path into the folder (copy=false), one call per path", async () => {
    const ss = folderWorld();
    await dropPathsInSpaceAtIndex(
      ss,
      ["Other/b.md", "Folder/a.md"],
      "Folder",
      1,
      MOVE
    );
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(2);
    expect(movePathToNewSpaceAtIndex).toHaveBeenNthCalledWith(
      1,
      ss,
      ss.pathsIndex.get("Other/b.md"),
      "Folder",
      1,
      false
    );
    expect(movePathToNewSpaceAtIndex).toHaveBeenNthCalledWith(
      2,
      ss,
      ss.pathsIndex.get("Folder/a.md"),
      "Folder",
      1,
      false
    );
    // NOTE: dropPathsInSpaceAtIndex has NO cross-space remove guard at all.
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("LINK => pins each path (copy semantics off the disk)", async () => {
    const ss = folderWorld();
    await dropPathsInSpaceAtIndex(ss, ["Other/b.md"], "Folder", 0, "link");
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.spacesIndex.get("Folder"),
      "Other/b.md",
      0
    );
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("a path that is an ANCESTOR of the destination is PINNED (not moved) even under MOVE", async () => {
    const ss = makeSuperstate({
      paths: { Parent: { path: "Parent" }, "Other/b.md": { path: "Other/b.md" } },
      spaces: {
        "Parent/Child": { path: "Parent/Child", name: "Child", type: "folder" },
      },
    });
    await dropPathsInSpaceAtIndex(
      ss,
      ["Parent", "Other/b.md"],
      "Parent/Child",
      0,
      MOVE
    );
    // 'Parent' is an ancestor of 'Parent/Child' => pin; 'Other/b.md' => move.
    expect(pinPathToSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.spacesIndex.get("Parent/Child"),
      "Parent",
      0
    );
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.pathsIndex.get("Other/b.md"),
      "Parent/Child",
      0,
      false
    );
  });

  it("TAG destination => addTagToPath for each path with the tag NAME", async () => {
    const ss = folderWorld();
    await dropPathsInSpaceAtIndex(ss, ["Folder/a.md", "Other/b.md"], "Tagged", 0, MOVE);
    expect(addTagToPath).toHaveBeenCalledTimes(2);
    expect(addTagToPath).toHaveBeenNthCalledWith(1, ss, "Folder/a.md", "mytag");
    expect(addTagToPath).toHaveBeenNthCalledWith(2, ss, "Other/b.md", "mytag");
  });
});

// =========================================================================
// dropPathInTree — single-path derivation (parentId / newSpace / newRank /
// active vs no-active / oldSpace) feeding the commit core
// =========================================================================
describe("dropPathInTree — derivation + dispatch (single path)", () => {
  it("does nothing when there is no projection", async () => {
    const ss = folderWorld();
    await dropPathInTree(ss, "Folder/a.md", "active", "over", null, [], [], MOVE);
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(updatePathRankInSpace).not.toHaveBeenCalled();
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("INSERT => parentId becomes `over`; newSpace = that node's item.path; commits the ACTIVE item's path", async () => {
    // Tree: a folder space 'Folder' (over=insert target) and the dragged file
    // currently under 'Other'. insert=true => parentId=over='Folder'.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
      // The active item's parentId is the id of the OLD-space node; oldSpace is
      // derived as clonedItems.find(id==active.parentId)?.item.path, so the old
      // space must exist as a node whose item.path == "Other".
      node({ id: "Other", type: "space", itemPath: "Other", rank: 1 }),
      node({
        id: "activeFile",
        type: "file",
        parentId: "Other",
        itemPath: "Other/b.md",
        rank: 7,
      }),
    ];
    const ss = folderWorld();
    const proj = projection({ insert: true, depth: 1, sortable: true });
    await dropPathInTree(
      ss,
      "ignored-path-arg",
      "activeFile",
      "Folder",
      proj,
      flattened,
      [],
      MOVE
    );
    // newSpace resolves to 'Folder'; oldSpace from active.parentId 'Other'.
    // newRank: parentId('Folder') != null, != overItem.id ('Folder' == over so
    // parentId==overItem.id => -1).
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledWith(
      ss,
      ss.pathsIndex.get("Other/b.md"),
      "Folder",
      -1, // parentId == overItem.id => rank -1
      false
    );
    // active.parentId 'Other' (a different space) => remove from old.
    expect(removePathsFromSpace).toHaveBeenCalledWith(ss, "Other", ["Other/b.md"]);
  });

  it("depth==0 && !insert => newSpace null => routes to reorderOpenSpace (top-level space reorder), no membership mutation", async () => {
    const flattened: TreeNode[] = [
      node({ id: "S1", type: "space", itemPath: "S1", rank: 0 }),
      node({ id: "S2", type: "space", itemPath: "S2", rank: 1 }),
    ];
    const ss = makeSuperstate({ paths: { S2: { path: "S2" } } });
    ss.focuses[0].paths = ["S1", "S2"];
    // active is the dragged top-level space; over=S1. depth 0, no insert => null space.
    const proj = projection({ depth: 0, insert: false, parentId: null, sortable: true });
    await dropPathInTree(ss, "S2", "S2", "S1", proj, flattened, [], MOVE);
    expect(ss.spaceManager.saveFocuses).toHaveBeenCalled();
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(updatePathRankInSpace).not.toHaveBeenCalled();
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("!active => commits the PATH ARG with a null oldSpace (no removal), using parentId from projection", async () => {
    // No active id (e.g. an external drop). parentId = projected.parentId='Folder'
    // (insert false). newSpace='Folder'. oldSpace forced null => move w/o remove.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
    ];
    const ss = folderWorld();
    const proj = projection({
      depth: 1,
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathInTree(
      ss,
      "Other/b.md",
      null as any, // no active
      "Folder",
      proj,
      flattened,
      [],
      MOVE
    );
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][1]).toBe(
      ss.pathsIndex.get("Other/b.md")
    );
    expect(movePathToNewSpaceAtIndex.mock.calls[0][2]).toBe("Folder");
    // oldSpace is null on the no-active path => never removes.
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("non-sortable projection passes the boolean `false` as the index (sortable && newRank short-circuits)", async () => {
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 9 }),
    ];
    const ss = folderWorld();
    const proj = projection({
      depth: 1,
      insert: false,
      parentId: "Folder",
      sortable: false, // => index handed down is `false`
    });
    await dropPathInTree(ss, "Other/b.md", null as any, "Folder", proj, flattened, [], MOVE);
    // index argument (4th positional) is the boolean false, not a rank number.
    expect(movePathToNewSpaceAtIndex.mock.calls[0][3]).toBe(false);
  });

  it("SAME-SPACE active reorder => updatePathRankInSpace ONLY, no remove (active.parent == resolved space)", async () => {
    // active file lives under 'Folder' and is reordered within 'Folder'.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
      node({
        id: "activeFile",
        type: "file",
        parentId: "Folder",
        itemPath: "Folder/a.md",
        rank: 2,
      }),
      node({
        id: "overFile",
        type: "file",
        parentId: "Folder",
        itemPath: "Folder/c.md",
        rank: 4,
      }),
    ];
    const ss = folderWorld();
    // parentId = projected.parentId='Folder' (insert false). newSpace='Folder'.
    // oldSpace = active.parentId 'Folder' => SAME SPACE => updatePathRankInSpace only.
    // newRank: parentId 'Folder' != null, != overItem.id ('overFile') => overItem.rank ?? -1 = 4.
    const proj = projection({
      depth: 1,
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathInTree(ss, "ignored", "activeFile", "overFile", proj, flattened, [], MOVE);
    expect(updatePathRankInSpace).toHaveBeenCalledTimes(1);
    expect(updatePathRankInSpace).toHaveBeenCalledWith(ss, "Folder/a.md", 4, "Folder");
    expect(removePathsFromSpace).not.toHaveBeenCalled();
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("active item at the ROOT (active.parentId == null) => oldSpace null => moves without removal", async () => {
    // The dragged active item is top-level (parentId null) being dropped INTO a
    // folder. oldSpace = (active.parentId == null) ? null : ... => null, so the
    // remove guard is skipped even though we changed spaces.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
      node({
        id: "activeFile",
        type: "file",
        parentId: null, // ROOT-level active item
        itemPath: "Other/b.md",
        rank: 2,
      }),
    ];
    const ss = folderWorld();
    const proj = projection({
      depth: 1,
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathInTree(ss, "ignored", "activeFile", "Folder", proj, flattened, [], MOVE);
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][1]).toBe(
      ss.pathsIndex.get("Other/b.md")
    );
    // oldSpace null => no removal (root-origin drag).
    expect(removePathsFromSpace).not.toHaveBeenCalled();
  });

  it("single-path newRank falls back to -1 when overItem.rank is null/undefined (`overItem.rank ?? -1`)", async () => {
    // parentId 'Folder' != null and != overItem.id; overItem.rank undefined => -1.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder" }),
      node({
        id: "overFile",
        type: "file",
        parentId: "Folder",
        itemPath: "Folder/a.md",
        noRank: true, // node.rank undefined => `overItem.rank ?? -1` => -1
      }),
    ];
    const ss = folderWorld();
    const proj = projection({
      depth: 1,
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    // no active => commits the path arg; index = sortable(true) && newRank(-1) = -1.
    await dropPathInTree(ss, "Other/b.md", null as any, "overFile", proj, flattened, [], MOVE);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][3]).toBe(-1);
  });

  it("newRank: parentId==null uses activeSpaces.findIndex(path == overItem.id)", async () => {
    // depth>0 but parentId resolves to null (insert with over not in tree) is
    // contrived; instead exercise the null-parent rank branch via the no-active
    // path where parentId is null AND newSpace is non-null is impossible (newSpace
    // needs a node). So pin the activeSpaces index read directly: parentId null +
    // newSpace null routes to reorderOpenSpace whose index is the activeSpaces idx.
    const flattened: TreeNode[] = [
      node({ id: "S2", type: "space", itemPath: "S2", rank: 0 }),
    ];
    const activeSpaces: PathState[] = [
      { path: "S0" } as PathState,
      { path: "S1" } as PathState,
      { path: "S2" } as PathState, // overItem.id == 'S2' => index 2
    ];
    const ss = makeSuperstate({ paths: { S2: { path: "S2" } } });
    ss.focuses[0].paths = ["S0", "S1", "S2"];
    const proj = projection({
      depth: 0,
      insert: false,
      parentId: null,
      sortable: true,
    });
    await dropPathInTree(ss, "S2", "S2", "S2", proj, flattened, activeSpaces, MOVE);
    // newSpace null => reorderOpenSpace(superstate, 'S2', index) where index =
    // sortable(true) && newRank(activeSpaces idx of 'S2' = 2) = 2. We assert the
    // waypoint save fired (open-space reorder ran) — the membership mutators stay quiet.
    expect(ss.spaceManager.saveFocuses).toHaveBeenCalled();
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(updatePathRankInSpace).not.toHaveBeenCalled();
  });
});

// =========================================================================
// dropPathsInTree — multi-path: delegation + ancestor guard + !newSpace bail
// =========================================================================
describe("dropPathsInTree — delegation, ancestor guard, newSpace bail", () => {
  it("a single-element paths array delegates to dropPathInTree", async () => {
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
    ];
    const ss = folderWorld();
    const proj = projection({
      depth: 1,
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathsInTree(
      ss,
      ["Other/b.md"],
      null as any,
      "Folder",
      proj,
      flattened,
      [],
      MOVE
    );
    // Delegated path => the single-path move fired.
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][2]).toBe("Folder");
  });

  it("REGRESSION LOCK — the ancestor-drop guard EXCLUDES a dragged path that is an ancestor of the target", async () => {
    // over a file 'Parent/Child/leaf.md' whose parent container is 'Parent/Child'.
    // Dragging ['Parent', 'Other/b.md']: 'Parent' is an ancestor of the drop
    // target 'Parent/Child' => filtered OUT; only 'Other/b.md' is committed.
    const flattened: TreeNode[] = [
      node({
        id: "containerNode",
        type: "space",
        parentId: null,
        itemPath: "Parent/Child",
        rank: 0,
      }),
      node({
        id: "overFile",
        type: "file",
        depth: 1, // depth>0 so dropTarget resolves to the parent container
        parentId: "containerNode",
        itemPath: "Parent/Child/leaf.md",
        rank: 3,
      }),
    ];
    const ss = makeSuperstate({
      paths: {
        Parent: { path: "Parent" },
        "Other/b.md": { path: "Other/b.md" },
      },
      spaces: {
        "Parent/Child": { path: "Parent/Child", name: "Child", type: "folder" },
      },
    });
    // parentId = projected.parentId = 'containerNode'; newSpace = node's item.path
    // = 'Parent/Child'. droppable filters out 'Parent' (ancestor of 'Parent/Child').
    const proj = projection({
      insert: false,
      parentId: "containerNode",
      sortable: false,
    });
    await dropPathsInTree(
      ss,
      ["Parent", "Other/b.md"],
      null as any,
      "overFile",
      proj,
      flattened,
      [],
      MOVE
    );
    // ONLY the non-ancestor path is committed. 'Parent' is silently excluded.
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(1);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][1]).toBe(
      ss.pathsIndex.get("Other/b.md")
    );
    // Prove 'Parent' was never the subject of a mutation.
    const movedItems = movePathToNewSpaceAtIndex.mock.calls.map((c: any[]) => c[1]);
    expect(movedItems).not.toContain(ss.pathsIndex.get("Parent"));
    const pinnedPaths = pinPathToSpaceAtIndex.mock.calls.map((c: any[]) => c[2]);
    expect(pinnedPaths).not.toContain("Parent");
  });

  it("newRank is -1 when parentId == overItem.id (dropping a multi-selection directly onto the hovered container)", async () => {
    // over a non-file container 'Folder'; parentId = projected.parentId = 'Folder'
    // == overItem.id => newRank -1 (append/top), not overItem.rank.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 99 }),
    ];
    const ss = folderWorld();
    const proj = projection({
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathsInTree(
      ss,
      ["Other/b.md", "Folder/a.md"],
      null as any,
      "Folder", // over == the container, so parentId == overItem.id
      proj,
      flattened,
      [],
      MOVE
    );
    // index handed down = sortable(true) && newRank(-1) = -1.
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(2);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][3]).toBe(-1);
  });

  it("CHARACTERIZATION (latent crash, Notidian follow-up) — a multi-drag over a ROOT-level file THROWS: dropTarget is null and `(dropTarget as SpaceState).path` is unguarded", async () => {
    // overItem is a depth-0 file => dropTarget = null (the `overItem.depth == 0 ?
    // null` leg). Unlike the single-path path, dropPathsInTree reads
    // `(dropTarget as SpaceState).path` WITHOUT a null guard, so the ancestor
    // filter throws. We pin the current (buggy) behavior so a future null-guard
    // fix flips this test deliberately. Tracked as a follow-up bead.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
      node({
        id: "rootFile",
        type: "file",
        depth: 0, // depth-0 file => dropTarget null
        parentId: null,
        itemPath: "rootFile.md",
        rank: 0,
      }),
    ];
    const ss = folderWorld();
    const proj = projection({
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await expect(
      dropPathsInTree(
        ss,
        ["Other/b.md", "Folder/a.md"],
        null as any,
        "rootFile",
        proj,
        flattened,
        [],
        MOVE
      )
    ).rejects.toThrow(TypeError);
    // No commit happened — the throw aborted before any mutator fired.
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
  });

  it("multi-drag with INSERT => parentId = `over` (the collapsed container itself), not projected.parentId", async () => {
    // insert true => parentId = over = 'Folder'; newSpace = 'Folder'.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
    ];
    const ss = folderWorld();
    const proj = projection({
      insert: true,
      parentId: "DIFFERENT_ignored",
      sortable: true,
    });
    await dropPathsInTree(
      ss,
      ["Other/b.md", "Folder/a.md"],
      null as any,
      "Folder",
      proj,
      flattened,
      [],
      MOVE
    );
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(2);
    // committed into 'Folder' (parentId resolved from `over`, not projected.parentId).
    expect(movePathToNewSpaceAtIndex.mock.calls[0][2]).toBe("Folder");
  });

  it("newRank falls back to -1 when overItem.rank is null/undefined (the `?? -1` leg)", async () => {
    // parentId != overItem.id and overItem.rank is undefined => newRank = -1.
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder" }),
      node({
        id: "overFile",
        type: "file",
        depth: 1,
        parentId: "Folder",
        itemPath: "Folder/a.md",
        noRank: true, // node.rank undefined => `overItem.rank ?? -1` => -1
      }),
    ];
    const ss = folderWorld();
    const proj = projection({
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathsInTree(
      ss,
      ["Other/b.md", "Folder/a.md"],
      null as any,
      "overFile",
      proj,
      flattened,
      [],
      MOVE
    );
    expect(movePathToNewSpaceAtIndex.mock.calls[0][3]).toBe(-1);
  });

  it("!newSpace => BAILS entirely (no mutation) when parentId resolves to no node", async () => {
    const flattened: TreeNode[] = [
      node({ id: "overSpace", type: "space", itemPath: "overSpace", rank: 0 }),
    ];
    const ss = folderWorld();
    // parentId = projected.parentId='no-such-node' => find() undefined => newSpace
    // undefined => bail.
    const proj = projection({
      insert: false,
      parentId: "no-such-node",
      sortable: false,
    });
    await dropPathsInTree(
      ss,
      ["Folder/a.md", "Other/b.md"],
      null as any,
      "overSpace",
      proj,
      flattened,
      [],
      MOVE
    );
    expect(movePathToNewSpaceAtIndex).not.toHaveBeenCalled();
    expect(pinPathToSpaceAtIndex).not.toHaveBeenCalled();
    expect(addTagToPath).not.toHaveBeenCalled();
  });

  it("multi-path MOVE into a folder => moves every (non-ancestor) path into the resolved space", async () => {
    const flattened: TreeNode[] = [
      node({ id: "Folder", type: "space", itemPath: "Folder", rank: 0 }),
      node({
        id: "overFile",
        type: "file",
        depth: 1, // depth>0 so dropTarget resolves to the parent container 'Folder'
        parentId: "Folder",
        itemPath: "Folder/a.md",
        rank: 5,
      }),
    ];
    const ss = folderWorld();
    // over a file => dropTarget is its parent container 'Folder'. parentId =
    // projected.parentId='Folder'; newSpace='Folder'; newRank = overItem.rank 5.
    const proj = projection({
      insert: false,
      parentId: "Folder",
      sortable: true,
    });
    await dropPathsInTree(
      ss,
      ["Other/b.md", "Folder/a.md"],
      null as any,
      "overFile",
      proj,
      flattened,
      [],
      MOVE
    );
    // Both paths committed (neither is an ancestor of 'Folder'); index = newRank 5.
    expect(movePathToNewSpaceAtIndex).toHaveBeenCalledTimes(2);
    expect(movePathToNewSpaceAtIndex.mock.calls[0][3]).toBe(5);
  });
});

// =========================================================================
// reorderOpenSpace — the waypoint (open-space) reorder used when newSpace null
// =========================================================================
describe("reorderOpenSpace — waypoint path ordering", () => {
  it("moves the path within the current waypoint and persists via saveFocuses", () => {
    const ss = makeSuperstate();
    ss.focuses[0].paths = ["a", "b", "c"];
    reorderOpenSpace(ss, "a", 2);
    expect(ss.spaceManager.saveFocuses).toHaveBeenCalled();
    const saved = ss.spaceManager.saveFocuses.mock.calls.at(-1)[0];
    const wp = saved[ss.settings.currentWaypoint];
    // 'a' moved toward index 2 within [a,b,c].
    expect(wp.paths).toContain("a");
    expect(wp.paths.length).toBe(3);
    expect(new Set(wp.paths)).toEqual(new Set(["a", "b", "c"]));
  });

  it("appends a fresh default waypoint when currentWaypoint points past the end (the `?? default` + append branch)", () => {
    const ss = makeSuperstate();
    // currentWaypoint index is out of range => focuses[idx] is undefined => the
    // `?? default` waypoint is used, and `currentWaypoint > focuses.length` is
    // true => the first saveFocuses appends the new waypoint.
    ss.settings.currentWaypoint = 5;
    reorderOpenSpace(ss, "z", 0);
    // Two saveFocuses calls: the append, then the mapped persist.
    expect(ss.spaceManager.saveFocuses.mock.calls.length).toBeGreaterThanOrEqual(2);
    const appended = ss.spaceManager.saveFocuses.mock.calls[0][0];
    // The appended array is the original focuses plus the new default waypoint.
    expect(appended.length).toBe(ss.focuses.length + 1);
    // CHARACTERIZATION: the default waypoint starts with empty paths, so the
    // path being reordered is not found (findIndex -1) and arrayMove([], -1, 0)
    // yields [undefined]. We pin this real shape (rather than asserting "z" is
    // present) so a future change to the out-of-range/default-waypoint handling
    // is caught — today the dragged path is NOT carried into the fresh waypoint.
    expect(appended.at(-1).paths).toEqual([undefined]);
  });
});
