import { makeRelationLinkResolver } from "core/utils/contexts/relationResolver";

// makeRelationLinkResolver (Notidian-e1u) is the SHARED resolver that rollups
// (8pl/9ln), sub-items (gg9/pv4), and back-relations (ahk) all route a
// frontmatter relation's wikilink target through to canonicalize it to a real
// vault path (e.g. "Projects/Alpha.md") that can match a pathsIndex key.
//
// Its entire body is `spaceManager.resolvePath(link, sourcePath) ?? link`, so
// the load-bearing contract is the `?? link` fallback: when resolvePath returns
// null OR undefined (nothing resolved / a dangling link), the resolver must
// yield the ORIGINAL link string unchanged — a dangling [[link]] stays a
// stable, non-matching pathsIndex key, never "" and never a crash, so dropped
// relations don't collapse. The boundary is that an empty-string result is a
// real (if odd) resolver result and `??` does NOT replace it.

// Minimal fake Superstate: only spaceManager.resolvePath matters here, and it is
// a jest.fn so we can assert delegation (args forwarded verbatim) and drive the
// return value through the null/undefined/"" boundary.
const makeSuperstate = (resolvePath: jest.Mock) =>
  ({ spaceManager: { resolvePath } } as any);

describe("makeRelationLinkResolver", () => {
  it("delegates to spaceManager.resolvePath verbatim and returns its result", () => {
    // Normal case: a bare-path [[Projects/Alpha]] canonicalizes to the .md key.
    const resolvePath = jest.fn().mockReturnValue("Projects/Alpha.md");
    const resolve = makeRelationLinkResolver(makeSuperstate(resolvePath));

    expect(resolve("Projects/Alpha", "Tasks/A.md")).toBe("Projects/Alpha.md");
    // (link, sourcePath) are forwarded verbatim, in order, to the link index.
    expect(resolvePath).toHaveBeenCalledTimes(1);
    expect(resolvePath).toHaveBeenCalledWith("Projects/Alpha", "Tasks/A.md");
  });

  it("falls back to the ORIGINAL link when resolvePath returns null (dangling)", () => {
    // A dropped/dangling link: the production index returns nothing, so the
    // resolver must return the original string unchanged — a stable,
    // non-matching key that does not collapse the relation to "" or crash.
    const resolvePath = jest.fn().mockReturnValue(null);
    const resolve = makeRelationLinkResolver(makeSuperstate(resolvePath));

    expect(resolve("Projects/Ghost", "Tasks/A.md")).toBe("Projects/Ghost");
  });

  it("falls back to the ORIGINAL link when resolvePath returns undefined (dangling)", () => {
    // `?? link` covers undefined just as it covers null — both must yield the
    // original link, so this is asserted explicitly alongside the null case.
    const resolvePath = jest.fn().mockReturnValue(undefined);
    const resolve = makeRelationLinkResolver(makeSuperstate(resolvePath));

    expect(resolve("[[Phantom]]", "Tasks/A.md")).toBe("[[Phantom]]");
  });

  it("PRESERVES an empty-string result — only null/undefined trigger the fallback", () => {
    // Boundary pin: "" is a real (if odd) resolver result. The nullish `??`
    // does NOT replace it, so an empty string must pass through unchanged rather
    // than be swapped for the original link.
    const resolvePath = jest.fn().mockReturnValue("");
    const resolve = makeRelationLinkResolver(makeSuperstate(resolvePath));

    expect(resolve("Projects/Alpha", "Tasks/A.md")).toBe("");
  });

  it("returns a reusable closure that carries each sourcePath through", () => {
    // The closure is built once per superstate and reused across every
    // (link, source) call. A basename-only [[Alpha]] resolves relative to its
    // source, so the same link from two different source paths must produce the
    // two distinct paths the link index returns for each.
    const resolvePath = jest
      .fn()
      .mockImplementation((link: string, source: string) => {
        if (link === "Alpha" && source === "Work/Projects/Index.md")
          return "Work/Projects/Alpha.md";
        if (link === "Alpha" && source === "Personal/Notes/Index.md")
          return "Personal/Notes/Alpha.md";
        return null;
      });
    const resolve = makeRelationLinkResolver(makeSuperstate(resolvePath));

    expect(resolve("Alpha", "Work/Projects/Index.md")).toBe(
      "Work/Projects/Alpha.md"
    );
    expect(resolve("Alpha", "Personal/Notes/Index.md")).toBe(
      "Personal/Notes/Alpha.md"
    );
    // Same closure, both source paths forwarded distinctly.
    expect(resolvePath).toHaveBeenCalledTimes(2);
    expect(resolvePath).toHaveBeenNthCalledWith(1, "Alpha", "Work/Projects/Index.md");
    expect(resolvePath).toHaveBeenNthCalledWith(
      2,
      "Alpha",
      "Personal/Notes/Index.md"
    );
  });
});
