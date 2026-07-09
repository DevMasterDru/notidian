import { filterTreeByQuery } from "core/superstate/utils/spaces";
import { PathState } from "shared/types/PathState";
import { Superstate } from "makemd-core";

// ===========================================================================
// DEPTH (Notidian-nrjb) -- pure characterization/property net for the vault
// file-tree text filter's SOLE offline-verifiable seam, filterTreeByQuery
// (src/core/superstate/utils/spaces.ts). This is the flag-gated core
// render-path bead's PURE half: it reads only superstate.pathsIndex /
// spacesIndex (plain in-memory Maps -- no spaceManager I/O, no DOM, no React),
// so the whole matching + ancestor-inclusion + depth/type/childrenCount
// algorithm is locked here without any UI harness. The MainList /
// SpaceTreeView wiring (settings.enableNavigatorTextFilter kill-switch +
// render) is NOT re-asserted by a render test here -- it is covered by the
// deploy-and-live-verify contract (ADR 0051) per the bead's own scope.
//
// Fixture vault shape (a single view root "/"):
//   /                                   (space, root)
//   /Projects                           (space)
//   /Projects/Notidian                  (space)
//   /Projects/Notidian/Alpha.md         (file, label "Alpha")
//   /Projects/Notidian/Beta.md          (file, label "Beta")
//   /SecretZone                         (space, label "SecretZone")
//   /SecretZone/Report.md               (file, label "Report" -- name does NOT
//                                         contain "secret"; only its full path
//                                         does, isolating the PATH-match branch)
//   /Archive                            (space, HIDDEN)
//   /Archive/Old.md                     (file, HIDDEN -- mirrors the real
//                                         cascaded-hidden invariant: a hidden
//                                         folder's children are hidden too,
//                                         upstream in cacheParsers.ts)
// ===========================================================================

const makePathState = (over: Partial<PathState> = {}): PathState =>
  ({
    path: "unset",
    name: "unset",
    parent: "",
    label: { name: "unset", sticker: "", color: "" },
    readOnly: false,
    hidden: false,
    ...over,
  } as PathState);

const FIXTURE: Record<string, PathState> = {
  "/": makePathState({ path: "/", name: "vault", parent: "", label: { name: "Vault", sticker: "", color: "" } }),
  Projects: makePathState({ path: "Projects", name: "Projects", parent: "/", label: { name: "Projects", sticker: "", color: "" } }),
  "Projects/Notidian": makePathState({ path: "Projects/Notidian", name: "Notidian", parent: "Projects", label: { name: "Notidian", sticker: "", color: "" } }),
  "Projects/Notidian/Alpha.md": makePathState({ path: "Projects/Notidian/Alpha.md", name: "Alpha.md", parent: "Projects/Notidian", label: { name: "Alpha", sticker: "", color: "" } }),
  "Projects/Notidian/Beta.md": makePathState({ path: "Projects/Notidian/Beta.md", name: "Beta.md", parent: "Projects/Notidian", label: { name: "Beta", sticker: "", color: "" } }),
  SecretZone: makePathState({ path: "SecretZone", name: "SecretZone", parent: "/", label: { name: "SecretZone", sticker: "", color: "" } }),
  "SecretZone/Report.md": makePathState({ path: "SecretZone/Report.md", name: "Report.md", parent: "SecretZone", label: { name: "Report", sticker: "", color: "" } }),
  Archive: makePathState({ path: "Archive", name: "Archive", parent: "/", hidden: true, label: { name: "Archive", sticker: "", color: "" } }),
  "Archive/Old.md": makePathState({ path: "Archive/Old.md", name: "Old.md", parent: "Archive", hidden: true, label: { name: "Old", sticker: "", color: "" } }),
};

const SPACE_PATHS = ["/", "Projects", "Projects/Notidian", "SecretZone", "Archive"];

const makeSuperstate = (
  entries: Record<string, PathState> = FIXTURE,
  spacePaths: string[] = SPACE_PATHS
) =>
  ({
    pathsIndex: new Map(Object.entries(entries)),
    spacesIndex: new Map(spacePaths.map((p) => [p, {} as any])),
  } as unknown as Superstate);

const rootSpaces = (entries: Record<string, PathState> = FIXTURE): PathState[] => [
  entries["/"],
];

const pathsOf = (nodes: ReturnType<typeof filterTreeByQuery>) =>
  nodes.map((n) => n.path).sort();

describe("filterTreeByQuery (Notidian-nrjb)", () => {
  it("matches by display NAME, case-insensitively, and force-includes every ancestor up to the view root", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "alpha");

    expect(pathsOf(result)).toEqual(
      ["/", "Projects", "Projects/Notidian", "Projects/Notidian/Alpha.md"].sort()
    );
    // Sibling that does not match is excluded, and is NOT force-included just
    // because it shares a matched parent.
    expect(pathsOf(result)).not.toContain("Projects/Notidian/Beta.md");
  });

  it("is case-insensitive on the query", () => {
    const lower = pathsOf(filterTreeByQuery(makeSuperstate(), rootSpaces(), "alpha"));
    const upper = pathsOf(filterTreeByQuery(makeSuperstate(), rootSpaces(), "ALPHA"));
    const mixed = pathsOf(filterTreeByQuery(makeSuperstate(), rootSpaces(), "AlPhA"));
    expect(upper).toEqual(lower);
    expect(mixed).toEqual(lower);
  });

  it("matches by full PATH when the leaf's own display name does not contain the query", () => {
    // "Report" (the display name) does not contain "secret" -- only the full
    // path "SecretZone/Report.md" does, via its parent folder's name.
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "secret");

    expect(pathsOf(result)).toEqual(["/", "SecretZone", "SecretZone/Report.md"].sort());
  });

  it("empty query is a passthrough: every non-hidden path is returned, unfiltered", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "");
    const nonHidden = Object.values(FIXTURE).filter((f) => !f.hidden);
    expect(pathsOf(result)).toEqual(nonHidden.map((f) => f.path).sort());
  });

  it("a whitespace-only query is also treated as empty (trimmed before matching)", () => {
    const blank = pathsOf(filterTreeByQuery(makeSuperstate(), rootSpaces(), "   "));
    const empty = pathsOf(filterTreeByQuery(makeSuperstate(), rootSpaces(), ""));
    expect(blank).toEqual(empty);
  });

  it("a query matching nothing returns an empty array", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "zzz-nonexistent-token");
    expect(result).toEqual([]);
  });

  it("hidden paths never match and are never force-included as ancestors", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "archive");
    expect(result).toEqual([]);
    const oldResult = filterTreeByQuery(makeSuperstate(), rootSpaces(), "old");
    expect(oldResult).toEqual([]);
  });

  it("hidden paths are excluded even from the empty-query passthrough", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "");
    expect(pathsOf(result)).not.toContain("Archive");
    expect(pathsOf(result)).not.toContain("Archive/Old.md");
  });

  it("assigns depth 0 / parentId null to the view root, and increasing depth down the ancestor chain", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "alpha");
    const byPath = new Map(result.map((n) => [n.path, n]));

    expect(byPath.get("/").depth).toBe(0);
    expect(byPath.get("/").parentId).toBeNull();
    expect(byPath.get("Projects").depth).toBe(1);
    expect(byPath.get("Projects").parentId).toBe("/");
    expect(byPath.get("Projects/Notidian").depth).toBe(2);
    expect(byPath.get("Projects/Notidian").parentId).toBe("Projects");
    expect(byPath.get("Projects/Notidian/Alpha.md").depth).toBe(3);
    expect(byPath.get("Projects/Notidian/Alpha.md").parentId).toBe("Projects/Notidian");
  });

  it("orders ancestors before their descendants", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "alpha");
    const indexOf = (p: string) => result.findIndex((n) => n.path === p);
    expect(indexOf("/")).toBeLessThan(indexOf("Projects"));
    expect(indexOf("Projects")).toBeLessThan(indexOf("Projects/Notidian"));
    expect(indexOf("Projects/Notidian")).toBeLessThan(
      indexOf("Projects/Notidian/Alpha.md")
    );
  });

  // ---------------------------------------------------------------------------
  // SUBTREE CONTIGUITY / mis-parenting regression (review catch, Notidian-nrjb):
  // The depth-indented flat renderer (SpaceTreeItem indents purely by `depth`;
  // VirtualizedList draws in array order) reads nesting SOLELY from `depth` +
  // position, so the flattened output must be strict DFS pre-order -- every
  // subtree CONTIGUOUS. A plain lexical string sort does NOT guarantee this: a
  // sibling FILE whose name extends a sibling FOLDER's name with a separator
  // that sorts before '/' (0x2F) -- a space (0x20), '-' (0x2D), '.' (0x2E) --
  // sorts BETWEEN the folder and the folder's own descendants, so the deeper
  // descendant renders one level below that FILE and appears mis-parented under
  // it. (Verified: ["/","Projects","Projects Overview.md","Projects/Sub",
  // "Projects/Sub/match.md"] is the lexical order.)
  // ---------------------------------------------------------------------------
  it("emits strict DFS pre-order: a sibling file whose name extends a folder name never breaks subtree contiguity", () => {
    const entries: Record<string, PathState> = {
      "/": makePathState({ path: "/", name: "vault", parent: "", label: { name: "Vault", sticker: "", color: "" } }),
      Projects: makePathState({ path: "Projects", name: "Projects", parent: "/", label: { name: "Projects", sticker: "", color: "" } }),
      // Sibling FILE at the SAME level as the folder, whose name extends the
      // folder name with a space (0x20 < 0x2F) -- the exact interleaving trigger.
      "Projects Overview.md": makePathState({ path: "Projects Overview.md", name: "Projects Overview.md", parent: "/", label: { name: "Projects Overview", sticker: "", color: "" } }),
      "Projects/Sub": makePathState({ path: "Projects/Sub", name: "Sub", parent: "Projects", label: { name: "Sub", sticker: "", color: "" } }),
      "Projects/Sub/match.md": makePathState({ path: "Projects/Sub/match.md", name: "match.md", parent: "Projects/Sub", label: { name: "match", sticker: "", color: "" } }),
    };
    const superstate = makeSuperstate(entries, ["/", "Projects", "Projects/Sub"]);
    const result = filterTreeByQuery(superstate, [entries["/"]], "pro");

    // Nothing is dropped -- the whole matched set (plus the '/' ancestor) renders.
    expect(pathsOf(result)).toEqual(
      ["/", "Projects", "Projects Overview.md", "Projects/Sub", "Projects/Sub/match.md"].sort()
    );

    // Depth-indented-tree invariant: whenever the row directly above a node is
    // EXACTLY one level shallower, it MUST be that node's rendered parent --
    // otherwise the node visually nests under the wrong row. The lexical sort
    // violates this (Projects/Sub@depth2 follows Projects Overview.md@depth1,
    // which is not its parent); strict DFS pre-order satisfies it for every row.
    for (let i = 1; i < result.length; i++) {
      const node = result[i];
      const prev = result[i - 1];
      if (node.parentId != null && prev.depth === node.depth - 1) {
        expect(prev.path).toBe(node.parentId);
      }
    }

    // The entire "Projects" subtree is contiguous; the sibling file sorts AFTER
    // it, never interleaved inside it.
    const idx = (p: string) => result.findIndex((n) => n.path === p);
    expect(idx("Projects")).toBeLessThan(idx("Projects/Sub"));
    expect(idx("Projects/Sub")).toBeLessThan(idx("Projects/Sub/match.md"));
    expect(idx("Projects/Sub/match.md")).toBeLessThan(idx("Projects Overview.md"));
  });

  it("types every depth-0 result as a 'group' root section, nested folders as 'space', and leaves as 'file'", () => {
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), "alpha");
    const byPath = new Map(result.map((n) => [n.path, n]));

    expect(byPath.get("/").type).toBe("group");
    expect(byPath.get("Projects").type).toBe("space");
    expect(byPath.get("Projects/Notidian").type).toBe("space");
    expect(byPath.get("Projects/Notidian/Alpha.md").type).toBe("file");
  });

  it("childrenCount reflects only the INCLUDED (filtered) children, not the real total", () => {
    // Only Alpha.md matches, so Notidian's childrenCount is 1 even though it
    // really has two children (Alpha.md, Beta.md) in the fixture.
    const filtered = filterTreeByQuery(makeSuperstate(), rootSpaces(), "alpha");
    const filteredParent = filtered.find((n) => n.path === "Projects/Notidian");
    expect(filteredParent.childrenCount).toBe(1);

    // Both children match a shared substring -> childrenCount reflects both.
    const both = filterTreeByQuery(makeSuperstate(), rootSpaces(), ".md");
    const bothParent = both.find((n) => n.path === "Projects/Notidian");
    expect(bothParent.childrenCount).toBe(2);
  });

  it("dedupes a shared ancestor when multiple matches converge on it", () => {
    // ".md" matches every file, so Alpha.md AND Beta.md both force-include
    // Projects/Notidian as an ancestor -- it must appear exactly once.
    const result = filterTreeByQuery(makeSuperstate(), rootSpaces(), ".md");
    const occurrences = result.filter((n) => n.path === "Projects/Notidian");
    expect(occurrences.length).toBe(1);
  });

  it("is defensive against a cyclic PathState.parent chain (never hangs, never throws)", () => {
    const cyclicEntries: Record<string, PathState> = {
      ...FIXTURE,
      LoopA: makePathState({ path: "LoopA", name: "LoopA-alpha", parent: "LoopB", label: { name: "LoopA-alpha", sticker: "", color: "" } }),
      LoopB: makePathState({ path: "LoopB", name: "LoopB", parent: "LoopA", label: { name: "LoopB", sticker: "", color: "" } }),
    };
    const superstate = makeSuperstate(cyclicEntries, [...SPACE_PATHS, "LoopA", "LoopB"]);

    let result: ReturnType<typeof filterTreeByQuery>;
    expect(() => {
      result = filterTreeByQuery(superstate, rootSpaces(cyclicEntries), "loopa");
    }).not.toThrow();
    expect(pathsOf(result)).toEqual(["LoopA", "LoopB"]);
  });

  it("a match whose ancestor chain never reaches a view root still renders, as its own depth-0 result", () => {
    // No activeViewSpaces at all (an empty focus) -- Alpha.md's ancestor walk
    // climbs all the way to "/" (a dead end, since "/" has no parent), and "/"
    // itself becomes the depth-0 top of this result set.
    const result = filterTreeByQuery(makeSuperstate(), [], "alpha");
    expect(pathsOf(result)).toEqual(
      ["/", "Projects", "Projects/Notidian", "Projects/Notidian/Alpha.md"].sort()
    );
    const byPath = new Map(result.map((n) => [n.path, n]));
    expect(byPath.get("/").depth).toBe(0);
    expect(byPath.get("/").type).toBe("group");
  });

  it("null/undefined activeViewSpaces entries are tolerated", () => {
    expect(() =>
      filterTreeByQuery(makeSuperstate(), [null, undefined, FIXTURE["/"]] as any, "alpha")
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // GHOST ANCESTOR regression (found by live-verify, ADR 0051): a real vault's
  // tag-space paths (e.g. "spaces://#alpha") carry `.parent = "spaces:/"`, a
  // synthetic container string with NO PathState entry of its own. Emitting a
  // TreeNode with no `item` for such a "ghost" crashed the navigator's
  // ErrorBoundary the instant a query matched a tag name (SpaceTreeItem reads
  // `data.item.path` unconditionally). Every path here mirrors that exact
  // shape: matches, but its `.parent` string resolves to nothing in pathsIndex.
  // ---------------------------------------------------------------------------
  it("never emits a node for a ghost ancestor (a .parent string with no pathsIndex entry) and does not throw", () => {
    const ghostEntries: Record<string, PathState> = {
      ...FIXTURE,
      "spaces://#alpha": makePathState({
        path: "spaces://#alpha",
        name: "#alpha",
        parent: "spaces:/", // NOT a key of pathsIndex -- the ghost
        label: { name: "#alpha", sticker: "", color: "" },
      }),
    };
    const superstate = makeSuperstate(ghostEntries, [...SPACE_PATHS, "spaces://#alpha"]);

    let result: ReturnType<typeof filterTreeByQuery>;
    expect(() => {
      result = filterTreeByQuery(superstate, rootSpaces(ghostEntries), "alpha");
    }).not.toThrow();

    // The match itself renders...
    const tagNode = result.find((n) => n.path === "spaces://#alpha");
    expect(tagNode).toBeDefined();
    expect(tagNode.item).toBeDefined();
    expect(tagNode.item.path).toBe("spaces://#alpha");
    // ...the ghost "spaces:/" is never itself emitted as a node...
    expect(result.some((n) => n.path === "spaces:/")).toBe(false);
    // ...and since its only parent is unrenderable, it surfaces as its own
    // depth-0 root section rather than a dangling indented orphan.
    expect(tagNode.depth).toBe(0);
    expect(tagNode.parentId).toBeNull();
    expect(tagNode.type).toBe("group");

    // The unrelated real match (Alpha.md) and its real ancestor chain are
    // unaffected by the ghost sharing the same query.
    expect(pathsOf(result)).toEqual(
      ["/", "Projects", "Projects/Notidian", "Projects/Notidian/Alpha.md", "spaces://#alpha"].sort()
    );
  });

  // ---------------------------------------------------------------------------
  // HIDDEN ANCESTOR regression (review catch, Notidian-nrjb): PathState.hidden
  // is computed PER-PATH by excludePathPredicate (src/utils/hide.ts) -- it does
  // NOT cascade from a hidden folder down to its children in the indexer. The
  // FIXTURE above (Archive/Archive-Old.md) only exercises the case where hidden
  // happens to cascade perfectly; this fixture instead mirrors the real gap: a
  // hidden folder whose child is NOT itself hidden (exactly what happens when,
  // e.g., a real top-level folder's bare name collides with settings'
  // spaceSubFolder / hiddenExtensions value -- excludePathPredicate hides that
  // folder, but a per-path check never marks its children hidden too).
  // ---------------------------------------------------------------------------
  it("never force-includes/renders a HIDDEN ancestor, even when a non-hidden descendant matches (hidden does not cascade); the match re-parents to the nearest renderable ancestor", () => {
    const hiddenAncestorEntries: Record<string, PathState> = {
      "/": makePathState({ path: "/", name: "vault", parent: "", label: { name: "Vault", sticker: "", color: "" } }),
      HiddenFolder: makePathState({
        path: "HiddenFolder",
        name: "HiddenFolder",
        parent: "/",
        hidden: true,
        label: { name: "HiddenFolder", sticker: "", color: "" },
      }),
      "HiddenFolder/Visible.md": makePathState({
        path: "HiddenFolder/Visible.md",
        name: "Visible.md",
        parent: "HiddenFolder",
        hidden: false, // NOT hidden itself -- hidden does not cascade from parent.
        label: { name: "Visible", sticker: "", color: "" },
      }),
    };
    const superstate = makeSuperstate(hiddenAncestorEntries, ["/", "HiddenFolder"]);

    const result = filterTreeByQuery(
      superstate,
      [hiddenAncestorEntries["/"]],
      "visible"
    );

    // The non-hidden descendant still matches and renders...
    const fileNode = result.find((n) => n.path === "HiddenFolder/Visible.md");
    expect(fileNode).toBeDefined();
    expect(fileNode.item).toBeDefined();
    // ...but the HIDDEN ancestor is never emitted as a node -- no name,
    // sticker, path, or "group"/"space" row leaks it into the filtered tree.
    expect(result.some((n) => n.path === "HiddenFolder")).toBe(false);
    // The real, visible grandparent "/" (the view root) IS reachable past the
    // hidden hop -- step 2's inclusion walk already put it in includedPaths,
    // so the match re-parents to it instead of surfacing as a disconnected
    // top-level "group": depth/parentId/type all attribute to "/", and "/"'s
    // own childrenCount reflects the re-parented match.
    expect(fileNode.depth).toBe(1);
    expect(fileNode.parentId).toBe("/");
    expect(fileNode.type).toBe("file");
    const rootNode = result.find((n) => n.path === "/");
    expect(rootNode).toBeDefined();
    expect(rootNode.childrenCount).toBe(1);
  });

  it("walks past a CHAIN of hidden ancestors to re-parent onto the nearest renderable one", () => {
    const chainEntries: Record<string, PathState> = {
      "/": makePathState({ path: "/", name: "vault", parent: "", label: { name: "Vault", sticker: "", color: "" } }),
      HiddenOuter: makePathState({
        path: "HiddenOuter",
        name: "HiddenOuter",
        parent: "/",
        hidden: true,
        label: { name: "HiddenOuter", sticker: "", color: "" },
      }),
      "HiddenOuter/HiddenInner": makePathState({
        path: "HiddenOuter/HiddenInner",
        name: "HiddenInner",
        parent: "HiddenOuter",
        hidden: true,
        label: { name: "HiddenInner", sticker: "", color: "" },
      }),
      "HiddenOuter/HiddenInner/Visible.md": makePathState({
        path: "HiddenOuter/HiddenInner/Visible.md",
        name: "Visible.md",
        parent: "HiddenOuter/HiddenInner",
        hidden: false,
        label: { name: "Visible", sticker: "", color: "" },
      }),
    };
    const superstate = makeSuperstate(chainEntries, ["/", "HiddenOuter", "HiddenOuter/HiddenInner"]);

    const result = filterTreeByQuery(superstate, [chainEntries["/"]], "visible");

    expect(result.some((n) => n.path === "HiddenOuter")).toBe(false);
    expect(result.some((n) => n.path === "HiddenOuter/HiddenInner")).toBe(false);
    const fileNode = result.find((n) => n.path === "HiddenOuter/HiddenInner/Visible.md");
    expect(fileNode).toBeDefined();
    expect(fileNode.depth).toBe(1);
    expect(fileNode.parentId).toBe("/");
  });

  it("the empty-query passthrough also excludes a hidden folder while still surfacing its non-hidden children", () => {
    const hiddenAncestorEntries: Record<string, PathState> = {
      "/": makePathState({ path: "/", name: "vault", parent: "", label: { name: "Vault", sticker: "", color: "" } }),
      HiddenFolder: makePathState({
        path: "HiddenFolder",
        name: "HiddenFolder",
        parent: "/",
        hidden: true,
        label: { name: "HiddenFolder", sticker: "", color: "" },
      }),
      "HiddenFolder/Visible.md": makePathState({
        path: "HiddenFolder/Visible.md",
        name: "Visible.md",
        parent: "HiddenFolder",
        hidden: false,
        label: { name: "Visible", sticker: "", color: "" },
      }),
    };
    const superstate = makeSuperstate(hiddenAncestorEntries, ["/", "HiddenFolder"]);

    const result = filterTreeByQuery(superstate, [hiddenAncestorEntries["/"]], "");

    expect(pathsOf(result)).not.toContain("HiddenFolder");
    expect(pathsOf(result)).toContain("HiddenFolder/Visible.md");
  });

  it("every emitted node has a defined item (SpaceTreeItem reads data.item.path unconditionally)", () => {
    const ghostEntries: Record<string, PathState> = {
      ...FIXTURE,
      "spaces://#alpha": makePathState({
        path: "spaces://#alpha",
        name: "#alpha",
        parent: "spaces:/",
        label: { name: "#alpha", sticker: "", color: "" },
      }),
    };
    const superstate = makeSuperstate(ghostEntries, [...SPACE_PATHS, "spaces://#alpha"]);
    const result = filterTreeByQuery(superstate, rootSpaces(ghostEntries), "");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((n) => n.item !== undefined && n.item.path === n.path)).toBe(true);
  });
});
