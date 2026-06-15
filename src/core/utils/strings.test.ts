import { removeLeadingSlash, pathToParentPath } from "core/utils/strings";

// ===========================================================================
// DEPTH (Q1) — adversarial + characterization tests for the two PURE path
// helpers in src/core/utils/strings.ts (Notidian-naxk).
//
//   export const removeLeadingSlash = (path) =>
//     path.charAt(0) == "/" ? path.substring(1) : path;
//   export const pathToParentPath = (path) =>
//     removeLeadingSlash(path.substring(0, path.lastIndexOf("/"))) || path;
//
// These two helpers had ZERO co-located coverage, yet they OWN ROW IDENTITY:
// per ADR 0014 (notidian-only personal database engine) and ADR 0016 (a
// Notidian row IS a markdown file — its *path*/basename is the row's canonical
// identity), every higher path util composes on them. `removeLeadingSlash` is
// the normalization primitive used by src/utils/path.ts (folderPathToString,
// pathToString) and src/basics/ui/UINote.tsx; `pathToParentPath` is how
// optionValuesForColumn.ts renames a tag's space ("parent + '/' + newTag").
// A silent change in how a path is reduced to its parent or stripped of a
// leading slash mis-addresses or mis-labels a row.
//
// strings.ts imports `Superstate` from makemd-core at the top, but that import
// is TYPE-ONLY (used only in spaceNameFromSpacePath/schemaNameFromSpacePath
// signatures) and is erased at compile time — empirically confirmed importable
// under jest (preset ts-jest, moduleDirectories:[node_modules, src]) with no
// runtime Superstate dependency. So these two helpers are fully offline.
//
// SCOPE: ONLY removeLeadingSlash + pathToParentPath. spaceNameFromSpacePath and
// schemaNameFromSpacePath are DELIBERATELY EXCLUDED — they dereference a live
// Superstate (pathsIndex/contextsIndex) and belong to a runtime/integration
// suite, not this pure-string Q1 suite.
//
// IMPORTANT — CHARACTERIZATION, not correction. Every value asserted here was
// EMPIRICALLY OBSERVED from the current implementation and is LOCKED so any
// future change to identity-derivation is a conscious, reviewed decision rather
// than a silent regression. Several behaviors are surprising (a slash-less input
// returns ITSELF as its own "parent"; the parent of "/a" or "/" is the input
// verbatim with the leading slash NOT stripped). These are flagged inline as
// latent contracts — NOT "fixed" here, because real callers may depend on
// today's exact shape; a true bug would get a follow-up bead, never a blind fix.
//
// JS pitfall this suite relies on (already locked in src/utils/path.test.ts):
// String.prototype.substring CLAMPS negative args to 0 (it is NOT slice). So for
// a slash-less path, lastIndexOf("/") === -1 and substring(0, -1) === "" — the
// fallback `|| path` then returns the whole input.
// ===========================================================================

// ---------------------------------------------------------------------------
// removeLeadingSlash — drop exactly ONE leading "/" (the normalization primitive)
// ---------------------------------------------------------------------------
describe("removeLeadingSlash", () => {
  it("strips a single leading slash from a rooted path", () => {
    expect(removeLeadingSlash("/foo/bar")).toBe("foo/bar");
  });

  it("turns a lone '/' (root) into the empty string", () => {
    // charAt(0) === "/" -> substring(1) of a length-1 string === "".
    // This emptiness is load-bearing downstream: folderPathToString and
    // pathToParentPath rely on it being falsy to trigger their `|| path` fallback.
    expect(removeLeadingSlash("/")).toBe("");
  });

  it("strips ONLY the first slash from '//' (does not collapse all)", () => {
    expect(removeLeadingSlash("//")).toBe("/");
  });

  it("strips ONLY the first slash from a doubled-root path", () => {
    expect(removeLeadingSlash("//foo")).toBe("/foo");
  });

  it("passes a slash-less path through unchanged", () => {
    expect(removeLeadingSlash("foo")).toBe("foo");
  });

  it("passes an interior-slash (non-leading) path through unchanged", () => {
    expect(removeLeadingSlash("foo/bar")).toBe("foo/bar");
  });

  it("returns the empty string unchanged", () => {
    // charAt(0) of "" is "" (not "/"), so the ternary takes the passthrough arm.
    expect(removeLeadingSlash("")).toBe("");
  });

  it("does NOT strip a slash that is not at index 0 (leading space)", () => {
    // charAt(0) === " ", not "/", so the leading-space-then-slash string is
    // returned verbatim — only an EXACT index-0 slash is removed.
    expect(removeLeadingSlash(" /foo")).toBe(" /foo");
  });

  it("preserves a single trailing slash (only the leading one is in scope)", () => {
    expect(removeLeadingSlash("/foo/")).toBe("foo/");
    expect(removeLeadingSlash("foo/")).toBe("foo/");
  });
});

// ---------------------------------------------------------------------------
// pathToParentPath — reduce a path to its parent folder (leading slash dropped),
// with a self-fallback when there is no proper parent.
// ---------------------------------------------------------------------------
describe("pathToParentPath", () => {
  it("returns the parent folder of a nested path", () => {
    // lastIndexOf("/") = 3; substring(0,3) = "a/b"; no leading slash -> "a/b".
    expect(pathToParentPath("a/b/c")).toBe("a/b");
  });

  it("strips the leading slash off the derived parent of a rooted nested path", () => {
    // "/a/b": lastIndexOf("/") = 2; substring(0,2) = "/a";
    // removeLeadingSlash("/a") = "a" (truthy) -> "a".
    expect(pathToParentPath("/a/b")).toBe("a");
  });

  it("returns the single-segment parent of a two-segment path", () => {
    expect(pathToParentPath("a/b")).toBe("a");
  });

  // --- The self-fallback (`|| path`) cases: surprising but LOCKED. --------
  it("LOCKED: a slash-less path is its own 'parent' (substring(0,-1)==='' fallback)", () => {
    // lastIndexOf("/") = -1; substring(0, -1) CLAMPS to substring(0, 0) = "";
    // removeLeadingSlash("") = "" (falsy) -> `|| path` returns the whole input.
    // This is the bead's named characterization: there is no real parent, so
    // the helper yields the input unchanged rather than "".
    expect(pathToParentPath("abc")).toBe("abc");
  });

  it("LOCKED: empty input falls through to itself", () => {
    // lastIndexOf("/") = -1; substring(0,-1) = ""; falsy -> `|| path` = "".
    expect(pathToParentPath("")).toBe("");
  });

  it("LOCKED: a single rooted segment '/a' returns ITSELF (leading slash NOT stripped)", () => {
    // lastIndexOf("/") = 0; substring(0,0) = ""; removeLeadingSlash("") = ""
    // (falsy) -> `|| path` returns "/a" VERBATIM. The mathematical parent is the
    // root, but the fallback hands back the raw input *including* its leading
    // slash — so unlike the "/a/b" case above, the slash survives here.
    expect(pathToParentPath("/a")).toBe("/a");
  });

  it("LOCKED: a lone root '/' returns itself verbatim", () => {
    // lastIndexOf("/") = 0; substring(0,0) = ""; falsy -> `|| path` = "/".
    expect(pathToParentPath("/")).toBe("/");
  });

  it("LOCKED: a trailing-slash path drops the empty leaf to its first segment", () => {
    // "a/": lastIndexOf("/") = 1; substring(0,1) = "a"; truthy -> "a".
    expect(pathToParentPath("a/")).toBe("a");
  });

  it("LOCKED: a deep trailing-slash path keeps everything before the final slash", () => {
    // "a/b/": lastIndexOf("/") = 3; substring(0,3) = "a/b" -> "a/b".
    expect(pathToParentPath("a/b/")).toBe("a/b");
  });

  it("strips the leading slash from a deeper rooted parent", () => {
    // "/a/b/c": lastIndexOf("/") = 4; substring(0,4) = "/a/b";
    // removeLeadingSlash("/a/b") = "a/b".
    expect(pathToParentPath("/a/b/c")).toBe("a/b");
  });
});

// ---------------------------------------------------------------------------
// PROPERTY NETS — invariants that must hold across a representative population,
// guarding against a future edit that satisfies the spot-checks above but breaks
// a structural guarantee.
// ---------------------------------------------------------------------------
describe("removeLeadingSlash — properties", () => {
  const samples = [
    "",
    "/",
    "//",
    "///",
    "a",
    "/a",
    "//a",
    "a/b",
    "/a/b",
    "a/b/c",
    "/a/b/c/",
    "foo.md",
    "/foo.md",
    " /lead-space",
    "trailing/",
    "/trailing/",
  ];

  it("LOCKED: strips at most ONE leading slash per call — it is NOT a normalizer", () => {
    // Critical, non-obvious contract: removeLeadingSlash removes EXACTLY ONE
    // index-0 slash, so it is idempotent ONLY for single- or zero-leading-slash
    // inputs. For a doubled root the second slash survives:
    expect(removeLeadingSlash("//")).toBe("/");
    expect(removeLeadingSlash("///")).toBe("//");
    expect(removeLeadingSlash("//a")).toBe("/a");
    // => applying it twice is NOT the same as once on multi-slash inputs.
    expect(removeLeadingSlash(removeLeadingSlash("//"))).toBe("");
    expect(removeLeadingSlash("//")).toBe("/");
    // Callers that need a guaranteed no-leading-slash form must loop/repeat —
    // a single call does not collapse a leading run. Real callers
    // (folderPathToString, pathToParentPath) only ever feed it strings whose
    // leading slash is at most one, so single-strip is sufficient in practice.
  });

  it("output never GAINS a leading '/' and removes one if present (single pass)", () => {
    for (const s of samples) {
      const out = removeLeadingSlash(s);
      if (s.startsWith("/")) {
        // exactly one fewer leading slash than the input
        expect(out).toBe(s.substring(1));
      } else {
        // untouched
        expect(out).toBe(s);
      }
    }
  });

  it("repeated application eventually yields a no-leading-slash fixpoint", () => {
    // The eventual normalizer is the FIXPOINT, reached by repeating the
    // single-strip primitive — proving there is no input it cannot eventually
    // normalize (and that it always terminates: length is strictly decreasing
    // until the fixpoint).
    for (const s of samples) {
      let cur = s;
      let prev: string;
      do {
        prev = cur;
        cur = removeLeadingSlash(cur);
      } while (cur !== prev);
      expect(cur.startsWith("/")).toBe(false);
    }
  });

  it("never lengthens the input (removes at most one char)", () => {
    for (const s of samples) {
      const out = removeLeadingSlash(s);
      expect(out.length).toBeLessThanOrEqual(s.length);
      expect(s.length - out.length).toBeLessThanOrEqual(1);
    }
  });

  it("preserves the suffix after the first character verbatim", () => {
    for (const s of samples) {
      const out = removeLeadingSlash(s);
      // Either it was a no-op (out === s) or it stripped exactly index 0.
      expect(out === s || out === s.substring(1)).toBe(true);
    }
  });
});

describe("pathToParentPath — properties", () => {
  const samples = [
    "",
    "/",
    "a",
    "/a",
    "a/b",
    "/a/b",
    "a/b/c",
    "/a/b/c",
    "a/",
    "a/b/",
    "/folder/note.md",
    "deep/nested/folder/leaf",
  ];

  it("output never starts with '/' EXCEPT the self-fallback cases", () => {
    // When a real parent is derived it is run through removeLeadingSlash, so it
    // cannot lead with "/". A leading "/" in the OUTPUT can therefore only come
    // from the `|| path` self-fallback, which returns the raw input verbatim.
    for (const s of samples) {
      const out = pathToParentPath(s);
      if (out.startsWith("/")) {
        expect(out).toBe(s); // proves it was the self-fallback, not a derived parent
      }
    }
  });

  it("a derived parent is always a prefix-region of the input (never invents chars)", () => {
    for (const s of samples) {
      const out = pathToParentPath(s);
      // Either the self-fallback (out === s) or a leading-slash-stripped prefix
      // of everything before the final "/". In both cases every output char
      // originates from the input — the helper never fabricates a segment.
      const beforeLastSlash = s.substring(0, s.lastIndexOf("/"));
      expect(out === s || out === removeLeadingSlash(beforeLastSlash)).toBe(true);
    }
  });

  it("never returns a longer string than the input", () => {
    for (const s of samples) {
      expect(pathToParentPath(s).length).toBeLessThanOrEqual(s.length);
    }
  });

  it("a slash-less input is always returned unchanged (no real parent)", () => {
    for (const s of samples.filter((s) => !s.includes("/"))) {
      expect(pathToParentPath(s)).toBe(s);
    }
  });
});
