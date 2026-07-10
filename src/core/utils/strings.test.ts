import {
  removeLeadingSlash,
  pathToParentPath,
  ensureArray,
  ensureString,
  ensureBoolean,
  indexOfCharElseEOS,
  wrapQuotes,
  removeQuotes,
} from "core/utils/strings";

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

// ===========================================================================
// DEPTH (Notidian-35ki) — characterization + property net for the remaining
// six foundation utilities in src/core/utils/strings.ts:
//
//   ensureArray, ensureString, ensureBoolean, indexOfCharElseEOS,
//   wrapQuotes, removeQuotes
//
// These compose into load-bearing data-pipeline call sites — e.g.
// parseMultiString (src/utils/parsers.ts) chains ensureString + ensureArray;
// parseLinkString relies on indexOfCharElseEOS to slice a wikilink alias;
// frame-prop/style read-modify-write round trips (ast.ts, htmlToTree.ts,
// mdToTree.ts, FrameNodeEditor.tsx and its Submenus) chain removeQuotes/
// wrapQuotes on every frame node prop and style edit; spaces.ts coerces
// persisted view-state flags through ensureBoolean. Each function was
// previously ZERO-coverage.
//
// IMPORTANT — CHARACTERIZATION, not correction, exactly as this file's
// existing suites practice: every assertion below was EMPIRICALLY VERIFIED
// against the current implementation (via a throwaway node repro of the
// exact source lines) before being written down. Several behaviors are
// surprising and are flagged "LOCKED" — they are pinned as-is; a genuine
// defect found along the way is filed as a separate follow-up bead rather
// than silently "fixed" under this DEPTH bead.
//
// Offline note: same as the existing suite above, the makemd-core
// `Superstate` import at the top of strings.ts is type-only/erased, so this
// module is fully offline-importable under jest; no DOM/vault dependency.
// ===========================================================================

// ---------------------------------------------------------------------------
// ensureString — coerce to a string, with falsy -> "" as the FIRST check
// (this runs BEFORE the typeof check, so falsy non-strings like 0/NaN/false
// never reach .toString() and always come back as "").
// ---------------------------------------------------------------------------
describe("ensureString", () => {
  it("passes a non-empty string through unchanged (same value)", () => {
    expect(ensureString("foo")).toBe("foo");
  });

  it("returns the empty string for an empty-string input", () => {
    expect(ensureString("")).toBe("");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["0", 0],
    ["NaN", NaN],
    ["false", false],
  ])("LOCKED: falsy non-string %s coerces to '' (never reaches .toString())", (_label, v) => {
    expect(ensureString(v)).toBe("");
  });

  it("LOCKED: a TRUTHY boolean goes through .toString(), not string(false)-style formatting", () => {
    // `true` is truthy, so it skips the `!value` branch and hits
    // `value.toString()` -> the string "true". (Contrast ensureString(false)
    // above, which is falsy and short-circuits to "" WITHOUT ever calling
    // .toString() -- so the two booleans take genuinely different code paths.)
    expect(ensureString(true)).toBe("true");
  });

  it("coerces a number via .toString()", () => {
    expect(ensureString(123)).toBe("123");
  });

  it("coerces an array via Array.prototype.toString() (comma-joined)", () => {
    expect(ensureString([1, 2, 3])).toBe("1,2,3");
  });

  it("coerces a plain object via Object.prototype.toString()", () => {
    expect(ensureString({})).toBe("[object Object]");
  });

  it("returns the SAME reference for a string passthrough (no copy)", () => {
    const s = "identity-check";
    expect(ensureString(s)).toBe(s);
  });
});

describe("ensureString — properties", () => {
  it("always returns a string, for any input shape", () => {
    const inputs: unknown[] = [
      undefined, null, 0, 1, -1, NaN, false, true, "", "x",
      [1, 2], {}, { a: 1 }, [], new Date(0),
    ];
    for (const v of inputs) {
      expect(typeof ensureString(v)).toBe("string");
    }
  });

  it("every non-empty string input is returned verbatim (fixpoint)", () => {
    const strings = ["a", "foo bar", "  ", "0", "false", "null", "[]"];
    for (const s of strings) {
      expect(ensureString(s)).toBe(s);
    }
  });

  it("is idempotent once a value has been coerced to a string", () => {
    const inputs: unknown[] = [undefined, null, 0, false, 123, true, [1, 2], {}];
    for (const v of inputs) {
      const once = ensureString(v);
      expect(ensureString(once)).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// ensureArray — Array passthrough; a STRING (including "") wraps to [value];
// everything else non-array (numbers, booleans, plain objects, null,
// undefined) collapses to [], it is NOT wrapped as [value].
// ---------------------------------------------------------------------------
describe("ensureArray", () => {
  it("returns the SAME array reference for an array input (no copy)", () => {
    const arr = [1, 2, 3];
    expect(ensureArray(arr)).toBe(arr);
  });

  it("passes an empty array through unchanged", () => {
    const arr: unknown[] = [];
    expect(ensureArray(arr)).toBe(arr);
  });

  it("wraps a non-empty string into a single-element array", () => {
    expect(ensureArray("foo")).toEqual(["foo"]);
  });

  it("LOCKED: wraps an EMPTY string into [''], not []", () => {
    // typeof "" === "string" is checked BEFORE the fallback `return []`, so
    // an empty string does not collapse the way null/undefined do below.
    expect(ensureArray("")).toEqual([""]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("coerces %s to an empty array", (_label, v) => {
    expect(ensureArray(v)).toEqual([]);
  });

  it("LOCKED: a non-string, non-array scalar (number) collapses to [], NOT [value]", () => {
    // This is the non-obvious contract: only Array and string inputs are
    // preserved/wrapped. A bare number, boolean, or plain object does NOT
    // become a single-element array -- it is silently dropped to [].
    expect(ensureArray(5)).toEqual([]);
  });

  it("LOCKED: a plain object collapses to [], NOT [value]", () => {
    expect(ensureArray({ a: 1 })).toEqual([]);
  });

  it("LOCKED: a boolean collapses to [], NOT [value]", () => {
    expect(ensureArray(true)).toEqual([]);
  });
});

describe("ensureArray — properties", () => {
  it("always returns an array, for any input shape", () => {
    const inputs: unknown[] = [
      undefined, null, 0, 1, NaN, false, true, "", "x",
      [1, 2], {}, [],
    ];
    for (const v of inputs) {
      expect(Array.isArray(ensureArray(v))).toBe(true);
    }
  });

  it("result length is at most 1 UNLESS the input was already a (possibly longer) array", () => {
    const nonArrayInputs: unknown[] = [undefined, null, 0, 1, false, true, "", "x", {}];
    for (const v of nonArrayInputs) {
      expect(ensureArray(v).length).toBeLessThanOrEqual(1);
    }
    expect(ensureArray([1, 2, 3, 4]).length).toBe(4);
  });

  it("is idempotent for array inputs (ensureArray(ensureArray(x)) === ensureArray(x))", () => {
    const arrays = [[], [1], [1, 2, 3], ["a", "b"]];
    for (const a of arrays) {
      expect(ensureArray(ensureArray(a))).toBe(ensureArray(a));
    }
  });
});

// ---------------------------------------------------------------------------
// ensureBoolean — a strict `false`/`true` coercion. NOTE: the truthy branch
// returns the LITERAL boolean `true`, not the original value -- there is no
// "passthrough" of a truthy input, only a normalize-to-strict-boolean.
// ---------------------------------------------------------------------------
describe("ensureBoolean", () => {
  it.each([
    ["0", 0],
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["false", false],
    ["NaN", NaN],
  ])("falsy %s coerces to false", (_label, v) => {
    expect(ensureBoolean(v)).toBe(false);
  });

  it.each([
    ["true", true],
    ["1", 1],
    ["empty array", []],
    ["empty object", {}],
  ])("truthy %s coerces to true", (_label, v) => {
    expect(ensureBoolean(v)).toBe(true);
  });

  it("LOCKED: a non-empty string that spells out a falsy word is still TRUTHY input -> true", () => {
    // JS truthiness, not semantic parsing: any non-empty string is truthy,
    // so the string "false" (or "0") coerces to boolean true, not false.
    // Callers must not pass a stringified boolean expecting semantic parsing.
    expect(ensureBoolean("false")).toBe(true);
    expect(ensureBoolean("0")).toBe(true);
  });
});

describe("ensureBoolean — properties", () => {
  it("always returns a strict boolean, for any input shape", () => {
    const inputs: unknown[] = [
      undefined, null, 0, 1, -1, NaN, false, true, "", "x", "false",
      [], [1], {}, { a: 1 },
    ];
    for (const v of inputs) {
      expect(typeof ensureBoolean(v)).toBe("boolean");
    }
  });

  it("is idempotent (ensureBoolean(ensureBoolean(x)) === ensureBoolean(x))", () => {
    const inputs: unknown[] = [undefined, null, 0, 1, false, true, "", "x", [], {}];
    for (const v of inputs) {
      const once = ensureBoolean(v);
      expect(ensureBoolean(once)).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// indexOfCharElseEOS — index of the first occurrence of `char` in `str`, or
// str.length if not found. LOCKED QUIRK: the guard is `> 0`, NOT `>= 0`, so a
// match AT INDEX 0 is treated the same as "not found" and falls through to
// str.length rather than returning 0.
// ---------------------------------------------------------------------------
describe("indexOfCharElseEOS", () => {
  it("returns the index of a char found in the middle of the string", () => {
    expect(indexOfCharElseEOS("|", "ab|cd")).toBe(2);
  });

  it("returns str.length when the char is not present", () => {
    expect(indexOfCharElseEOS("|", "abcd")).toBe(4);
  });

  it("returns the FIRST occurrence's index when the char repeats", () => {
    expect(indexOfCharElseEOS("|", "a|b|c")).toBe(1);
  });

  it("LOCKED: a match AT INDEX 0 is treated as not-found (`> 0`, not `>= 0`) -> str.length", () => {
    // parseLinkString (src/utils/parsers.ts) calls
    // indexOfCharElseEOS("|", match[1]) to find a wikilink's alias pipe.
    // If the searched-for char is the very FIRST character, this returns
    // the whole string's length instead of 0 -- so a leading "|" is NOT
    // treated as an immediate split point.
    expect(indexOfCharElseEOS("|", "|abcd")).toBe(5);
  });

  it("returns 0 for an empty string (not-found, length is 0)", () => {
    expect(indexOfCharElseEOS("|", "")).toBe(0);
  });

  it("LOCKED: an empty-string `char` needle also falls to str.length (indexOf('') is always 0, never > 0)", () => {
    // "".indexOf-style matching: str.indexOf("") === 0 for any str, and
    // 0 > 0 is false, so this hits the same "not found" fallback as a
    // genuinely absent char.
    expect(indexOfCharElseEOS("", "abc")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// wrapQuotes — wrap a string in `"..."`, escaping embedded `"` and `\n`.
// Falsy input (including 0 and "") maps to `null`, NOT to `'""'` or `""`.
// ---------------------------------------------------------------------------
describe("wrapQuotes", () => {
  it("wraps a plain string in double quotes", () => {
    expect(wrapQuotes("hello")).toBe(`"hello"`);
  });

  it("escapes embedded double quotes with a backslash", () => {
    expect(wrapQuotes('say "hi"')).toBe(`"say \\"hi\\""`);
  });

  it("escapes embedded newlines as the literal two-char sequence \\n", () => {
    expect(wrapQuotes("line1\nline2")).toBe(`"line1\\nline2"`);
  });

  it.each([
    ["empty string", ""],
    ["null", null as unknown as string],
    ["undefined", undefined as unknown as string],
  ])("returns null for falsy input (%s), not an empty-quote string", (_label, v) => {
    expect(wrapQuotes(v)).toBeNull();
  });
});

describe("wrapQuotes / removeQuotes — round-trip properties", () => {
  // CONTRACT (Notidian-shrl): wrapQuotes and removeQuotes are a MATCHED
  // encode/decode pair used across the frame-prop + style pipeline (ast.ts,
  // htmlToTree.ts, mdToTree.ts, showFramePropsMenu.tsx, FrameNodeEditor.tsx +
  // Submenus, SuperCell/ParameterSetter.tsx). The spec of a matched wrap/unwrap
  // pair is round-trip identity: removeQuotes(wrapQuotes(s)) === s. This block
  // formerly LOCKED two round-trip DEFECTS as characterization; both are now
  // fixed, so it asserts identity instead:
  //   (a) trailing-quote — removeQuotes' second "trailing semicolon quote"
  //       strip used to fire whenever the unwrapped content coincidentally
  //       ended in a quote/apostrophe (e.g. an escaped closing quote) rather
  //       than only when the ORIGINAL wrapped string actually carried a
  //       trailing ';', eating a real character.
  //   (b) embedded-newline — wrapQuotes escapes a real newline as the literal
  //       two-char sequence \n, but removeQuotes had no matching \n -> newline
  //       unescape, so newlines came back as literal backslash-n.
  const roundTripSamples = [
    "hello",
    "hello world",
    'with "a quote" in the middle',
    "trailing space ",
    "semi;colon",
    "123",
    "true",
    'say "hi"', // ENDS in a literal double-quote char (defect a)
    'ends with one quote"', // single trailing quote char
    '"wrapped in real quotes"', // literal quote chars at BOTH ends
    "line1\nline2", // one embedded real newline (defect b)
    "a\nb\nc", // multiple embedded real newlines
    "\n", // a lone real newline
    'q"\nq"', // combined embedded quote + newline
    "just;a;value;with;semis", // interior semicolons must NOT trip the ';' strip
    "a\\b", // a lone literal backslash (Notidian-qp1k: now escaped, so injective)
    "foo\\nbar", // LITERAL backslash+n — distinct from the real newline above
    "C:\\notes", // a Windows-style path (literal backslash+n) in frame text
    "\\\\server\\share", // a UNC path: leading + interior literal backslashes
    "back\\\\slashes", // an already-doubled backslash pair round-trips too
  ];

  it("removeQuotes(wrapQuotes(s)) === s for every representative value", () => {
    for (const s of roundTripSamples) {
      expect(removeQuotes(wrapQuotes(s) as string)).toBe(s);
    }
  });

  it("a value ENDING in a literal double-quote char now round-trips (defect a fixed)", () => {
    // wrapQuotes('say "hi"') -> `"say \"hi\""`. removeQuotes strips the outer
    // wrap to `say \"hi\"`; the old code, seeing it still ends in a quote,
    // re-stripped that escaped closing quote and returned 'say "hi\' (stray
    // backslash, one surviving quote). The hadSemicolon guard means the second
    // strip no longer fires here, so the original is restored exactly.
    const original = 'say "hi"';
    const wrapped = wrapQuotes(original);
    expect(wrapped).toBe(`"say \\"hi\\""`);
    expect(removeQuotes(wrapped as string)).toBe(original);
  });

  it("embedded newlines now round-trip (defect b fixed)", () => {
    // wrapQuotes still escapes each real newline as the literal two chars \n ...
    const original = "multi\nline\nvalue";
    const wrapped = wrapQuotes(original);
    expect(wrapped).toBe(`"multi\\nline\\nvalue"`);
    // ... and removeQuotes now reverses that escape back to real newlines.
    expect(removeQuotes(wrapped as string)).toBe(original);
  });

  it("ADVERSARIAL: a genuine trailing ';' still strips, but a quote-ending value WITHOUT ';' does not", () => {
    // The two shapes the second-strip guard must keep distinct:
    //   - a real CSS-style trailing semicolon: strip the ';' AND its quote.
    expect(removeQuotes(`"value";`)).toBe("value");
    expect(removeQuotes(`'value';`)).toBe("value");
    //   - a value whose content merely ENDS in a quote char (no ';'): keep it.
    //     wrapQuotes('a"') === `"a\""`; the trailing quote must survive decode.
    expect(wrapQuotes('a"')).toBe(`"a\\""`);
    expect(removeQuotes(wrapQuotes('a"') as string)).toBe('a"');
    expect(removeQuotes(`"a\\""`)).toBe('a"');
  });

  it("ADVERSARIAL: multiple embedded newlines (incl. leading/adjacent) all round-trip", () => {
    const original = "\na\n\nb\n";
    expect(removeQuotes(wrapQuotes(original) as string)).toBe(original);
  });

  it("ADVERSARIAL: a combined embedded quote + newline value round-trips", () => {
    const original = 'he said "hi"\nthen left';
    expect(removeQuotes(wrapQuotes(original) as string)).toBe(original);
  });

  it("ROOT FIX (Notidian-qp1k): a LITERAL backslash-n now round-trips EXACTLY", () => {
    // wrapQuotes escapes the raw backslash FIRST (\ -> \\), so a value literally
    // containing the two chars backslash+n encodes as \\n — DISTINCT from a real
    // newline (which still encodes as \n). removeQuotes' single-pass decode
    // consumes the escaped backslash as a unit and restores the literal, so the
    // value the Notidian-shrl fix used to corrupt (e.g. a Windows path 'C:\notes'
    // in a frame text prop) is now preserved byte-for-byte. This CLOSES the
    // non-injectivity rather than merely swapping which preimage is corrupted.
    const literalBackslashN = "foo\\nbar"; // 8 chars: f o o \ n b a r (NOT a newline)
    const wrapped = wrapQuotes(literalBackslashN);
    // backslash escaped -> \\n, so the encoded form now has a DOUBLED backslash.
    expect(wrapped).toBe(`"foo\\\\nbar"`);
    const back = removeQuotes(wrapped as string);
    expect(back).toBe(literalBackslashN); // exact round-trip: in === out
    // ...and the literal-backslash-n encoding is now DISTINCT from the
    // real-newline encoding (the two preimages no longer collide).
    expect(wrapQuotes("foo\nbar")).toBe(`"foo\\nbar"`);
    expect(wrapQuotes("foo\nbar")).not.toBe(wrapped);
  });

  it("COMPAT (Notidian-qp1k): legacy pre-fix payloads with UNescaped backslashes decode one-shorter (documented, not migrated)", () => {
    // Frame payloads serialized by the OLD wrapQuotes (which never escaped `\`)
    // stored raw backslashes. Decoding such LEGACY data with the new single-pass
    // reverser collapses a literal double-backslash to one, and a legacy raw "\n"
    // still decodes to a newline (unchanged from before). There is no clean
    // old/new discriminator and backslash-bearing frame text is rare, so this
    // bounded one-time edge is ACCEPTED (pinned here) rather than data-migrated.
    //
    // Legacy-encoded UNC path (old wrapQuotes left the two backslashes raw):
    //   stored bytes: " \ \ s e r v e r "  -> decodes to  \ s e r v e r
    expect(removeQuotes(`"\\\\server"`)).toBe("\\server"); // one backslash shorter
    // Legacy-encoded Windows path (old wrapQuotes left the backslash raw):
    //   stored bytes: " C : \ n o t e s "  -> the raw \n decodes to a newline
    //   (this specific corruption is PRE-EXISTING — the old decode did it too).
    expect(removeQuotes(`"C:\\notes"`)).toBe("C:\notes");
  });
});

// ---------------------------------------------------------------------------
// removeQuotes — strip a matching outer quote pair (optionally followed by a
// semicolon), restoring escaped `\"` to `"`. Falsy input (including "", null,
// undefined) is returned UNCHANGED (not coerced to ""), unlike ensureString.
// ---------------------------------------------------------------------------
describe("removeQuotes", () => {
  it("unwraps a double-quoted value", () => {
    expect(removeQuotes(`"hello"`)).toBe("hello");
  });

  it("unwraps a double-quoted value with a trailing semicolon", () => {
    expect(removeQuotes(`"hello";`)).toBe("hello");
  });

  it("unwraps a single-quoted value", () => {
    expect(removeQuotes(`'hello'`)).toBe("hello");
  });

  it("unwraps a single-quoted value with a trailing semicolon", () => {
    expect(removeQuotes(`'hello';`)).toBe("hello");
  });

  it("restores an escaped double quote embedded mid-string", () => {
    expect(removeQuotes(`"say \\"hi\\" now"`)).toBe('say "hi" now');
  });

  it("passes an unquoted value through unchanged", () => {
    expect(removeQuotes("hello")).toBe("hello");
  });

  it.each([
    ["empty string", ""],
    ["null", null as unknown as string],
    ["undefined", undefined as unknown as string],
  ])("LOCKED: falsy input (%s) is returned AS-IS, not coerced to ''", (_label, v) => {
    expect(removeQuotes(v)).toBe(v);
  });

  it("LOCKED: a truthy NUMBER at runtime is coerced via .toString() (dead-per-TS-types but reachable at runtime)", () => {
    // The exported signature says `(s: string)`, but real call sites hand it
    // an untyped/any-typed frame prop value (e.g.
    // showFramePropsMenu.tsx: removeQuotes(frameProps[field.name])), so a
    // number can reach this function at runtime. Cast through `any` to
    // exercise that live path directly.
    expect(removeQuotes(42 as unknown as string)).toBe("42");
  });

  it("LOCKED: a FALSY number (0) short-circuits on `!s` BEFORE the numeric branch, returning 0 itself", () => {
    // `!s` is checked first, and 0 is falsy, so `typeof s === 'number'` is
    // never reached for 0 -- unlike 42 above, it comes back as the raw
    // number 0, not the string "0".
    expect(removeQuotes(0 as unknown as string)).toBe(0);
  });

  it("passes an asymmetrically-quoted value through unchanged (only a leading quote)", () => {
    expect(removeQuotes(`"hello`)).toBe(`"hello`);
  });

  it("passes an asymmetrically-quoted value through unchanged (only a trailing quote)", () => {
    expect(removeQuotes(`hello"`)).toBe(`hello"`);
  });

  it("a lone single-character double-quote string passes through unchanged", () => {
    // startsWith('"') and endsWith('"') are both trivially true for the
    // single-char string `"`, so it enters the matched-pair branch, but
    // substring(1, 0) clamps back to substring(0, 1) = `"`. Since there was NO
    // trailing ';', the guarded second strip does NOT fire, so it comes back
    // unchanged. (Before the Notidian-shrl double-strip fix this spuriously
    // collapsed to ''. wrapQuotes never emits a bare quote, so this is a
    // decode-only edge case with no round-trip consumer.)
    expect(removeQuotes(`"`)).toBe(`"`);
  });

  it("passes a bare semicolon through unchanged (no quote pattern matched)", () => {
    expect(removeQuotes(";")).toBe(";");
  });
});

describe("removeQuotes — properties", () => {
  it("never THROWS for any falsy/typed input", () => {
    const inputs: unknown[] = ["", null, undefined, 0, "hello", `"hello"`, `'hi';`];
    for (const v of inputs) {
      expect(() => removeQuotes(v as string)).not.toThrow();
    }
  });

  it("an unquoted string with no escaped-quote sequences is always a no-op", () => {
    const samples = ["hello", "foo bar baz", "123", "no-quotes-here;"];
    for (const s of samples) {
      expect(removeQuotes(s)).toBe(s);
    }
  });
});
