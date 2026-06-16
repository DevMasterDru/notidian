import { excludePathPredicate, excludeSpacesPredicate } from "utils/hide";
import {
  relativeURLRegex,
  emojiRegex,
} from "utils/regex";
import { MakeMDSettings } from "shared/types/settings";

// ===========================================================================
// DEPTH (Q1) — adversarial + characterization tests for the PURE path-visibility
// predicates in src/utils/hide.ts (Notidian-i9d1). Sibling of Notidian-blkq
// (tags.ts).
//
// excludePathPredicate(settings, path) and excludeSpacesPredicate(settings, path)
// decide which files/spaces are HIDDEN from the navigator and database listings
// — a visibility/authority-adjacent surface (ADR 0014 notidian-only engine; the
// authority-partitioned model where the file path owns row identity). A path
// WRONGLY HIDDEN == a silently missing row; a path WRONGLY SHOWN == leaked
// internal storage (the .notidian/'#'-tag/'$'-system spaces this code exists to
// suppress). Both had ZERO co-located coverage. Live callers (verified by grep):
//   - excludePathPredicate: cacheParsers.ts:206, filesystem.ts (obsidian adapter)
//   - excludeSpacesPredicate: filesystemAdapter.ts:198/863
//
// IMPORTANT — CHARACTERIZATION, not correction. Every value asserted here was
// EMPIRICALLY OBSERVED from the current implementation and is LOCKED so any
// future change to path visibility is a conscious, reviewed decision rather than
// a silent regression. Several behaviors are surprising and are flagged inline as
// latent contracts (most notably: a file whose PARENT segment equals
// spaceSubFolder is NOT hidden by the triple-check; the substring-not-suffix
// non-match of endsWith; and the excludePath-vs-excludeSpaces clause divergence).
// They are NOT "fixed" here: per the bead directive and the ADR-0025 posture, a
// TRUE visibility defect gets a SEPARATE decision/follow-up bead (characterize
// first, never fix blind) — real render-path callers may depend on today's exact
// shape.
//
// FIXTURE — only the FIVE consumed MakeMDSettings fields are populated; the rest
// of the (large) interface is irrelevant to these pure predicates, so we cast a
// minimal object. The two predicates DIVERGE on which array they consult for the
// "endsWith" clause (excludePath -> hiddenExtensions; excludeSpaces ->
// skipFolderNames), so the fixture gives those two DISTINCT marker values to make
// the divergence observable.
// ---------------------------------------------------------------------------

const makeSettings = (
  overrides: Partial<
    Pick<
      MakeMDSettings,
      | "hiddenExtensions"
      | "skipFolderNames"
      | "spaceSubFolder"
      | "spacesFolder"
      | "hiddenFiles"
    >
  > = {}
): MakeMDSettings =>
  ({
    hiddenExtensions: [".md"], // consulted ONLY by excludePathPredicate
    skipFolderNames: ["node_modules"], // consulted ONLY by excludeSpacesPredicate
    spaceSubFolder: ".space",
    spacesFolder: "Spaces",
    hiddenFiles: [".obsidian"],
    ...overrides,
  } as MakeMDSettings);

// ===========================================================================
// excludePathPredicate — OR of:
//   (A) hiddenExtensions.some(e => path.endsWith(e))
//    || (B) path.endsWith('/'+spaceSubFolder)
//    || (C) path == spaceSubFolder
//    || (D) path.split('/').pop() == spaceSubFolder         } the TRIPLE check
//   || (E) path.startsWith(spacesFolder + '/#')
//   || (F) hiddenFiles.some(e => path.startsWith(e))
// NOTE: NO '$' clause here (that exists only in excludeSpacesPredicate).
// ===========================================================================
describe("excludePathPredicate", () => {
  // --- clause (A): hiddenExtensions via endsWith -------------------------
  it('".md" extension at the suffix hides the path (clause A)', () => {
    expect(excludePathPredicate(makeSettings(), "notes/todo.md")).toBe(true);
  });

  it('a SUBSTRING-not-suffix extension match is NOT hidden (".md" inside "README.md.txt")', () => {
    // endsWith requires a true suffix; ".md" appears mid-string here, so clause
    // (A) does NOT fire. LOCKED — guards against an accidental switch to
    // includes(). (.txt is not in hiddenExtensions, so the whole predicate is
    // false.)
    expect(excludePathPredicate(makeSettings(), "README.md.txt")).toBe(false);
  });

  it("an empty hiddenExtensions list never matches via clause (A)", () => {
    expect(
      excludePathPredicate(
        makeSettings({ hiddenExtensions: [] }),
        "notes/todo.md"
      )
    ).toBe(false);
  });

  it('excludePathPredicate consults hiddenExtensions, NOT skipFolderNames (divergence)', () => {
    // skipFolderNames=["node_modules"] is INVISIBLE to excludePathPredicate.
    // A trailing "node_modules" is NOT hidden here (it IS in excludeSpaces).
    expect(excludePathPredicate(makeSettings(), "a/node_modules")).toBe(false);
  });

  // --- the spaceSubFolder TRIPLE check, clauses (B) exact-suffix, (C) exact,
  //     (D) basename-pop ----------------------------------------------------
  it('(B) endsWith "/"+spaceSubFolder: "a/.space" is hidden', () => {
    expect(excludePathPredicate(makeSettings(), "a/.space")).toBe(true);
  });

  it('(C) path == spaceSubFolder: bare ".space" (no slash) is hidden', () => {
    // The exact-match clause exists PRECISELY because clause (B) requires a
    // leading "/", so a root-level ".space" would otherwise slip through (B).
    expect(excludePathPredicate(makeSettings(), ".space")).toBe(true);
  });

  it('(D) basename-pop == spaceSubFolder: deep "x/y/.space" is hidden', () => {
    // Here (B) ALSO fires (suffix "/.space"), but (D) is the clause that would
    // still catch a basename match even without the leading-slash form.
    expect(excludePathPredicate(makeSettings(), "x/y/.space")).toBe(true);
  });

  it('ADVERSARIAL — a path whose PARENT equals spaceSubFolder is NOT hidden (".space/child")', () => {
    // The triple-check matches spaceSubFolder as a SUFFIX / EXACT / BASENAME
    // only. When ".space" is an ANCESTOR segment (basename is "child"), none of
    // (B)/(C)/(D) fire. So a file LIVING INSIDE a .space folder is NOT hidden by
    // this predicate's sub-folder clauses — it would only be caught by
    // hiddenFiles (clause F) if ".space" were listed there. LOCKED as the
    // documented gap (a potential leak surface; flag, do not fix blind).
    expect(excludePathPredicate(makeSettings(), ".space/child")).toBe(false);
  });

  it('the basename-pop clause is whole-segment, so "my.space" (no slash) is NOT a match', () => {
    // pop() of "my.space" is "my.space" != ".space"; endsWith("/.space") false;
    // != ".space". A filename that merely ENDS in ".space" but is not exactly the
    // sub-folder segment is NOT hidden. LOCKED.
    expect(excludePathPredicate(makeSettings(), "my.space")).toBe(false);
  });

  it('trailing-slash "a/.space/" pops "" (empty leaf), so the triple-check does NOT match', () => {
    // "a/.space/".split('/').pop() === "" (the empty trailing segment); the
    // path does not end with "/.space"; not exactly ".space". So NONE of the
    // triple-check clauses fire. SURPRISING — LOCKED as characterization.
    expect(excludePathPredicate(makeSettings(), "a/.space/")).toBe(false);
  });

  // --- clause (E): spacesFolder + '/#' prefix ----------------------------
  it('(E) a "#"-prefixed tag space under spacesFolder is hidden ("Spaces/#tag")', () => {
    expect(excludePathPredicate(makeSettings(), "Spaces/#tag")).toBe(true);
  });

  it('the "/#" prefix is anchored at spacesFolder — a "#" ELSEWHERE is NOT hidden', () => {
    // "Other/#tag" does not start with "Spaces/#"; no other clause fires.
    expect(excludePathPredicate(makeSettings(), "Other/#tag")).toBe(false);
  });

  it('excludePathPredicate has NO "$" clause: "Spaces/$sys" is NOT hidden (DIVERGENCE)', () => {
    // This is the key divergence from excludeSpacesPredicate, which DOES add a
    // "Spaces/$" prefix clause. Here a $-system space under spacesFolder leaks
    // through. LOCKED — the asymmetry is intentional per the two call sites.
    expect(excludePathPredicate(makeSettings(), "Spaces/$sys")).toBe(false);
  });

  // --- clause (F): hiddenFiles via startsWith ----------------------------
  it('(F) hiddenFiles PREFIX match: ".obsidian/app.json" is hidden', () => {
    expect(excludePathPredicate(makeSettings(), ".obsidian/app.json")).toBe(
      true
    );
  });

  it('ADVERSARIAL — hiddenFiles is a PREFIX (startsWith), not a contains: "a/.obsidian" is NOT hidden', () => {
    // ".obsidian" appears MID-string, so startsWith(".obsidian") is false and
    // none of the other clauses fire. LOCKED — a nested ".obsidian" is only
    // hidden when it is the path PREFIX. (Contrast the basename-based
    // spaceSubFolder clauses.)
    expect(excludePathPredicate(makeSettings(), "a/.obsidian")).toBe(false);
  });

  // --- the empty path -----------------------------------------------------
  it('empty path "" -> false: no clause fires (".md" no suffix, "" != ".space", pop() is "", no prefixes)', () => {
    // "".endsWith(".md") false; "".endsWith("/.space") false; "" != ".space";
    // "".split('/').pop() === "" != ".space"; "".startsWith("Spaces/#") false;
    // "".startsWith(".obsidian") false. So an empty path is treated as VISIBLE.
    expect(excludePathPredicate(makeSettings(), "")).toBe(false);
  });
});

// ===========================================================================
// excludeSpacesPredicate — OR of:
//   (A') skipFolderNames.some(e => path.endsWith(e))   <-- NOT hiddenExtensions
//    || (B) path.endsWith('/'+spaceSubFolder)
//    || (C) path == spaceSubFolder
//    || (D) path.split('/').pop() == spaceSubFolder       } same TRIPLE check
//   || (E) path.startsWith(spacesFolder + '/#')
//   || (E$) path.startsWith(spacesFolder + '/$')        <-- EXTRA clause
//   || (F) hiddenFiles.some(e => path.startsWith(e))
//
// Differs from excludePathPredicate in exactly TWO ways:
//   1. the endsWith clause consults skipFolderNames (not hiddenExtensions)
//   2. it has the EXTRA spacesFolder+'/$' prefix clause
// ===========================================================================
describe("excludeSpacesPredicate", () => {
  // --- clause (A'): skipFolderNames via endsWith (the divergence) --------
  it("(A') consults skipFolderNames: trailing \"node_modules\" is hidden", () => {
    expect(excludeSpacesPredicate(makeSettings(), "a/node_modules")).toBe(true);
  });

  it('(A\') does NOT consult hiddenExtensions: a trailing ".md" is NOT hidden here (DIVERGENCE)', () => {
    // hiddenExtensions=[".md"] is INVISIBLE to excludeSpacesPredicate, which
    // only ends-with-tests skipFolderNames. So "a/foo.md" is NOT a space-exclude
    // (the inverse of excludePathPredicate). LOCKED — the two predicates use
    // DIFFERENT arrays for their endsWith clause by design.
    expect(excludeSpacesPredicate(makeSettings(), "a/foo.md")).toBe(false);
  });

  // --- the shared spaceSubFolder triple-check (same as excludePath) ------
  it("(B) suffix \"/.space\": \"a/.space\" is hidden", () => {
    expect(excludeSpacesPredicate(makeSettings(), "a/.space")).toBe(true);
  });

  it('(C) exact bare ".space" is hidden', () => {
    expect(excludeSpacesPredicate(makeSettings(), ".space")).toBe(true);
  });

  it('(D) basename-pop "x/y/.space" is hidden', () => {
    expect(excludeSpacesPredicate(makeSettings(), "x/y/.space")).toBe(true);
  });

  it('ADVERSARIAL — PARENT-equals-sub ".space/child" is NOT hidden (same gap as excludePath)', () => {
    expect(excludeSpacesPredicate(makeSettings(), ".space/child")).toBe(false);
  });

  // --- clause (E) and the EXTRA clause (E$) ------------------------------
  it('(E) "#"-prefixed space under spacesFolder is hidden ("Spaces/#tag")', () => {
    expect(excludeSpacesPredicate(makeSettings(), "Spaces/#tag")).toBe(true);
  });

  it('(E$) THE EXTRA "$" CLAUSE: "Spaces/$sys" IS hidden here (vs leaked by excludePath)', () => {
    // This is the clause excludePathPredicate lacks. A $-system space under
    // spacesFolder is suppressed from the space listing. LOCKED as the
    // characterizing difference between the two predicates.
    expect(excludeSpacesPredicate(makeSettings(), "Spaces/$sys")).toBe(true);
  });

  it('the "$" prefix is anchored at spacesFolder — "$" ELSEWHERE is NOT hidden', () => {
    expect(excludeSpacesPredicate(makeSettings(), "Other/$sys")).toBe(false);
  });

  // --- clause (F): hiddenFiles via startsWith ----------------------------
  it('(F) hiddenFiles prefix ".obsidian/x" is hidden; mid-string "a/.obsidian" is not', () => {
    expect(excludeSpacesPredicate(makeSettings(), ".obsidian/x")).toBe(true);
    expect(excludeSpacesPredicate(makeSettings(), "a/.obsidian")).toBe(false);
  });

  it('empty path "" -> false', () => {
    expect(excludeSpacesPredicate(makeSettings(), "")).toBe(false);
  });
});

// ===========================================================================
// DIRECT DIVERGENCE matrix — the same path through BOTH predicates, asserting
// the two intentional differences side by side (the load-bearing contrast).
// ===========================================================================
describe("excludePath vs excludeSpaces divergence (LOCKED contrast)", () => {
  it('a trailing hiddenExtension (".md") hides only via excludePath; a trailing skipFolderName ("node_modules") only via excludeSpaces', () => {
    const s = makeSettings();
    // ".md" path: excludePath hides (hiddenExtensions), excludeSpaces does not.
    expect(excludePathPredicate(s, "a/foo.md")).toBe(true);
    expect(excludeSpacesPredicate(s, "a/foo.md")).toBe(false);
    // "node_modules" path: excludeSpaces hides (skipFolderNames), excludePath not.
    expect(excludePathPredicate(s, "a/node_modules")).toBe(false);
    expect(excludeSpacesPredicate(s, "a/node_modules")).toBe(true);
  });

  it('the "$"-system space under spacesFolder is leaked by excludePath but hidden by excludeSpaces', () => {
    const s = makeSettings();
    expect(excludePathPredicate(s, "Spaces/$sys")).toBe(false); // leaked
    expect(excludeSpacesPredicate(s, "Spaces/$sys")).toBe(true); // hidden
  });

  it('the shared clauses agree: "/.space" suffix, "Spaces/#" tag prefix, and hiddenFiles prefix hide in BOTH', () => {
    const s = makeSettings();
    for (const p of ["a/.space", "Spaces/#tag", ".obsidian/app.json"]) {
      expect(excludePathPredicate(s, p)).toBe(true);
      expect(excludeSpacesPredicate(s, p)).toBe(true);
    }
  });
});

// ===========================================================================
// COMPANION (optional, cheap) — characterize src/utils/regex.ts exports.
// These are pure module-level constants. Two are stateful at runtime because of
// the `/g` flag (lastIndex persists across calls on the SAME RegExp instance),
// which is a real reuse hazard for any caller doing repeated `.test()`.
// ===========================================================================
describe("regex.ts — relativeURLRegex", () => {
  // relativeURLRegex = /^[a-zA-Z0-9][^\\:|<>"*?]*$/g
  // Anchored: must START with an alnum, then any chars EXCEPT \ : | < > " * ?,
  // to end-of-string. NOTE the reject-set does NOT include "/", so slashes pass.

  // Each test resets lastIndex first because the /g flag makes the instance
  // stateful (see the dedicated hazard test below).
  const matches = (s: string): boolean => {
    relativeURLRegex.lastIndex = 0;
    return relativeURLRegex.test(s);
  };

  it("accepts a simple alnum-led name", () => {
    expect(matches("notes")).toBe(true);
  });

  it("accepts a LEADING DIGIT (char class is [a-zA-Z0-9])", () => {
    expect(matches("1file")).toBe(true);
  });

  it("rejects a leading non-alnum (underscore, dot, slash, space)", () => {
    expect(matches("_x")).toBe(false);
    expect(matches(".x")).toBe(false);
    expect(matches("/x")).toBe(false);
    expect(matches(" x")).toBe(false);
  });

  it("rejects the empty string (needs at least the leading alnum)", () => {
    expect(matches("")).toBe(false);
  });

  it('REJECT-SET: each of \\ : | < > " * ? makes a path NON-matching', () => {
    // These are the Windows/cross-platform illegal path characters the regex
    // screens out. Every one, when present after a valid leading alnum, fails.
    for (const bad of ["\\", ":", "|", "<", ">", '"', "*", "?"]) {
      expect(matches("a" + bad + "b")).toBe(false);
    }
  });

  it('ADVERSARIAL — "/" is NOT in the reject-set, so "a/b/c" MATCHES (slashes are allowed)', () => {
    // The character class is [^\\:|<>"*?] — note the absence of "/". A relative
    // path WITH directory separators is accepted. LOCKED (callers must not
    // assume this rejects nested paths).
    expect(matches("a/b/c")).toBe(true);
  });

  it("allows interior spaces after the leading alnum", () => {
    expect(matches("a b")).toBe(true);
  });
});

describe("regex.ts — relativeURLRegex /g lastIndex reuse HAZARD", () => {
  it("re-testing the SAME string on the SAME instance alternates true/false (stateful /g)", () => {
    // The /g flag means a successful .test() leaves lastIndex at the end of the
    // match; the next .test() on the SAME string starts from there, fails to
    // re-anchor at ^, returns false, and resets lastIndex to 0 — so a THIRD call
    // succeeds again. A caller that reuses this module-level instance across
    // calls WITHOUT resetting lastIndex gets inconsistent results.
    relativeURLRegex.lastIndex = 0;
    const first = relativeURLRegex.test("abc"); // true, lastIndex -> 3
    const second = relativeURLRegex.test("abc"); // false, lastIndex -> 0
    const third = relativeURLRegex.test("abc"); // true again
    expect([first, second, third]).toEqual([true, false, true]);
    relativeURLRegex.lastIndex = 0; // restore for any other consumer
  });

  it("after a SUCCESSFUL test, lastIndex advances to the match end (non-zero)", () => {
    relativeURLRegex.lastIndex = 0;
    relativeURLRegex.test("hello");
    expect(relativeURLRegex.lastIndex).toBe(5);
    relativeURLRegex.lastIndex = 0;
  });

  it("after a FAILED test, lastIndex is reset to 0", () => {
    relativeURLRegex.lastIndex = 0;
    relativeURLRegex.test("a:b"); // fails (":" in reject-set)
    expect(relativeURLRegex.lastIndex).toBe(0);
  });
});

describe("regex.ts — emojiRegex surrogate/BMP ranges", () => {
  // emojiRegex = /(©|®|[ -㌀]|\ud83c[퀀-\udfff]|
  //               \ud83d[퀀-\udfff]|\ud83e[퀀-\udfff])/g
  const has = (s: string): boolean => {
    emojiRegex.lastIndex = 0;
    return emojiRegex.test(s);
  };

  it("matches the explicit © (U+00A9) and ® (U+00AE)", () => {
    expect(has("©")).toBe(true);
    expect(has("®")).toBe(true);
  });

  it("matches the BMP symbol range U+2000–U+3300 (e.g. ☀ U+2600)", () => {
    expect(has("☀")).toBe(true);
    expect(has(" ")).toBe(true); // lower bound
    expect(has("㌀")).toBe(true); // upper bound
  });

  it("matches astral emoji via the \\ud83c–\\ud83e high-surrogate alternatives", () => {
    // "😀" === "😀" (U+1F600) -> matched by the \ud83d[...] branch.
    expect(has("😀")).toBe(true);
    // "🤖" === "🤖" (U+1F916) -> matched by the \ud83e[...] branch.
    expect(has("🤖")).toBe(true);
    // "🌀" === "🌀" (U+1F300) -> matched by the \ud83c[...] branch.
    expect(has("🌀")).toBe(true);
  });

  it("does NOT match plain ASCII letters/digits", () => {
    expect(has("A")).toBe(false);
    expect(has("7")).toBe(false);
    expect(has("plain text")).toBe(false);
  });

  it('ADVERSARIAL — a BARE high surrogate \\ud83d ALONE matches via the BMP range branch', () => {
    // The lead-surrogate code unit \ud83d (U+D83D) falls INSIDE the
    // [ -㌀]? No — D83D > 3300. But the alternation \ud83d[퀀-\udfff]
    // needs a FOLLOWING low surrogate. A lone \ud83d has nothing after it, so it
    // does NOT match. LOCKED: an unpaired high surrogate is NOT treated as emoji.
    expect(has("\ud83d")).toBe(false);
  });
});
