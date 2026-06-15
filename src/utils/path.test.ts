import {
  folderPathToString,
  getParentFolderPaths,
  pathToString,
  pathNameToString,
  getParentPathFromString,
} from "utils/path";

// ===========================================================================
// DEPTH (Q1) — adversarial + characterization tests for the PURE string
// functions in src/utils/path.ts (Notidian-NEW:test-utils-path-identity-adversarial).
//
// These five helpers had ZERO co-located coverage yet they OWN ROW IDENTITY:
// per ADR 0014 (notidian-only personal database engine) and ADR 0016
// (per-view display properties + inline row expansion), a Notidian row IS a
// markdown file — its *path* and *basename* are the row's canonical identity
// and visible page title. A silent change in how a path is reduced to a
// display name or a parent folder mis-addresses or mis-labels a row.
//
// Coverage scope: the FIVE pure helpers below. `pathDisplayName` is
// DELIBERATELY EXCLUDED — it dereferences a live Superstate (spaceManager,
// contextsIndex, pathsIndex, …) and is not offline-verifiable; it belongs to a
// runtime/integration suite, not this pure-string Q1 suite.
//
// path.ts imports `makemd-core` (Superstate) at the top, but that import is
// TYPE-ONLY and erased at compile time — empirically confirmed importable
// under jest (preset ts-ts, moduleDirectories:[node_modules, src]) with no
// runtime dependency on the Superstate. So this whole suite is fully offline.
//
// IMPORTANT — CHARACTERIZATION, not correction. Every value asserted here was
// EMPIRICALLY OBSERVED from the current implementation and is LOCKED so that any
// future change to identity-derivation is a conscious, reviewed decision rather
// than a silent regression. Several behaviors are surprising (a dotfile inside a
// folder reduces to ""; a trailing-slash folder path round-trips to itself).
// These are flagged inline as latent contracts. They are NOT "fixed" here:
// per the bead directive, a TRUE bug gets a follow-up bead (characterize first,
// never fix blind), because real callers may depend on today's exact shape.
// ===========================================================================

// ---------------------------------------------------------------------------
// pathToString — reduce a vault path to a display *name* (drop dir + extension)
//   const pathToString = (path) => {
//     if (path.lastIndexOf("/") != -1) {
//       if (path.lastIndexOf(".") > path.lastIndexOf("/"))   // dot in BASENAME
//         return removeLeadingSlash(path.substring(lastSlash+1, lastDot));
//       return removeLeadingSlash(path.substring(lastSlash+1));
//     }
//     if (path.lastIndexOf(".") != -1) return path.substring(0, lastDot);
//     return path;
//   };
// Notidian-uuco closed the former bug-prone seam: when a "/" is present, an
// extension is now stripped ONLY when the last "." FOLLOWS the last "/" (i.e.
// the dot is in the BASENAME). A dot in a PARENT folder no longer triggers the
// substring arg-swap that leaked a "/"-bearing garbage display name. A dotfile
// basename (a/.config) still empties to "" — that is the lastDot==lastSlash+1
// case, locked separately below.
// ---------------------------------------------------------------------------
describe("pathToString", () => {
  // --- the ordinary intended case: strip folder + single extension ----------
  it('"a/b.md" -> "b" : strips the parent folder and the extension', () => {
    expect(pathToString("a/b.md")).toBe("b");
  });

  it('"a/b" -> "b" : no extension, just strips the parent folder', () => {
    expect(pathToString("a/b")).toBe("b");
  });

  it('"/a" -> "a" : single leading slash, basename returned (no dot branch)', () => {
    // lastIndexOf("/")==0, lastIndexOf(".")==-1 -> substring(1) -> "a".
    expect(pathToString("/a")).toBe("a");
  });

  // --- ADVERSARIAL: a DOTFILE inside a folder reduces to "" -------------------
  it('"a/.config" -> "" : a dotfile inside a folder is SILENTLY EMPTIED (locked characterization)', () => {
    // lastSlash=1, lastDot=2; substring(2, 2) === "" -> removeLeadingSlash("")
    // === "". The display name of "a/.config" is therefore the empty string.
    // LOCKED: if a row identity is ever derived from a dotfile path, this is the
    // current (surprising) contract. File a follow-up bead before changing it.
    expect(pathToString("a/.config")).toBe("");
  });

  it('".config" -> "" : a bare dotfile (no folder) is also emptied', () => {
    // No slash; lastIndexOf(".")==0 -> substring(0, 0) === "". The bare-dotfile
    // branch mirrors the in-folder branch: both collapse to "".
    expect(pathToString(".config")).toBe("");
  });

  // --- ADVERSARIAL: only the LAST dot is the extension boundary ---------------
  it('"a/b.tar.gz" -> "b.tar" : only the LAST dot is treated as the extension', () => {
    // lastDot points at ".gz"; everything before it (including the ".tar"
    // interior dot) is kept. Double-extension files keep their first extension
    // in the display name. LOCKED.
    expect(pathToString("a/b.tar.gz")).toBe("b.tar");
  });

  it('"archive.tar.gz" -> "archive.tar" : same last-dot rule with no folder', () => {
    expect(pathToString("archive.tar.gz")).toBe("archive.tar");
  });

  // --- ADVERSARIAL: trailing slash empties the basename ----------------------
  it('"a/" -> "" : a trailing slash yields an EMPTY basename (locked)', () => {
    // lastSlash is the final char; no dot; substring(lastSlash+1) is "".
    expect(pathToString("a/")).toBe("");
  });

  // --- FIXED (Notidian-uuco): dotted PARENT folder + extensionless leaf -------
  it('"a.b/c" -> "c" : a dot in the PARENT folder is NOT an extension; the extensionless leaf is returned (FIXED Notidian-uuco)', () => {
    // lastSlash=3, lastDot=1 (the "." in the PARENT "a.b"). Previously the "/"
    // branch fired the "." branch because *some* dot existed, calling
    // substring(lastSlash+1=4, lastDot=1); String.substring SWAPS start/end when
    // start > end, leaking ".b/" — garbage that even contained a "/".
    //
    // The fix only strips an extension when lastIndexOf(".") > lastIndexOf("/"),
    // i.e. the dot lies in the BASENAME after the last slash. Here it does not,
    // so the extensionless leaf "c" is returned correctly.
    expect(pathToString("a.b/c")).toBe("c");
  });

  it('"foo.bar/baz/qux" -> "qux" : deeper dotted-parent case also returns the bare leaf (FIXED Notidian-uuco)', () => {
    // lastDot is in the FIRST segment, lastSlash is the final boundary. The dot
    // does NOT follow the last slash, so no extension is stripped and the leaf
    // "qux" is returned (previously the arg-swap produced ".bar/baz/").
    expect(pathToString("foo.bar/baz/qux")).toBe("qux");
  });

  // --- regression guard: extensioned leaf inside dotted/deep folders ----------
  it('"A/B/x.md" -> "x" : an extensioned leaf inside nested folders still strips the extension', () => {
    expect(pathToString("A/B/x.md")).toBe("x");
  });

  it('"a.b/x.md" -> "x" : a dotted PARENT plus an extensioned leaf strips only the leaf extension', () => {
    // lastDot (in "x.md") FOLLOWS the last slash, so the extension is correctly
    // stripped, and the parent dot is ignored.
    expect(pathToString("a.b/x.md")).toBe("x");
  });

  // --- empty string ----------------------------------------------------------
  it('"" -> "" : empty string passes through both -1 guards to the final return', () => {
    expect(pathToString("")).toBe("");
  });

  // --- the ordinary "name" preserved when there is genuinely no extension ----
  it('"README" -> "README" : no slash, no dot, returned verbatim', () => {
    expect(pathToString("README")).toBe("README");
  });

  // --- PROPERTY: the result is ALWAYS a leaf name (no "/") --------------------
  // Notidian-uuco fixed the dotted-PARENT arg-swap, so the "no slash in the
  // output" property now holds UNIVERSALLY — including for paths whose only dot
  // lies in a parent folder. The previously-excluded dotted-parent inputs are
  // re-enabled here (they tripped the substring arg-swap bug before the fix).
  it("PROPERTY: the result is always a leaf name (never contains a '/')", () => {
    const allPaths = [
      "a/b.md",
      "a/b",
      "/a",
      "a/.config",
      ".config",
      "a/b.tar.gz",
      "archive.tar.gz",
      "a/",
      "",
      "README",
      "deep/nested/file.txt",
      "x/y/z/",
      "no-extension-file",
      // re-enabled: dotted-PARENT inputs that used to trip the arg-swap bug ----
      "a.b/c",
      "foo.bar/baz/qux",
      "a.b/x.md",
      "A/B/x.md",
      "deep.dir/nested/leaf",
    ];
    for (const x of allPaths) {
      expect(pathToString(x)).not.toContain("/");
    }
  });

  it("the leaf-name property HOLDS for the (formerly bug-leaking) dotted-parent inputs (regression signal for Notidian-uuco)", () => {
    // Before Notidian-uuco the dotted-parent arg-swap leaked a "/" into the
    // output (this assertion was inverted, toContain("/"), pinning the defect).
    // The fix restores the invariant: a display name is a single leaf segment
    // and NEVER contains a slash. If this regresses, the arg-swap is back.
    expect(pathToString("a.b/c")).not.toContain("/");
    expect(pathToString("foo.bar/baz/qux")).not.toContain("/");
  });

  // --- PURITY: always a string, never throws ---------------------------------
  it("PURITY: returns a string and never throws across the documented inputs", () => {
    const inputs = [
      "a/b.md",
      "a/.config",
      ".config",
      "a/b.tar.gz",
      "a/",
      "a.b/c",
      "",
      "README",
      "/",
      "//",
    ];
    for (const x of inputs) {
      expect(typeof pathToString(x)).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// pathNameToString — strip ONLY the extension (keep the folder portion)
//   const pathNameToString = (path) => path.substring(0, path.lastIndexOf(".")) || path;
// The `|| path` fallback is load-bearing. SUBTLE: for an extensionless name
// lastIndexOf(".") is -1, and `String.prototype.substring` CLAMPS a negative
// argument to 0 (it is NOT slice) — so substring(0, -1) === substring(0, 0) ===
// "", which is falsy, so `|| path` ALWAYS fires and returns the input verbatim.
// Consequence: pathNameToString is the IDENTITY function on any path with no
// dot at all (it never trims a trailing char). It only removes a real extension
// when a "." exists. Empirically verified — see the contract cases below.
// ---------------------------------------------------------------------------
describe("pathNameToString", () => {
  it('"README.md" -> "README" : strips the extension', () => {
    expect(pathNameToString("README.md")).toBe("README");
  });

  it('"a.tar.gz" -> "a.tar" : only the LAST dot is the boundary', () => {
    expect(pathNameToString("a.tar.gz")).toBe("a.tar");
  });

  // --- the `|| path` rescue: no extension --> whole string -------------------
  it('"README" -> "README" : NO extension is rescued by the `|| path` fallback (locked contract)', () => {
    // lastIndexOf(".")===-1 -> substring(0, -1). `substring` CLAMPS the negative
    // end to 0, so substring(0,-1) === "" (this is the key difference from
    // `slice`, which WOULD drop the last char). The "" is falsy, so `|| path`
    // returns "README". This rescue is the WHOLE reason an extensionless display
    // name survives intact.
    expect(pathNameToString("README")).toBe("README");
  });

  it('"a" -> "a" : single-char extensionless name still rescued', () => {
    // substring(0,-1) === "" -> falsy -> `|| path` returns "a".
    expect(pathNameToString("a")).toBe("a");
  });

  // --- ADVERSARIAL: a leading-dot file (lastDot===0) -------------------------
  it('".config" -> ".config" : a bare dotfile is rescued by `|| path` (locked)', () => {
    // lastIndexOf(".")===0 -> substring(0,0) === "" -> falsy -> `|| path`
    // returns ".config". Unlike pathToString (which empties it), pathNameToString
    // PRESERVES the dotfile. The two helpers diverge here — locked on both sides.
    expect(pathNameToString(".config")).toBe(".config");
  });

  // --- keeps the folder portion (this helper does NOT drop directories) ------
  it('"a/b.md" -> "a/b" : keeps the folder, strips only the extension', () => {
    expect(pathNameToString("a/b.md")).toBe("a/b");
  });

  it('"a/b" -> "a/b" : extensionless path WITH a folder is returned whole (no char dropped)', () => {
    // lastIndexOf(".")===-1 -> substring(0,-1) === "" (negative end clamps to 0)
    // -> falsy -> `|| path` returns "a/b" verbatim. Crucially this does NOT trim
    // the trailing "b": substring is not slice. So pathNameToString preserves a
    // folder-bearing, dotless path EXACTLY.
    expect(pathNameToString("a/b")).toBe("a/b");
  });

  // --- IDENTITY on dotless input: multi-char names are NOT truncated ----------
  it('"folder/" -> "folder/" : extensionless multi-char input is returned WHOLE (substring(0,-1)==="" — locked)', () => {
    // The intuitive trap is "substring(0,-1) drops the last char" — that is
    // `slice`, not `substring`. substring clamps the negative end to 0, yielding
    // "" -> falsy -> `|| path` returns "folder/" intact. LOCKED to prevent a
    // future refactor from swapping substring->slice and silently truncating.
    expect(pathNameToString("folder/")).toBe("folder/");
  });

  it('"ab" -> "ab" : extensionless two-char input is returned whole (no truncation — locked)', () => {
    // substring(0,-1) === "" -> falsy -> `|| path` returns "ab". Confirms the
    // identity-on-dotless contract for an arbitrary multi-char name.
    expect(pathNameToString("ab")).toBe("ab");
  });

  // --- PROPERTY: pathNameToString is the IDENTITY on any dotless input --------
  it("PROPERTY: a path with NO '.' is returned verbatim (identity on dotless input)", () => {
    const dotless = ["README", "a", "ab", "folder/", "a/b", "deep/nested/leaf", "", "x/y/z/"];
    for (const x of dotless) {
      expect(pathNameToString(x)).toBe(x);
    }
  });

  // --- empty string ----------------------------------------------------------
  it('"" -> "" : empty input -> substring(0,-1)==="" -> `|| path` returns "" (still "")', () => {
    expect(pathNameToString("")).toBe("");
  });

  // --- PURITY ----------------------------------------------------------------
  it("PURITY: returns a string and never throws across the documented inputs", () => {
    const inputs = ["README.md", "README", ".config", "a/b.md", "a/b", "ab", "a", "", "folder/"];
    for (const x of inputs) {
      expect(typeof pathNameToString(x)).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// folderPathToString — reduce a folder path to its LEAF folder name
//   const folderPathToString = (path) =>
//     removeLeadingSlash(path.substring(path.lastIndexOf("/"))) || path;
// substring(lastSlash) INCLUDES the slash itself; removeLeadingSlash drops it.
// The `|| path` rescues the no-slash case (substring(-1) is the WHOLE string,
// removeLeadingSlash is a no-op, result truthy -> returns it) AND the
// trailing-slash case (substring(lastSlash) === "/" -> removeLeadingSlash("")
// === "" -> falsy -> `|| path` returns the WHOLE input). See cases below.
// ---------------------------------------------------------------------------
describe("folderPathToString", () => {
  // --- the bare root: preserved verbatim -------------------------------------
  it('"/" -> "/" : the bare root is preserved (not emptied)', () => {
    // lastIndexOf("/")===0 -> substring(0) === "/" -> removeLeadingSlash("/")
    // === "" -> falsy -> `|| path` returns "/". Root survives via the fallback.
    expect(folderPathToString("/")).toBe("/");
  });

  // --- the ordinary case: leaf folder name -----------------------------------
  it('"a/b" -> "b" : returns the leaf folder name', () => {
    expect(folderPathToString("a/b")).toBe("b");
  });

  it('"deep/nested/leaf" -> "leaf" : last segment of a deep path', () => {
    expect(folderPathToString("deep/nested/leaf")).toBe("leaf");
  });

  // --- no slash at all: the WHOLE string via substring(-1) + `|| path` --------
  it('"foo" -> "foo" : no slash -> whole string returned (substring(-1) then `|| path`)', () => {
    // lastIndexOf("/")===-1 -> substring(-1) === "foo" (negative start clamps to
    // 0) -> removeLeadingSlash("foo") === "foo" -> truthy -> returned as-is.
    expect(folderPathToString("foo")).toBe("foo");
  });

  // --- ADVERSARIAL: a TRAILING slash round-trips to the WHOLE input -----------
  it('"a/b/" -> "a/b/" : a trailing slash makes it return the WHOLE input unchanged (locked latent bug-shape)', () => {
    // lastSlash is the final char -> substring(lastSlash) === "/" ->
    // removeLeadingSlash("/") === "" -> falsy -> `|| path` returns "a/b/".
    // So a folder path WITH a trailing slash does NOT reduce to its leaf; it
    // returns whole. Callers must normalise the trailing slash BEFORE calling
    // (cf. removeTrailingSlashFromFolder) or they get the full path back. LOCKED.
    expect(folderPathToString("a/b/")).toBe("a/b/");
  });

  // --- ADVERSARIAL: empty string -> "" via the `|| path` no-op ----------------
  it('"" -> "" : empty input returns "" (substring(-1)==="" -> falsy -> `|| ""` === "")', () => {
    expect(folderPathToString("")).toBe("");
  });

  // --- single leading-slash segment ------------------------------------------
  it('"/a" -> "a" : a single leading slash yields the leaf "a"', () => {
    // lastSlash=0 -> substring(0) === "/a" -> removeLeadingSlash("/a") === "a".
    expect(folderPathToString("/a")).toBe("a");
  });

  // --- INVARIANT: a non-empty no-trailing-slash result has no leading slash ---
  it("INVARIANT: a leaf result (when a slash is present and not trailing) carries no leading slash", () => {
    // For inputs that DO reduce to a leaf, the leaf never keeps the boundary "/".
    const leafCases: Array<[string, string]> = [
      ["a/b", "b"],
      ["/a", "a"],
      ["deep/nested/leaf", "leaf"],
    ];
    for (const [input, leaf] of leafCases) {
      const out = folderPathToString(input);
      expect(out).toBe(leaf);
      expect(out.startsWith("/")).toBe(false);
    }
  });

  // --- PURITY ----------------------------------------------------------------
  it("PURITY: returns a string and never throws across the documented inputs", () => {
    const inputs = ["/", "a/b", "deep/nested/leaf", "foo", "a/b/", "", "/a"];
    for (const x of inputs) {
      expect(typeof folderPathToString(x)).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// getParentFolderPaths — every ANCESTOR prefix of a path, EXCLUDING the path
// itself. Builds cumulative "a", "a/b", … and pushes each `current` that does
// not equal `path`.
//   for each part: current += (i==0 ? "" : "/") + part; if (current != path) push(current);
// ---------------------------------------------------------------------------
describe("getParentFolderPaths", () => {
  // --- the ordinary case -----------------------------------------------------
  it('"a/b/c" -> ["a","a/b"] : ancestors only, the full path excluded', () => {
    expect(getParentFolderPaths("a/b/c")).toEqual(["a", "a/b"]);
  });

  // --- single segment: NO parents (the only `current` equals `path`) ----------
  it('"single" -> [] : a single segment has no ancestors', () => {
    // The lone `current` ("single") equals `path`, so nothing is pushed.
    expect(getParentFolderPaths("single")).toEqual([]);
  });

  // --- empty string: ["" ] is built but equals path, so [] -------------------
  it('"" -> [] : empty input yields no ancestors', () => {
    // split("") === [""]; current becomes "" which equals path -> not pushed.
    expect(getParentFolderPaths("")).toEqual([]);
  });

  // --- ADVERSARIAL: a LEADING slash injects an empty-string first ancestor ----
  it('"/a/b" -> ["","/a"] : a leading slash produces an EMPTY-STRING first ancestor (locked)', () => {
    // split("/a/b") === ["", "a", "b"]; cumulative -> "", "/a", "/a/b". The full
    // path is excluded; "" and "/a" remain. The empty-string first ancestor is a
    // real, surprising element a caller iterating ancestors must tolerate. LOCKED.
    expect(getParentFolderPaths("/a/b")).toEqual(["", "/a"]);
  });

  // --- ADVERSARIAL: a TRAILING slash collapses the empty trailing segment ----
  it('"a/b/" -> ["a","a/b"] : a trailing slash collapses the empty trailing segment (locked)', () => {
    // split("a/b/") === ["a", "b", ""]; cumulative -> "a", "a/b", "a/b/". The
    // last ("a/b/") equals path and is excluded, leaving exactly ["a","a/b"] —
    // i.e. identical to the no-trailing-slash "a/b" ancestor set for "a/b/c"'s
    // first two. So trailing slash is effectively tolerated here. LOCKED.
    expect(getParentFolderPaths("a/b/")).toEqual(["a", "a/b"]);
  });

  // --- deeper path: full prefix chain minus the leaf -------------------------
  it('"w/x/y/z" -> ["w","w/x","w/x/y"] : full ancestor chain', () => {
    expect(getParentFolderPaths("w/x/y/z")).toEqual(["w", "w/x", "w/x/y"]);
  });

  // --- INVARIANT: the input path itself is NEVER in the output ---------------
  it("INVARIANT: the path itself is never one of its own ancestors", () => {
    const inputs = ["a/b/c", "single", "", "/a/b", "a/b/", "w/x/y/z", "deep/p"];
    for (const p of inputs) {
      expect(getParentFolderPaths(p)).not.toContain(p);
    }
  });

  // --- INVARIANT: ancestors are strictly increasing prefixes -----------------
  it("INVARIANT: each ancestor is a proper prefix of the next (and of the path)", () => {
    const path = "a/b/c/d";
    const parents = getParentFolderPaths(path);
    expect(parents).toEqual(["a", "a/b", "a/b/c"]);
    for (let i = 0; i < parents.length; i++) {
      // Every ancestor is a prefix of the original path string.
      expect(path.startsWith(parents[i])).toBe(true);
      if (i > 0) {
        // …and strictly longer than (a prefix of) the previous one.
        expect(parents[i].startsWith(parents[i - 1])).toBe(true);
        expect(parents[i].length).toBeGreaterThan(parents[i - 1].length);
      }
    }
  });

  // --- INVARIANT: count == (number of "/"-segments) - 1 for slash-terminated -
  it("INVARIANT: a non-empty multi-segment path yields (segments - 1) ancestors when no segment dupes the path", () => {
    expect(getParentFolderPaths("a/b/c").length).toBe(2);
    expect(getParentFolderPaths("a/b/c/d").length).toBe(3);
  });

  // --- PURITY: returns a fresh array, never throws ---------------------------
  it("PURITY: always returns an array of strings and never throws", () => {
    const inputs = ["a/b/c", "single", "", "/a/b", "a/b/", "w/x/y/z"];
    for (const p of inputs) {
      const out = getParentFolderPaths(p);
      expect(Array.isArray(out)).toBe(true);
      for (const seg of out) expect(typeof seg).toBe("string");
    }
  });

  it("PURITY: does not mutate or alias across calls (returns a fresh array each time)", () => {
    const a = getParentFolderPaths("a/b/c");
    const b = getParentFolderPaths("a/b/c");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // distinct array instances
    a.push("MUTATED");
    expect(getParentFolderPaths("a/b/c")).toEqual(["a", "a/b"]); // unaffected
  });
});

// ---------------------------------------------------------------------------
// getParentPathFromString — the parent FOLDER path, KEEPING the trailing slash
//   const getParentPathFromString = (file) => {
//     const i = file.lastIndexOf("/");
//     if (i == -1) return '/';
//     return file.substring(0, i + 1);   // INCLUDES the trailing slash
//   };
// Distinct from getParentFolderPaths (which returns prefixes WITHOUT the
// trailing slash and excludes the leaf) — this returns ONE parent WITH the
// trailing slash, and falls back to the root "/" when there is no slash.
// ---------------------------------------------------------------------------
describe("getParentPathFromString", () => {
  // --- the ordinary case: parent folder WITH trailing slash ------------------
  it('"a/b/c" -> "a/b/" : parent folder including the trailing slash', () => {
    expect(getParentPathFromString("a/b/c")).toBe("a/b/");
  });

  // --- no slash -> root ------------------------------------------------------
  it('"foo" -> "/" : a slash-less name has the root as its parent', () => {
    expect(getParentPathFromString("foo")).toBe("/");
  });

  it('"" -> "/" : empty input -> root (lastIndexOf is -1)', () => {
    expect(getParentPathFromString("")).toBe("/");
  });

  // --- bare root stays root --------------------------------------------------
  it('"/" -> "/" : a bare slash has the root as its parent (substring(0,1)==="/")', () => {
    expect(getParentPathFromString("/")).toBe("/");
  });

  // --- ADVERSARIAL: a path that ALREADY ends in a slash keeps that slash ------
  it('"a/b/" -> "a/b/" : a trailing-slash input returns ITSELF (last slash kept) (locked)', () => {
    // lastIndexOf("/") is the final char index -> substring(0, i+1) is the whole
    // string. So this helper is a FIXED POINT on trailing-slash input. LOCKED:
    // a caller must not assume it strips a level off a folder-style path.
    expect(getParentPathFromString("a/b/")).toBe("a/b/");
  });

  it('"/a" -> "/" : a single leading slash yields the root', () => {
    expect(getParentPathFromString("/a")).toBe("/");
  });

  // --- INVARIANT: the output ALWAYS ends in "/" ------------------------------
  it("INVARIANT: the result always ends in '/' (so 'parent + name' concatenation is safe)", () => {
    const inputs = ["a/b/c", "foo", "", "/", "a/b/", "/a", "deep/nested/file.md", "x"];
    for (const p of inputs) {
      expect(getParentPathFromString(p).endsWith("/")).toBe(true);
    }
  });

  // --- INVARIANT: the result is a (slash-inclusive) prefix of the input, or "/"
  it("INVARIANT: the result is either '/' or a trailing-slash prefix of the input", () => {
    const inputs = ["a/b/c", "deep/nested/file.md", "a/b/", "/a"];
    for (const p of inputs) {
      const parent = getParentPathFromString(p);
      // It is a prefix of the original AND ends in "/".
      expect(p.startsWith(parent) || parent === "/").toBe(true);
      expect(parent.endsWith("/")).toBe(true);
    }
  });

  // --- IDEMPOTENCE-ish: applying it to its own (trailing-slash) output is a
  // fixed point, because the output always ends in "/" -----------------------
  it("the output is a fixed point of a second application (output ends in '/')", () => {
    const inputs = ["a/b/c", "foo", "", "/", "a/b/", "/a"];
    for (const p of inputs) {
      const once = getParentPathFromString(p);
      const twice = getParentPathFromString(once);
      // f(x) ends in "/", so f(f(x)) === f(x) (a trailing-slash path is a fixed
      // point of this helper).
      expect(twice).toBe(once);
    }
  });

  // --- PURITY ----------------------------------------------------------------
  it("PURITY: returns a string and never throws across the documented inputs", () => {
    const inputs = ["a/b/c", "foo", "", "/", "a/b/", "/a"];
    for (const p of inputs) {
      expect(typeof getParentPathFromString(p)).toBe("string");
    }
  });
});

// ===========================================================================
// CROSS-HELPER DIVERGENCE — lock the deliberate disagreements between the two
// extension-stripping helpers so a future "unification" is a conscious choice.
// ===========================================================================
describe("cross-helper divergence (locked)", () => {
  it("pathToString EMPTIES a dotfile but pathNameToString PRESERVES it", () => {
    // The same input '.config' goes two opposite ways. Locking both sides means
    // any attempt to make them agree must touch — and re-justify — this test.
    expect(pathToString(".config")).toBe("");
    expect(pathNameToString(".config")).toBe(".config");
  });

  it("pathToString drops the folder; pathNameToString keeps it", () => {
    expect(pathToString("a/b.md")).toBe("b");
    expect(pathNameToString("a/b.md")).toBe("a/b");
  });
});
