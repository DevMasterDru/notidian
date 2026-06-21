// ===========================================================================
// DEPTH (Notidian-3dpn) — OFFLINE coverage for the getAllSubtags / renameTag
// CASE-FOLD SEAM, via a FAKE superstate built from recording `jest.fn` spies.
//
// COMPANION to the Notidian-ehfz fix (src/utils/tags.ts). The pure-helper
// suite (Notidian-blkq, src/utils/tags.test.ts) DELIBERATELY EXCLUDED
// getAllSubtags + renameTag because both dereference a LIVE superstate
// (spaceManager.readTags / pathsForTag / renameTag / renamePath / pathExists,
// plus renameTagSpacePath). The ehfz commit (d4436cc) then added an in-file
// case-fold suite driven by a plain-closure recorder. This audit file is the
// CHARACTERIZATION LOCK that the in-file suite does not provide:
//
//   * it drives the seam with explicit `jest.fn()` spies (the bead's named
//     contract — "recording jest.fn spies"), so spy call-args/order are
//     asserted with jest matchers, not hand-rolled arrays;
//   * it pins the DIVISION OF LABOUR the fold relies on: getAllSubtags itself
//     does NOT fold its argument (raw case-sensitive prefix — the Notidian-23bl
//     locked contract); folding is the CALLER's job (renameTag). This is the
//     exact seam ehfz repaired — if getAllSubtags ever silently started
//     folding, the renameTag fold would become a redundant no-op and the
//     "where is normalization owned?" contract would rot unnoticed; and
//   * it exercises the renameTagSpacePath ELSE branch (pathExists === false ->
//     deletePath + onPathDeleted), which the in-file ehfz suite never reaches
//     (it hard-codes pathExists -> true). renameTagSpacePath's deps
//     (folderForTagSpace / pathToParentPath are pure; pathExists / renamePath /
//     deletePath / onTagRenamed / onPathDeleted are the superstate surface) are
//     all stubbed as recording spies so BOTH branches are observable.
//
// PURE jest, node env (jest.config testEnvironment: "node"), NO jsdom: the
// recursion is fully driven in-process against a plain-object Superstate. The
// `Superstate` import is TYPE-ONLY (erased at compile time); the only runtime
// reach is the spaceManager methods we spy on, exactly as the established
// `as unknown as Superstate` pattern (cf. src/utils/tags.test.ts).
//
// CHARACTERIZATION, not correction: every asserted value is the OBSERVED
// behaviour of the post-ehfz implementation, LOCKED so the case-fold seam
// cannot silently regress.
// ===========================================================================

import { getAllSubtags, renameTag } from "utils/tags";
import { Superstate } from "makemd-core";

// ---------------------------------------------------------------------------
// SEAM 1 — getAllSubtags does NOT fold its argument. The fold is the CALLER's
// responsibility (renameTag folds, then passes the folded form here). readTags()
// returns the LOWERCASED vault fold (loadTags -> ...map(toLowerCase)), so a
// MIXED-CASE argument to getAllSubtags matches NOTHING — proving exactly why
// renameTag must fold first. The boundary slash (Notidian-23bl) is preserved
// throughout: textual-prefix siblings ('#foobar') are never captured.
// ---------------------------------------------------------------------------
const readTagsSuperstate = (tags: string[]): Superstate =>
  ({
    spaceManager: {
      // jest.fn so the read can be asserted as having actually been consulted.
      readTags: jest.fn(() => tags),
    },
  } as unknown as Superstate);

describe("getAllSubtags — the fold is the CALLER's job, not getAllSubtags's (Notidian-3dpn)", () => {
  it("a MIXED-CASE arg ('#Foo') matches NOTHING against the lowercased readTags() fold — caller must fold first", () => {
    // readTags() is the lowercased fold; '#Foo/' is the raw prefix getAllSubtags
    // builds. They disagree, so NOTHING matches. This is the precise gap ehfz's
    // renameTag fold closes — getAllSubtags is intentionally NOT self-folding.
    const ss = readTagsSuperstate(["#foo", "#foo/bar", "#foo/bar/baz", "#foobar"]);
    expect(getAllSubtags(ss, "#Foo")).toEqual([]);
  });

  it("the LOWERCASED arg ('#foo') matches every '#foo/...' descendant AND rejects the sibling '#foobar'", () => {
    // Same fixture, folded arg: now the '#foo/' prefix agrees with the fold, so
    // the genuine descendants match and the textual-prefix sibling '#foobar'
    // (Notidian-23bl boundary invariant) is still excluded.
    const ss = readTagsSuperstate(["#foo", "#foo/bar", "#foo/bar/baz", "#foobar"]);
    expect(getAllSubtags(ss, "#foo")).toEqual(["#foo/bar", "#foo/bar/baz"]);
  });

  it("actually consults spaceManager.readTags() (the single live touch) exactly once", () => {
    const ss = readTagsSuperstate(["#foo", "#foo/bar"]);
    getAllSubtags(ss, "#foo");
    expect((ss.spaceManager.readTags as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it("mixed-case descendants in readTags() are NOT matched by a lowercased arg (raw case-sensitive prefix)", () => {
    // Locks the inverse of seam 1: getAllSubtags compares raw, so even if
    // readTags() leaked a mixed-case entry it would not match the folded arg.
    // (In production readTags() is always lowercased; this pins the contract.)
    const ss = readTagsSuperstate(["#foo", "#foo/a", "#Foo/b"]);
    expect(getAllSubtags(ss, "#foo")).toEqual(["#foo/a"]);
  });
});

// ---------------------------------------------------------------------------
// SEAM 2 — the FULL renameTag recursion driven against a FAKE superstate whose
// every method is a recording `jest.fn`. This reproduces BOTH live casing
// seams so the test exercises the real mismatch, not a strawman:
//   * readTags() returns the LOWERCASED fold, and
//   * pathsForTag() is CASE-INSENSITIVE on the incoming tag (mirrors the live
//     getAllFilesForTag/tagExists `a.toLowerCase()==b.toLowerCase()`).
// `pathExists` is parameterised so we can drive BOTH renameTagSpacePath
// branches (renamePath when true; deletePath + onPathDeleted when false).
// ---------------------------------------------------------------------------
type FakeOpts = {
  // lowercased tags as readTags() returns them
  readTags: string[];
  // folded(lowercased) tag -> file paths carrying it
  pathsByFoldedTag: Record<string, string[]>;
  // controls the renameTagSpacePath branch (default: the renamePath branch)
  spacePathExists?: boolean;
};

const fakeSuperstate = (opts: FakeOpts) => {
  const spies = {
    readTags: jest.fn(() => opts.readTags),
    pathsForTag: jest.fn(
      (tag: string) => opts.pathsByFoldedTag[tag.toLowerCase()] ?? []
    ),
    renameTag: jest.fn((_path: string, _tag: string, _newTag: string) => {}),
    pathExists: jest.fn(async () => opts.spacePathExists ?? true),
    renamePath: jest.fn((_from: string, _to: string) => {}),
    deletePath: jest.fn((_path: string) => {}),
    onTagRenamed: jest.fn((_tag: string, _newTag: string) => {}),
    onPathDeleted: jest.fn((_path: string) => {}),
  };
  const ss = {
    settings: { spacesFolder: "Spaces" },
    onTagRenamed: spies.onTagRenamed,
    onPathDeleted: spies.onPathDeleted,
    spaceManager: {
      readTags: spies.readTags,
      pathsForTag: spies.pathsForTag,
      renameTag: spies.renameTag,
      pathExists: spies.pathExists,
      renamePath: spies.renamePath,
      deletePath: spies.deletePath,
    },
  } as unknown as Superstate;
  return { ss, spies };
};

// HISTORY (Notidian-i9uk, fixed): renameTag USED TO be flat-subtree-then-recurse
// — getAllSubtags returned the WHOLE subtree, then renameTag RECURSED on each
// entry which RE-FETCHED the subtree, so a grandchild at depth d below the root
// was dispatched d times (idempotent on disk: same folded prefix -> same newTag
// every pass, but O(sum-of-depths) writes + onTagRenamed events). The fix
// replaced that self-recursion with a FLAT loop that runs each node's per-node
// side-effects EXACTLY ONCE — O(n). So the DISTINCT (path,tag,newTag) rewrite
// set is UNCHANGED (still asserted via distinctRenameTagArgs), but the RAW
// (multiplicity-included) call count is now exactly once per node. The casing
// claim remains "the FOLDED prefix is used at every level".
const distinctRenameTagArgs = (
  mock: jest.Mock
): Array<[string, string, string]> => {
  const seen = new Set<string>();
  const out: Array<[string, string, string]> = [];
  for (const call of mock.mock.calls) {
    const tuple = call as [string, string, string];
    const key = tuple.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
};

describe("renameTag — case-fold seam, recording jest.fn spies (Notidian-3dpn)", () => {
  // (1) getAllSubtags via renameTag matches lowercased descendants for a
  //     mixed-case source AND rejects the textual-prefix sibling.
  it("(1) a MIXED-CASE source matches lowercased '#foo/...' descendants AND skips the sibling '#foobar'", async () => {
    const { ss, spies } = fakeSuperstate({
      readTags: ["#foo", "#foobar", "#foo/bar", "#foo/bar/baz"],
      pathsByFoldedTag: {
        "#foo": ["A.md"],
        "#foobar": ["SIB.md"],
        "#foo/bar": ["B.md"],
        "#foo/bar/baz": ["C.md"],
      },
    });
    const result = await renameTag(ss, "#Foo", "Renamed");
    expect(result).toBe("#renamed");
    expect(distinctRenameTagArgs(spies.renameTag)).toEqual([
      ["A.md", "#foo", "#renamed"],
      ["B.md", "#foo/bar", "#renamed/bar"],
      ["C.md", "#foo/bar/baz", "#renamed/bar/baz"],
    ]);
    // The sibling '#foobar' was never a rename target (its only file SIB.md is
    // never touched, and no rewrite produces '#renamedbar').
    expect(spies.renameTag).not.toHaveBeenCalledWith(
      "SIB.md",
      expect.anything(),
      expect.anything()
    );
    // Every dispatched source tag is the folded form — never the raw '#Foo'.
    for (const [, tag] of spies.renameTag.mock.calls as Array<
      [string, string, string]
    >) {
      expect(tag).toMatch(/^#foo/);
    }
  });

  // (2) the recursion rewrites every descendant prefix correctly when the
  //     source tag is mixed-case (the subtag.replace half of the seam).
  it("(2) rewrites every descendant's leading folded prefix for a mixed-case source, preserving deep child segments", async () => {
    const { ss, spies } = fakeSuperstate({
      readTags: ["#proj", "#proj/alpha", "#proj/alpha/v1", "#proj/beta"],
      pathsByFoldedTag: {
        "#proj": ["p.md"],
        "#proj/alpha": ["a.md"],
        "#proj/alpha/v1": ["v.md"],
        "#proj/beta": ["b.md"],
      },
    });
    await renameTag(ss, "#PrOj", "Work");
    expect(distinctRenameTagArgs(spies.renameTag)).toEqual([
      ["p.md", "#proj", "#work"],
      ["a.md", "#proj/alpha", "#work/alpha"],
      ["v.md", "#proj/alpha/v1", "#work/alpha/v1"],
      ["b.md", "#proj/beta", "#work/beta"],
    ]);
    // MULTIPLICITY (Notidian-i9uk) — the depth-3 '#proj/alpha/v1' fixture has 4
    // nodes (root '#proj' + 3 descendants), each carrying exactly one file path.
    // PRE-fix (flat-subtree-then-recurse) the grandchild '#proj/alpha/v1' (depth
    // 2 below root) was dispatched TWICE — once from the root's direct subtag
    // loop and once nested under '#proj/alpha' — for 5 RAW spaceManager.renameTag
    // calls. POST-fix the flat loop visits each node ONCE: exactly 4 raw calls,
    // one per node. distinctRenameTagArgs (above) is unchanged because the
    // redundant pass was the SAME idempotent (path,tag,newTag) tuple.
    expect(spies.renameTag.mock.calls).toEqual([
      ["p.md", "#proj", "#work"],
      ["a.md", "#proj/alpha", "#work/alpha"],
      ["v.md", "#proj/alpha/v1", "#work/alpha/v1"],
      ["b.md", "#proj/beta", "#work/beta"],
    ]);
    expect(spies.renameTag).toHaveBeenCalledTimes(4);
    // onTagRenamed (via renameTagSpacePath) likewise fires EXACTLY ONCE per node
    // — pre-fix the deep grandchild's notification fired twice.
    expect(spies.onTagRenamed.mock.calls).toEqual([
      ["#proj", "#work"],
      ["#proj/alpha", "#work/alpha"],
      ["#proj/alpha/v1", "#work/alpha/v1"],
      ["#proj/beta", "#work/beta"],
    ]);
    expect(spies.onTagRenamed).toHaveBeenCalledTimes(4);
  });

  // (2b) Notidian-i9uk REGRESSION — a DESCENDANT entry whose CHILD segment is
  //      MIXED-CASE must be dispatched with its SOURCE and TARGET both folded,
  //      exactly as the recursion it replaced did. readTags() is only PARTLY
  //      folded: loadTags lowercases metadataCache.getTags() keys but maps
  //      tag-space FOLDER names via tagPathToTag(name), which does NOT lowercase,
  //      so a folder '#proj+Alpha' yields the readTags entry '#proj/Alpha' — a
  //      genuine '/'-boundaried descendant of folded '#proj' (passes the
  //      startsWith('#proj/') filter) with a mixed-case child. The pre-i9uk flat
  //      loop dispatched the RAW '#proj/Alpha' -> '#work/Alpha', writing a
  //      non-canonical tag into file bodies (editTagInFileBody splices newTag
  //      verbatim) and the `tags:` property (editTagInProperties stores
  //      stringFromTag(newTag) verbatim) — a Notidian-ehfz fold-invariant break.
  //      The in-loop fold restores the canonical lowercased dispatch. Every
  //      OTHER fixture in this file feeds already-folded descendants, so this is
  //      the ONLY case that exercises the descendant-side fold.
  it("(2b) a MIXED-CASE descendant segment is dispatched FOLDED on both source and target (Notidian-i9uk)", async () => {
    const { ss, spies } = fakeSuperstate({
      // '#proj/Alpha' as the tag-space-folder branch (tagPathToTag) yields it,
      // un-lowercased, beside a normally-folded sibling '#proj/beta'.
      readTags: ["#proj", "#proj/Alpha", "#proj/beta"],
      pathsByFoldedTag: {
        "#proj": ["p.md"],
        "#proj/alpha": ["a.md"],
        "#proj/beta": ["b.md"],
      },
    });
    await renameTag(ss, "#Proj", "Work");
    // Both the source tag ('#proj/alpha') and the target ('#work/alpha') are
    // canonically LOWERCASED — never the raw '#proj/Alpha' / '#work/Alpha'.
    expect(spies.renameTag.mock.calls).toEqual([
      ["p.md", "#proj", "#work"],
      ["a.md", "#proj/alpha", "#work/alpha"],
      ["b.md", "#proj/beta", "#work/beta"],
    ]);
    // No raw mixed-case ever reaches a tag-rename sink (source OR target).
    for (const [, tag, newTag] of spies.renameTag.mock.calls as Array<
      [string, string, string]
    >) {
      expect(tag).not.toMatch(/[A-Z]/);
      expect(newTag).not.toMatch(/[A-Z]/);
    }
    // renameTagSpacePath / onTagRenamed are driven with the folded forms too, so
    // folderForTagSpace resolves the real lowercased tag-space folder.
    for (const [tag, newTag] of spies.onTagRenamed.mock.calls as Array<
      [string, string]
    >) {
      expect(tag).not.toMatch(/[A-Z]/);
      expect(newTag).not.toMatch(/[A-Z]/);
    }
  });

  // (3) siblings sharing a textual prefix are NEVER renamed.
  it("(3) a sibling sharing only a textual prefix is never renamed (no '#barbar' corruption — Notidian-23bl)", async () => {
    const { ss, spies } = fakeSuperstate({
      readTags: ["#foo", "#foobar", "#football", "#foo/a"],
      pathsByFoldedTag: {
        "#foo": ["x.md"],
        "#foobar": ["s1.md"],
        "#football": ["s2.md"],
        "#foo/a": ["y.md"],
      },
    });
    await renameTag(ss, "#Foo", "#Bar");
    expect(distinctRenameTagArgs(spies.renameTag)).toEqual([
      ["x.md", "#foo", "#bar"],
      ["y.md", "#foo/a", "#bar/a"],
    ]);
    // Neither sibling file is ever touched, and no rewrite mangles a sibling.
    expect(
      spies.renameTag.mock.calls.some(
        (c) => c[0] === "s1.md" || c[0] === "s2.md"
      )
    ).toBe(false);
    expect(
      spies.renameTag.mock.calls.some(
        (c) => c[2] === "#barbar" || c[2] === "#bartball"
      )
    ).toBe(false);
  });

  // (4) folded idempotence — an already-lowercase source behaves identically.
  it("(4) an ALREADY-lowercase source produces the identical dispatch as its mixed-case twin (folded idempotence)", async () => {
    const make = () =>
      fakeSuperstate({
        readTags: ["#foo", "#foo/a", "#foo/a/b"],
        pathsByFoldedTag: {
          "#foo": ["x.md"],
          "#foo/a": ["y.md"],
          "#foo/a/b": ["z.md"],
        },
      });
    const lower = make();
    const mixed = make();
    await renameTag(lower.ss, "#foo", "#bar");
    await renameTag(mixed.ss, "#FOO", "#bar");
    const expected = [
      ["x.md", "#foo", "#bar"],
      ["y.md", "#foo/a", "#bar/a"],
      ["z.md", "#foo/a/b", "#bar/a/b"],
    ];
    expect(distinctRenameTagArgs(lower.spies.renameTag)).toEqual(expected);
    expect(distinctRenameTagArgs(mixed.spies.renameTag)).toEqual(expected);
    // Identical right down to the raw (multiplicity-included) call sequence:
    // both flatten to the SAME exactly-once-per-node dispatch (Notidian-i9uk).
    expect(mixed.spies.renameTag.mock.calls).toEqual(
      lower.spies.renameTag.mock.calls
    );
    // Depth-2 fixture ('#foo/a/b'): 3 nodes -> exactly 3 raw calls each, one per
    // node. PRE-fix the depth-2 grandchild '#foo/a/b' was dispatched twice (4
    // raw calls); the flat loop now visits it once.
    expect(lower.spies.renameTag.mock.calls).toEqual(expected);
    expect(lower.spies.renameTag).toHaveBeenCalledTimes(3);
    expect(mixed.spies.renameTag).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// SEAM 3 — renameTagSpacePath, BOTH branches, against the folded tag. The
// in-file ehfz suite only ever reaches the pathExists -> renamePath branch.
// Here pathExists is parameterised so the ELSE branch (deletePath +
// onPathDeleted) is also locked, and onTagRenamed casing is pinned in both.
// folderForTagSpace('#foo', {spacesFolder:'Spaces'}) -> 'Spaces/#foo';
// pathToParentPath('Spaces/#foo') -> 'Spaces'.
// ---------------------------------------------------------------------------
describe("renameTagSpacePath via renameTag — both branches, folded tag (Notidian-3dpn)", () => {
  it("pathExists === true: renames the space FOLDER against the FOLDED tag, then notifies onTagRenamed(folded,newTag)", async () => {
    const { ss, spies } = fakeSuperstate({
      readTags: ["#foo"],
      pathsByFoldedTag: { "#foo": ["P.md"] },
      spacePathExists: true,
    });
    await renameTag(ss, "#Foo", "Bar");
    expect(spies.pathExists).toHaveBeenCalledWith("Spaces/#foo");
    expect(spies.renamePath).toHaveBeenCalledTimes(1);
    expect(spies.renamePath).toHaveBeenCalledWith("Spaces/#foo", "Spaces/#bar");
    // No deletion on the rename branch.
    expect(spies.deletePath).not.toHaveBeenCalled();
    expect(spies.onPathDeleted).not.toHaveBeenCalled();
    // Notification fires with the FOLDED source tag (never the raw '#Foo').
    expect(spies.onTagRenamed).toHaveBeenCalledWith("#foo", "#bar");
  });

  it("pathExists === false: deletes the (folded) space path + onPathDeleted, still notifies onTagRenamed(folded,newTag)", async () => {
    const { ss, spies } = fakeSuperstate({
      readTags: ["#foo"],
      pathsByFoldedTag: { "#foo": ["P.md"] },
      spacePathExists: false,
    });
    await renameTag(ss, "#Foo", "Bar");
    expect(spies.pathExists).toHaveBeenCalledWith("Spaces/#foo");
    // ELSE branch: deletePath(superstate, 'Spaces/#foo') -> spaceManager
    // .deletePath('Spaces/#foo') + superstate.onPathDeleted('Spaces/#foo').
    expect(spies.deletePath).toHaveBeenCalledTimes(1);
    expect(spies.deletePath).toHaveBeenCalledWith("Spaces/#foo");
    expect(spies.onPathDeleted).toHaveBeenCalledWith("Spaces/#foo");
    // No folder rename on the delete branch.
    expect(spies.renamePath).not.toHaveBeenCalled();
    // Notification still fires with the FOLDED tag.
    expect(spies.onTagRenamed).toHaveBeenCalledWith("#foo", "#bar");
  });
});

// ---------------------------------------------------------------------------
// SEAM 4 — the fold GUARD. An empty / whitespace-only source short-circuits to
// null with ZERO side-effects on every spy (nothing renamed, no space touched).
// ---------------------------------------------------------------------------
describe("renameTag — fold guard short-circuit (Notidian-3dpn)", () => {
  it("an empty source returns null and touches NO spy", async () => {
    const { ss, spies } = fakeSuperstate({ readTags: [], pathsByFoldedTag: {} });
    expect(await renameTag(ss, "", "#bar")).toBeNull();
    expect(spies.renameTag).not.toHaveBeenCalled();
    expect(spies.pathsForTag).not.toHaveBeenCalled();
    expect(spies.pathExists).not.toHaveBeenCalled();
    expect(spies.renamePath).not.toHaveBeenCalled();
    expect(spies.deletePath).not.toHaveBeenCalled();
    expect(spies.onTagRenamed).not.toHaveBeenCalled();
  });

  it("a whitespace-only source ('   ') also folds to null via validateName trim + falsy guard", async () => {
    const { ss, spies } = fakeSuperstate({ readTags: [], pathsByFoldedTag: {} });
    expect(await renameTag(ss, "   ", "#bar")).toBeNull();
    expect(spies.renameTag).not.toHaveBeenCalled();
  });
});
