import { resolvePath } from "./path";

/**
 * resolvePath (src/core/superstate/utils/path.ts) is the ONLY pure export of
 * path.ts — every other export is an async superstate operation. It is the
 * relative-path / alias resolver that turns a link or relation target ('./x',
 * '../x', 'x|Alias', 'http…') plus a *source* path into a concrete vault path.
 *
 * That resolved path is then used directly as a lookup KEY into the paths /
 * spacesIndex (see spaceManager.resolvePath and core/utils/contexts/
 * linkContextRow.ts). Markdown file paths own row identity and default titles
 * (ADR 0014 / ADR 0016), so a wrong resolution here silently re-points a link
 * or relation at the WRONG row — or at no row — without throwing. That makes
 * this an identity-critical surface, and it had ZERO test coverage.
 *
 * resolvePath is a pure string transform (no I/O; the `isSpace` predicate is
 * injected), so the whole suite is fully offline-verifiable (Q1). The function
 * is imported relatively from the co-located source under jest's
 * moduleDirectories=["node_modules","src"] resolution; ts-jest erases the
 * type-only `Superstate` import, so no network / makemd-core runtime is needed.
 *
 * Where the current implementation has a genuine bug, the test is labelled
 * CHARACTERIZATION: it pins today's behavior so a future fix is a deliberate,
 * reviewed change — never a silent regression — and the bug is captured in a
 * follow-up bead rather than patched blindly here (per the autonomous-mode
 * "characterize, do not fix blind" contract).
 *
 * Reference signature:
 *   resolvePath(path, source, isSpace?) => string
 */

// Injected predicates standing in for spacesIndex.has(p) / type == 'space'.
const noSpace = (_p: string) => false;
const allSpace = (_p: string) => true;

describe("resolvePath", () => {
  describe("passthrough when source or path is empty / missing", () => {
    it("returns the path unchanged when source is empty (no anchor to resolve against)", () => {
      expect(resolvePath("./a.md", "", noSpace)).toBe("./a.md");
      expect(resolvePath("../a.md", "", noSpace)).toBe("../a.md");
      expect(resolvePath("a.md|Alias", "", noSpace)).toBe("a.md|Alias");
    });

    it("returns the path unchanged when source is undefined", () => {
      // source is typed string but real callers pass spaceManager source? (optional)
      expect(resolvePath("./a.md", undefined as unknown as string, noSpace)).toBe(
        "./a.md"
      );
    });

    it("returns the (falsy) path unchanged when path is empty", () => {
      expect(resolvePath("", "Space/Note.md", noSpace)).toBe("");
    });

    it("returns the path unchanged when path is undefined", () => {
      expect(
        resolvePath(undefined as unknown as string, "Space/Note.md", noSpace)
      ).toBeUndefined();
    });

    it("does the source/path guard BEFORE any http / alias / relative handling", () => {
      // Even an http or aliased or relative path is returned verbatim if source is empty.
      expect(resolvePath("http://x.com|Alias", "", noSpace)).toBe(
        "http://x.com|Alias"
      );
    });
  });

  describe("http* prefix passthrough", () => {
    it("returns http:// and https:// URLs unchanged", () => {
      expect(resolvePath("http://example.com/x", "Space/Note.md", noSpace)).toBe(
        "http://example.com/x"
      );
      expect(
        resolvePath("https://example.com/x", "Space/Note.md", noSpace)
      ).toBe("https://example.com/x");
    });

    it("short-circuits http BEFORE alias stripping (alias on an http URL survives)", () => {
      // The http check returns before the '|' split, so a real http URL keeps its
      // alias text. This is the intended-ish behavior for external links.
      expect(
        resolvePath("http://example.com/x|Label", "Space/Note.md", noSpace)
      ).toBe("http://example.com/x|Label");
    });

    /**
     * CHARACTERIZATION (BUG): the http test is `path.indexOf('http') == 0`, i.e.
     * "starts with the literal substring 'http'", NOT "is an http(s):// URL".
     * So any path beginning with the four letters "http" is treated as an
     * external URL and SHORT-CIRCUITS before alias stripping and relative
     * resolution — even when it is actually a vault path or a custom scheme.
     *
     * This is observable: the '|' alias is NOT stripped for these, whereas it
     * IS stripped for every other (non-http-prefixed) path. A vault note literally
     * named e.g. "httpx Notes/x.md|Alias", or a "httpx://" custom scheme, would
     * wrongly keep its alias and skip resolution.
     */
    it("CHARACTERIZATION(bug): 'httpx://' is a false-positive — treated as a URL, alias NOT stripped", () => {
      expect(resolvePath("httpx://foo|Alias", "Space/Note.md", noSpace)).toBe(
        "httpx://foo|Alias"
      );
      // contrast: a non-http-prefixed aliased path DOES get its alias stripped
      expect(resolvePath("foo|Alias", "Space/Note.md", noSpace)).toBe("foo");
    });

    it("CHARACTERIZATION(bug): a bare 'http'-prefixed token passes through unchanged", () => {
      // "httpfoo" is not a URL but starts with "http", so it short-circuits.
      expect(resolvePath("httpfoo", "Space/Note.md", noSpace)).toBe("httpfoo");
    });

    it("does NOT treat 'http' appearing later in the string as a URL (indexOf must be 0)", () => {
      // 'http' is present but not at index 0, so no short-circuit: the alias IS stripped.
      expect(resolvePath("xhttp://a|Alias", "Space/Note.md", noSpace)).toBe(
        "xhttp://a"
      );
    });

    it("CHARACTERIZATION: an uppercase 'HTTP://' is NOT recognized (case-sensitive indexOf)", () => {
      // No http short-circuit (case-sensitive), no leading ./ or ../, so it falls
      // through to the final return unchanged — same string, different code path.
      expect(resolvePath("HTTP://example.com", "Space/Note.md", noSpace)).toBe(
        "HTTP://example.com"
      );
    });
  });

  describe("'|' alias stripping (left side wins)", () => {
    it("keeps only the left side of a single '|'", () => {
      expect(resolvePath("a.md|Display Name", "Space/Note.md", noSpace)).toBe(
        "a.md"
      );
    });

    it("splits on the FIRST '|' (split('|')[0]) when multiple pipes are present", () => {
      expect(resolvePath("a.md|one|two", "Space/Note.md", noSpace)).toBe("a.md");
    });

    it("yields an empty left side when the path begins with '|'", () => {
      // '|Alias'.split('|')[0] === '' -> '' has no ./ or ../ -> returned as ''
      expect(resolvePath("|Alias", "Space/Note.md", noSpace)).toBe("");
    });

    it("strips the alias BEFORE relative resolution, so './x|Alias' still resolves", () => {
      // The alias split runs first, then the resulting './x' is resolved relative to source.
      expect(resolvePath("./a.md|Alias", "Space/Note.md", noSpace)).toBe(
        "Space/a.md"
      );
    });

    it("strips the alias on a '../x|Alias' before parent-walking", () => {
      expect(resolvePath("../a.md|Alias", "A/B/C.md", noSpace)).toBe("A/a.md");
    });
  });

  describe("'./' relative resolution against a non-space source", () => {
    it("resolves './x' to the parent directory of a non-space source file", () => {
      // source 'Space/Note.md' -> dir 'Space' -> 'Space' + '/a.md'
      expect(resolvePath("./a.md", "Space/Note.md", noSpace)).toBe("Space/a.md");
    });

    it("resolves against the deepest directory of a multi-segment source", () => {
      expect(resolvePath("./x.md", "A/B/C/Note.md", noSpace)).toBe("A/B/C/x.md");
    });

    it("preserves a nested './sub/x' tail after the alias/'.' slice", () => {
      // path.slice(1) drops the leading '.', leaving '/sub/x.md' appended to the dir.
      expect(resolvePath("./sub/x.md", "A/B/Note.md", noSpace)).toBe(
        "A/B/sub/x.md"
      );
    });

    it("treats isSpace as falsy when the predicate is omitted (optional chaining)", () => {
      // No predicate passed -> isSpace?.() is undefined -> non-space branch.
      expect(resolvePath("./a.md", "Space/Note.md")).toBe("Space/a.md");
    });

    /**
     * CHARACTERIZATION (BUG): the non-space branch is
     *   source.slice(0, source.lastIndexOf('/')) + path.slice(1)
     * When a non-space source has NO '/', lastIndexOf('/') === -1, so
     * source.slice(0, -1) DROPS THE LAST CHARACTER of the source instead of
     * yielding ''. The result is a corrupt, non-existent path.
     */
    it("CHARACTERIZATION(bug): a non-space source with no '/' drops its last char (slice(0,-1))", () => {
      // 'Note.md'.slice(0,-1) === 'Note.m', then + '/a.md'
      expect(resolvePath("./a.md", "Note.md", noSpace)).toBe("Note.m/a.md");
    });

    it("CHARACTERIZATION: a source ending in '/' resolves to the segment before the trailing slash", () => {
      // lastIndexOf('/') is the trailing slash index -> 'Space/'.slice(0,5) === 'Space'
      expect(resolvePath("./a.md", "Space/", noSpace)).toBe("Space/a.md");
    });
  });

  describe("'./' relative resolution against an isSpace source", () => {
    it("APPENDS after a space source rather than walking to its parent", () => {
      // isSpace true -> return source + path.slice(1) === 'Space' + '/a.md'
      expect(resolvePath("./a.md", "Space", allSpace)).toBe("Space/a.md");
    });

    it("appends after a multi-segment space source (no parent walk)", () => {
      expect(resolvePath("./a.md", "Space/Sub", allSpace)).toBe(
        "Space/Sub/a.md"
      );
    });

    it("uses the predicate result per-call (space vs non-space differ for the same inputs)", () => {
      const path = "./a.md";
      const source = "A/B"; // ambiguous: file 'B' in 'A', or space 'A/B'
      expect(resolvePath(path, source, allSpace)).toBe("A/B/a.md"); // append
      expect(resolvePath(path, source, noSpace)).toBe("A/a.md"); // parent walk
    });
  });

  describe("'../' parent-walk resolution", () => {
    it("walks up one level for a single '../'", () => {
      // source 'A/B/C.md' -> pop leaf -> ['A','B'] -> pop one for '..' -> ['A'] + ['a.md']
      expect(resolvePath("../a.md", "A/B/C.md", noSpace)).toBe("A/a.md");
    });

    it("walks up multiple levels for '../../'", () => {
      expect(resolvePath("../../a.md", "A/B/C/D.md", noSpace)).toBe("A/a.md");
    });

    it("walks up three levels for '../../../'", () => {
      expect(resolvePath("../../../x.md", "A/B/C/D/E.md", noSpace)).toBe(
        "A/x.md"
      );
    });

    it("preserves a nested tail after the parent walk", () => {
      expect(resolvePath("../sub/x.md", "A/B/C.md", noSpace)).toBe("A/sub/x.md");
    });

    it("does NOT engage the '../' branch for a bare '..' with no trailing slash", () => {
      // The branch is keyed on indexOf('../') == 0; '..' alone lacks the slash.
      expect(resolvePath("..", "A/B.md", noSpace)).toBe("..");
    });

    /**
     * CHARACTERIZATION (over-pop past root): when the number of '..' segments
     * exceeds the source depth, the while loop keeps popping an already-empty
     * sourceParts array (Array.prototype.pop() on [] returns undefined, no throw).
     * The resolver does NOT clamp at root and does NOT throw. The key property
     * the suite asserts is that over-popping never produces a leading-slash
     * duplication ('//…') or a leading-slash artifact — it degrades to a bare
     * (rootless) path. We pin the exact outputs so a future clamp is deliberate.
     */
    it("CHARACTERIZATION: over-popping past root yields a bare path (no leading '/')", () => {
      // '../../../a.md' vs 'A/B.md': pop leaf -> ['A']; three '..' pops drain it and
      // then pop undefined twice -> sourceParts === [] -> [] + ['a.md'] -> 'a.md'
      expect(resolvePath("../../../a.md", "A/B.md", noSpace)).toBe("a.md");
    });

    it("CHARACTERIZATION: over-popping a single-segment source yields the bare leaf", () => {
      expect(resolvePath("../a.md", "B.md", noSpace)).toBe("a.md");
      expect(resolvePath("../../a.md", "B.md", noSpace)).toBe("a.md");
    });

    it("CHARACTERIZATION: when '..' segments consume the WHOLE path it collapses to ''", () => {
      // '../../' -> pathParts ['..','..',''] ; both '..' shift out, leaving [''] ;
      // sourceParts drained to [] -> [] + [''] -> [''].join('/') === ''
      expect(resolvePath("../../", "A/B.md", noSpace)).toBe("");
      expect(resolvePath("../../..", "A/B/C/D.md", noSpace)).toBe("");
    });
  });

  describe("plain paths with no leading './' or '../' pass through", () => {
    it("returns a plain relative-looking path unchanged", () => {
      expect(resolvePath("a/b.md", "Space/Note.md", noSpace)).toBe("a/b.md");
    });

    it("returns an absolute-looking path unchanged", () => {
      expect(resolvePath("/a/b.md", "Space/Note.md", noSpace)).toBe("/a/b.md");
    });

    it("returns a bare basename unchanged", () => {
      expect(resolvePath("Note.md", "Space/Other.md", noSpace)).toBe("Note.md");
    });

    it("still strips an alias on an otherwise-plain path", () => {
      expect(resolvePath("a/b.md|Alias", "Space/Note.md", noSpace)).toBe(
        "a/b.md"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PROPERTY TESTS — invariants that must hold across a generated input space.
  // ---------------------------------------------------------------------------
  describe("properties", () => {
    const segs = ["A", "Bee", "c", "Sub Folder", "x.md", "Note.md"];
    const sources: string[] = [];
    for (let i = 1; i <= 4; i++) {
      // build sources of depth 1..4 from the segment pool
      sources.push(segs.slice(0, i).join("/"));
    }
    sources.push("file.md", "Single", "Space/Deep/Path/leaf.md");

    const depths = ["", "../", "../../", "../../../", "../../../../"];
    const tails = ["x.md", "a/b.md", "deep/nested/leaf.md"];

    it("idempotence: a plain (already-absolute, non-relative, non-alias) path is a fixed point", () => {
      const absolutes = [
        "A/B/C.md",
        "/root/leaf.md",
        "Single",
        "Space/Sub/Note.md",
        "no-extension/path",
      ];
      for (const abs of absolutes) {
        for (const src of sources) {
          const once = resolvePath(abs, src, noSpace);
          expect(once).toBe(abs); // unchanged
          // applying again is still a fixed point
          expect(resolvePath(once, src, noSpace)).toBe(abs);
        }
      }
    });

    it("idempotence: http(s) URLs are fixed points regardless of source", () => {
      const urls = ["http://a.com/x", "https://a.com/x?q=1"];
      for (const u of urls) {
        for (const src of sources) {
          expect(resolvePath(u, src, noSpace)).toBe(resolvePath(u, src, noSpace));
          expect(resolvePath(u, src, noSpace)).toBe(u);
        }
      }
    });

    it("'../' depth never produces a leading-slash duplication ('//') nor a leading '/'", () => {
      for (const depth of depths) {
        for (const tail of tails) {
          for (const src of sources) {
            const out = resolvePath(depth + tail, src, noSpace);
            expect(out.startsWith("/")).toBe(false);
            expect(out).not.toContain("//");
          }
        }
      }
    });

    it("'./' resolution against a space source never duplicates slashes", () => {
      const spaceSources = ["Space", "A/B", "Deep/Nested/Space"];
      for (const tail of tails) {
        for (const src of spaceSources) {
          const out = resolvePath("./" + tail, src, allSpace);
          expect(out).not.toContain("//");
          // append semantics: result starts with the space source path
          expect(out.startsWith(src + "/")).toBe(true);
        }
      }
    });

    it("output join consistency: a './'-resolved space path round-trips through split/join", () => {
      const spaceSources = ["Space", "A/B/C"];
      for (const tail of tails) {
        for (const src of spaceSources) {
          const out = resolvePath("./" + tail, src, allSpace);
          // join consistency: splitting on '/' and re-joining is the identity
          expect(out.split("/").join("/")).toBe(out);
          // and the resolved path equals naive append for the space branch
          expect(out).toBe(src + "/" + tail);
        }
      }
    });

    it("alias-stripping is total: the resolved output never contains a '|' it could have split off", () => {
      // For every non-http path containing a single '|', the '|' (and right side) is gone.
      for (const tail of tails) {
        for (const src of sources) {
          const out = resolvePath(tail + "|SomeAlias", src, noSpace);
          expect(out).not.toContain("|");
        }
      }
    });

    it("determinism: resolvePath is a pure function (same args -> same result)", () => {
      const inputs: Array<[string, string]> = [
        ["./a.md", "Space/Note.md"],
        ["../a.md", "A/B/C.md"],
        ["x|Alias", "S"],
        ["http://x", "S"],
        ["/abs", "S"],
      ];
      for (const [p, s] of inputs) {
        const a = resolvePath(p, s, noSpace);
        const b = resolvePath(p, s, noSpace);
        expect(a).toBe(b);
      }
    });
  });
});
