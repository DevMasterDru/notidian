import {
  getAllParentTags,
  validateName,
  ensureTag,
  stringFromTag,
  tagToTagPath,
  tagPathToTag,
  getAllSubtags,
} from "utils/tags";
import { Superstate } from "makemd-core";

// ===========================================================================
// DEPTH (Q1) — adversarial + characterization tests for the PURE tag helpers
// in src/utils/tags.ts (Notidian-blkq).
//
// These helpers had ZERO co-located coverage yet they sit on a TAG-PATH
// IDENTITY surface adjacent to ADR 0014 (notidian-only personal database
// engine) and ADR 0016 (per-view display + row identity). A tag-space is
// addressed by deriving a stable path from a tag string and back; a silent
// change in how a tag is normalized, encoded ('/'<->'+'), or stripped would
// mis-route a tag space or split/merge tags by accident.
//
// SCOPE — only the PURE, offline-verifiable helpers are covered here:
//   getAllParentTags, validateName, ensureTag, stringFromTag,
//   tagToTagPath, tagPathToTag.
// DELIBERATELY EXCLUDED: getAllSubtags (dereferences a live
// superstate.spaceManager.readTags()) and renameTag (drives spaceManager +
// renameTagSpacePath). Both need a Superstate and belong to a
// runtime/integration suite, not this pure-string Q1 suite.
//
// tags.ts imports `makemd-core` (Superstate) and a couple of core modules at
// the top, but for these six pure helpers the only runtime dependencies are
// `pathToString` (utils/path) and `encodeSpaceName` (core/utils/strings) —
// themselves pure. The `Superstate` import is TYPE-ONLY and erased at compile
// time; empirically importable under jest (ts-jest, moduleDirectories
// [node_modules, src]) with no live runtime dependency. So this suite is fully
// offline.
//
// IMPORTANT — CHARACTERIZATION, not correction. Every value asserted here was
// EMPIRICALLY OBSERVED from the current implementation and is LOCKED so that
// any future change to tag-identity derivation is a conscious, reviewed
// decision rather than a silent regression. Several behaviors are surprising
// (ensureTag does NOT trim; the '+'-encoded roundtrip is LOSSY for any tag
// containing a '.', because tagPathToTag routes through pathToString which
// strips a leading "extension"). These are flagged inline as latent contracts.
// They are NOT "fixed" here: per the bead directive and the ADR-0025 posture, a
// TRUE defect gets a SEPARATE decision/follow-up bead (characterize first,
// never fix blind) — real callers may depend on today's exact shape.
// ===========================================================================

// ---------------------------------------------------------------------------
// getAllParentTags — accumulate the ancestor tag list for a (possibly '#'-led)
//   slash-nested tag string.
//   const getAllParentTags = (str) => {
//     if (str.startsWith('#')) str = str.slice(1);     // drop a single leading '#'
//     const parts = str.split('/');
//     const result = [];
//     for (let i = 0; i < parts.length - 1; i++) {     // every part EXCEPT the leaf
//       if (i === 0) result.push(parts[i]);            // first ancestor = bare root
//       else result.push(result[i - 1] + '/' + parts[i]); // extend previous ancestor
//     }
//     return result;
//   };
// The `result[i - 1]` back-reference is sound ONLY because exactly one entry is
// pushed per iteration, so result.length === i at the top of each loop body.
// The LEAF (last part) is intentionally never emitted — only proper ancestors.
// ---------------------------------------------------------------------------
describe("getAllParentTags", () => {
  it('"#a/b/c" -> ["a","a/b"] : strips leading "#", emits all proper ancestors, drops the leaf', () => {
    expect(getAllParentTags("#a/b/c")).toEqual(["a", "a/b"]);
  });

  it('"a/b/c" (no "#") behaves identically to the "#"-led form', () => {
    expect(getAllParentTags("a/b/c")).toEqual(["a", "a/b"]);
  });

  it('"#a/b/c/d" -> ["a","a/b","a/b/c"] : the accumulator extends one segment per ancestor', () => {
    expect(getAllParentTags("#a/b/c/d")).toEqual(["a", "a/b", "a/b/c"]);
  });

  it('"#a/b" -> ["a"] : single ancestor', () => {
    expect(getAllParentTags("#a/b")).toEqual(["a"]);
  });

  it('"#a" (a leaf with no parent) -> [] : nothing to accumulate', () => {
    expect(getAllParentTags("#a")).toEqual([]);
  });

  it('"a" (bare leaf, no "#") -> []', () => {
    expect(getAllParentTags("a")).toEqual([]);
  });

  it('"" (empty) -> [] : split yields [""] so the loop never runs', () => {
    expect(getAllParentTags("")).toEqual([]);
  });

  it('"#" (bare hash) -> [] : slice(1) leaves "", which has no ancestors', () => {
    expect(getAllParentTags("#")).toEqual([]);
  });

  // --- ADVERSARIAL: trailing slash. The empty leaf segment is what gets
  // dropped, so "a/b/" yields the SAME ancestors as "a/b/c" would for its
  // first two parts. LOCKED as characterization (surprising but stable).
  it('"a/b/" (trailing slash) -> ["a","a/b"] : the empty trailing segment is the dropped leaf', () => {
    expect(getAllParentTags("a/b/")).toEqual(["a", "a/b"]);
  });

  // --- ADVERSARIAL: leading slash AFTER the "#" is NOT stripped (only ONE
  // leading "#" is removed, never a "/"). The empty first segment becomes an
  // empty-string root ancestor, and the next ancestor carries a literal "/".
  it('"#/" -> [""] : leading slash leaves an empty-string root ancestor', () => {
    expect(getAllParentTags("#/")).toEqual([""]);
  });

  it('"/a/b" (raw leading slash, no "#") -> ["","/a"] : empty root then "/a"', () => {
    expect(getAllParentTags("/a/b")).toEqual(["", "/a"]);
  });

  // --- only a SINGLE leading "#" is sliced ("##a/b" keeps the 2nd "#").
  it('"##a/b" -> ["#a"] : slice(1) removes ONE "#", the second stays in the root', () => {
    expect(getAllParentTags("##a/b")).toEqual(["#a"]);
  });
});

// ---------------------------------------------------------------------------
// validateName — the ONLY normalization it performs is a trim.
//   const validateName = (tag) => tag.trim();
// It does NOT add/strip "#", does NOT lowercase. Callers compose it with
// ensureTag, e.g. ensureTag(validateName(toTag)) in renameTag.
// ---------------------------------------------------------------------------
describe("validateName", () => {
  it('"  hi  " -> "hi" : trims surrounding whitespace', () => {
    expect(validateName("  hi  ")).toBe("hi");
  });

  it('"\\t#x\\n" -> "#x" : trims tabs/newlines but preserves the "#"', () => {
    expect(validateName("\t#x\n")).toBe("#x");
  });

  it('"no-trim" -> "no-trim" : no interior change', () => {
    expect(validateName("no-trim")).toBe("no-trim");
  });

  it('"   " (all whitespace) -> "" : collapses to empty string', () => {
    expect(validateName("   ")).toBe("");
  });

  it('does NOT lowercase (case is ensureTag\'s job, not validateName\'s)', () => {
    expect(validateName("  CamelCase  ")).toBe("CamelCase");
  });
});

// ---------------------------------------------------------------------------
// ensureTag — guarantee a single leading "#" then lowercase. Returns null for
//   any falsy input.
//   const ensureTag = (tag) => {
//     if (!tag) return null;
//     let string = tag;
//     if (string.charAt(0) != "#") string = "#" + string;
//     return string.toLowerCase();
//   };
// SURPRISING latent contract: ensureTag does NOT trim — interior/edge
// whitespace survives ("  spaced  " -> "#  spaced  "). It is the caller's job
// to validateName() first.
// ---------------------------------------------------------------------------
describe("ensureTag", () => {
  it('"Foo" -> "#foo" : prepends "#" and lowercases', () => {
    expect(ensureTag("Foo")).toBe("#foo");
  });

  it('"#Bar" -> "#bar" : already has "#", just lowercases', () => {
    expect(ensureTag("#Bar")).toBe("#bar");
  });

  it('"ALLCAPS" -> "#allcaps"', () => {
    expect(ensureTag("ALLCAPS")).toBe("#allcaps");
  });

  it('"a/B/C" -> "#a/b/c" : nested segments are each lowercased, slashes preserved', () => {
    expect(ensureTag("a/B/C")).toBe("#a/b/c");
  });

  it('"" (empty string) -> null : falsy guard', () => {
    expect(ensureTag("")).toBeNull();
  });

  // --- ADVERSARIAL: a BARE "#" is truthy and already starts with "#", so it
  // survives unchanged. NOT treated as empty. LOCKED.
  it('"#" (bare hash) -> "#" : truthy + already "#"-led, returned as-is', () => {
    expect(ensureTag("#")).toBe("#");
  });

  // --- ADVERSARIAL: ensureTag does NOT trim. Whitespace is preserved verbatim
  // (only lowercased). This is why callers must validateName() FIRST.
  it('"  spaced  " -> "#  spaced  " : whitespace is NOT trimmed (latent contract)', () => {
    expect(ensureTag("  spaced  ")).toBe("#  spaced  ");
  });

  // --- the string "0" is TRUTHY -> normalized; the NUMBER 0 is falsy -> null.
  it('"0" (truthy string) -> "#0"', () => {
    expect(ensureTag("0")).toBe("#0");
  });

  it("undefined -> null : falsy guard", () => {
    // ensureTag's signature is (tag: string) but the runtime guard is `!tag`,
    // so a falsy non-string still short-circuits to null. Cast to exercise it.
    expect(ensureTag(undefined as unknown as string)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stringFromTag — strip a leading "#" or "##" prefix.
//   const stringFromTag = (string) => {
//     if (string.charAt(0) == "#") {
//       if (string.charAt(1) == "#") return string.substring(2);  // drop "##"
//       return string.substring(1);                               // drop "#"
//     }
//     return string;                                              // no "#": as-is
//   };
// Strips AT MOST two hashes; a third "#" survives ("###x" -> "#x").
// ---------------------------------------------------------------------------
describe("stringFromTag", () => {
  it('"#tag" -> "tag" : drops a single leading "#"', () => {
    expect(stringFromTag("#tag")).toBe("tag");
  });

  it('"##tag" -> "tag" : drops a double leading "##"', () => {
    expect(stringFromTag("##tag")).toBe("tag");
  });

  it('"tag" (no "#") -> "tag" : returned unchanged', () => {
    expect(stringFromTag("tag")).toBe("tag");
  });

  it('"#a/b" -> "a/b" : nested tag, single hash stripped, slashes kept', () => {
    expect(stringFromTag("#a/b")).toBe("a/b");
  });

  // --- ADVERSARIAL edges: bare "#"/"##" collapse to "", and a third hash
  // survives because only two are ever stripped.
  it('"#" (bare) -> "" : substring(1) of a 1-char string', () => {
    expect(stringFromTag("#")).toBe("");
  });

  it('"##" (bare double) -> "" : substring(2) of a 2-char string', () => {
    expect(stringFromTag("##")).toBe("");
  });

  it('"###x" -> "#x" : only the first TWO hashes are stripped', () => {
    expect(stringFromTag("###x")).toBe("#x");
  });

  it('"" (empty) -> "" : no leading "#", returned as-is', () => {
    expect(stringFromTag("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// tagToTagPath — derive the encoded tag-SPACE path from a tag string:
//   const tagToTagPath = (tag) => encodeSpaceName(ensureTag(tag));
// = ensureTag (single "#", lowercase) THEN encodeSpaceName ('/' -> '+').
// So "a/b/c" -> ensureTag -> "#a/b/c" -> encodeSpaceName -> "#a+b+c".
// ---------------------------------------------------------------------------
describe("tagToTagPath", () => {
  it('"a/b/c" -> "#a+b+c" : "#"-prefixes, lowercases, then encodes "/" as "+"', () => {
    expect(tagToTagPath("a/b/c")).toBe("#a+b+c");
  });

  it('"#a/b/c" -> "#a+b+c" : an already-"#"-led tag yields the same path', () => {
    expect(tagToTagPath("#a/b/c")).toBe("#a+b+c");
  });

  it('"Foo" -> "#foo" : lowercases; no "/" so nothing to encode', () => {
    expect(tagToTagPath("Foo")).toBe("#foo");
  });

  it('"#Bar" -> "#bar"', () => {
    expect(tagToTagPath("#Bar")).toBe("#bar");
  });

  it('"mixed/Case" -> "#mixed+case" : lowercase BOTH segments, encode the slash', () => {
    expect(tagToTagPath("mixed/Case")).toBe("#mixed+case");
  });
});

// ---------------------------------------------------------------------------
// tagPathToTag — recover a tag from an encoded tag-space path:
//   const tagPathToTag = (string) => pathToString(string).replace(/\+/g, "/");
// = pathToString (a PATH->display reducer) THEN decode '+' -> '/'.
//
// CRITICAL SUBTLETY (Notidian-uuco-adjacent): the encoded path uses "+" in
// place of "/", so a typical tag path contains NO real "/". pathToString's
// behavior therefore comes from its NO-SLASH branch, which STRIPS a trailing
// "extension" — i.e. everything from the FIRST "." (lastIndexOf of a dot when
// there is no slash takes substring(0, lastDot)). That means ANY "." in a tag
// path silently truncates the recovered tag. This is the lossy seam; LOCKED as
// characterization, NOT fixed here.
// ---------------------------------------------------------------------------
describe("tagPathToTag", () => {
  it('"#a+b+c" -> "#a/b/c" : pathToString is a no-op (no "."/"/"), then "+"->"/"', () => {
    expect(tagPathToTag("#a+b+c")).toBe("#a/b/c");
  });

  it('"a+b+c" -> "a/b/c" : without a leading "#"', () => {
    expect(tagPathToTag("a+b+c")).toBe("a/b/c");
  });

  it('"#foo" -> "#foo" : no "+", unchanged', () => {
    expect(tagPathToTag("#foo")).toBe("#foo");
  });

  it('"#a+b" -> "#a/b"', () => {
    expect(tagPathToTag("#a+b")).toBe("#a/b");
  });

  // --- ADVERSARIAL / lossy seam: a "." in the encoded path is treated as an
  // extension boundary by pathToString (NO "/" present -> no-slash dot branch),
  // truncating everything from the LAST dot. These values are SURPRISING and
  // LOCKED as the documented fragility (do NOT depend on dots surviving).
  it('"x.md" -> "x" : pathToString strips the ".md" as an extension (no "/" path)', () => {
    expect(tagPathToTag("x.md")).toBe("x");
  });

  it('"a.b+c" -> "a" : the dot precedes the "+", pathToString truncates at the dot BEFORE decode', () => {
    expect(tagPathToTag("a.b+c")).toBe("a");
  });

  it('"foo.bar+baz+qux" -> "foo" : everything from the dot onward is dropped (lossy)', () => {
    expect(tagPathToTag("foo.bar+baz+qux")).toBe("foo");
  });

  it('"a+.config" -> "a/" : the "+." encodes to a trailing-slash dotfile that empties its basename', () => {
    // pathToString sees no "/", lastIndexOf(".") truncates "a+.config" -> "a+",
    // then "+"->"/" yields "a/". Surprising; LOCKED.
    expect(tagPathToTag("a+.config")).toBe("a/");
  });

  it('"#a+b+" (trailing "+") -> "#a/b/" : trailing encoded slash survives', () => {
    expect(tagPathToTag("#a+b+")).toBe("#a/b/");
  });
});

// ---------------------------------------------------------------------------
// LOCKED INVARIANT — the tagToTagPath <-> tagPathToTag roundtrip.
//
// tagToTagPath = encodeSpaceName(ensureTag(tag)):  "#"-prefix + lowercase, then
//   '/'->'+'.
// tagPathToTag = pathToString(path).replace('+','/'):  reduce-display, then
//   '+'->'/'.
//
// The roundtrip tagPathToTag(tagToTagPath(x)) recovers a NORMALIZED tag (always
// "#"-led, always lowercased, slashes restored) IFF x contains NO ".". Because
// ensureTag lowercases + prepends "#" on the way OUT and pathToString may strip
// a "." on the way BACK, the roundtrip is:
//   * IDEMPOTENT-onto-normal-form for dot-free tags (the common case), and
//   * LOSSY for any tag containing a "." (the dot triggers pathToString's
//     extension strip — see Notidian-uuco for the pathToString seam).
// Both directions are LOCKED below as the contract.
// ---------------------------------------------------------------------------
describe("tagToTagPath <-> tagPathToTag roundtrip (LOCKED invariant)", () => {
  it("recovers the NORMALIZED ('#'-led, lowercased) tag for dot-free inputs", () => {
    const cases: Array<[string, string]> = [
      ["a/b/c", "#a/b/c"],
      ["#a/b/c", "#a/b/c"],
      ["Foo", "#foo"],
      ["#Bar/Baz", "#bar/baz"],
      ["a", "#a"],
      ["mixed/Case", "#mixed/case"],
      ["#x", "#x"],
    ];
    for (const [input, expectedRecovered] of cases) {
      const path = tagToTagPath(input);
      expect(tagPathToTag(path)).toBe(expectedRecovered);
    }
  });

  it("is idempotent once a tag is already in normal form (#-led, lowercase, dot-free)", () => {
    for (const normal of ["#a/b/c", "#foo", "#mixed/case"]) {
      expect(tagPathToTag(tagToTagPath(normal))).toBe(normal);
    }
  });

  it("is LOSSY when the tag contains a '.' (pathToString strips it — Notidian-uuco seam)", () => {
    // "#a.b/c" -> ensureTag -> "#a.b/c" -> encode -> "#a.b+c"
    // -> pathToString (no real "/", dot truncates at lastDot) -> "#a"
    // -> decode -> "#a". The "/c" and "b" are LOST. LOCKED as the fragility.
    expect(tagPathToTag(tagToTagPath("#a.b/c"))).toBe("#a");
    // Plain "version1.2" -> "#version1" : the ".2" is dropped.
    expect(tagPathToTag(tagToTagPath("version1.2"))).toBe("#version1");
  });
});

// ===========================================================================
// DEPTH (Notidian-23bl) — getAllSubtags: the formerly-uncovered helper that
// carried a tag-rename data-integrity defect, plus the '/'-boundary FIX.
//
// WHY THIS IS A DATA-INTEGRITY SURFACE, not a cosmetic one. The reach is:
//   path.ts renamePathByName(superstate, oldPath, newName)        (title rename)
//     -> if the space is a tag space: renameTag(superstate, name, newName)
//        -> const tags = getAllSubtags(superstate, tag)
//        -> for each subtag: renameTag(superstate, subtag,
//                                       subtag.replace(tag, newTag))   (RECURSE)
// So whatever getAllSubtags returns is RECURSIVELY RENAMED on disk via
// spaceManager.renameTag (filesystemAdapter.renameTagForFile). An over-broad
// result rewrites tags that the user never asked to touch.
//
// THE DEFECT (now fixed). The original body was:
//   const tags = superstate.spaceManager.readTags();
//   return tags.filter((f) => f.startsWith(tag) && f != tag);
// A BARE prefix match with NO '/' segment boundary. readTags() returns the
// vault's '#'-led tag strings (filesystem.allTags() -> readAllTags()), so for
// tag '#foo' it captured EVERY tag textually starting with '#foo' — including
// the unrelated SIBLINGS '#foobar' and '#football', which are NOT subtags of
// '#foo' (a true subtag is '#foo/<child>'). renameTag would then recurse into
// them and `'#foobar'.replace('#foo', '#bar')` -> '#barbar', silently
// corrupting sibling tags that merely shared a textual prefix.
//
// THE FIX. A genuine subtag is exactly '#foo/<child...>', so the boundary
// slash is required: filter on `f.startsWith(tag + '/')`. That clause already
// implies `f != tag` (nothing equals `tag + '/'`), so the old `&& f != tag`
// guard is subsumed. The recursion is now confined to the true descendant
// subtree.
//
// getAllSubtags is otherwise PURE given the readTags() list — the only
// Superstate touch is `superstate.spaceManager.readTags()`. We stub a fake
// Superstate exposing exactly that (the established `as unknown as Superstate`
// pattern, cf. ast.asyncExpand.test.ts), so this stays fully offline.
// ===========================================================================

// Minimal fake Superstate whose only live surface is spaceManager.readTags().
const fakeSuperstate = (tags: string[]): Superstate =>
  ({
    spaceManager: {
      readTags: () => tags,
    },
  } as unknown as Superstate);

describe("getAllSubtags", () => {
  // --- THE BUG, RE-EXPRESSED AS A REGRESSION GUARD. Under the OLD bare
  // `startsWith(tag)`, this exact fixture returned ['#foobar','#foo/a'] (the
  // sibling '#foobar' wrongly captured). The FIXED '/'-boundary returns ONLY
  // the genuine subtag '#foo/a'. This assertion is what proves the fix and
  // will fail loudly if the boundary is ever loosened back to a bare prefix.
  it("returns ONLY '/'-boundaried descendants, EXCLUDING textual-prefix siblings (the fix)", () => {
    const ss = fakeSuperstate(["#foo", "#foobar", "#foo/a"]);
    expect(getAllSubtags(ss, "#foo")).toEqual(["#foo/a"]);
  });

  it("excludes EVERY sibling that merely shares a textual prefix ('#football','#foobar','#food')", () => {
    const ss = fakeSuperstate([
      "#foo",
      "#foobar",
      "#football",
      "#food",
      "#foo/a",
      "#foo/b",
    ]);
    expect(getAllSubtags(ss, "#foo")).toEqual(["#foo/a", "#foo/b"]);
  });

  it("returns the WHOLE descendant subtree (direct AND deeper grandchildren)", () => {
    const ss = fakeSuperstate(["#foo", "#foo/a", "#foo/a/b", "#foo/c"]);
    expect(getAllSubtags(ss, "#foo")).toEqual(["#foo/a", "#foo/a/b", "#foo/c"]);
  });

  it("excludes the tag ITSELF (the boundary slash already implies f != tag)", () => {
    const ss = fakeSuperstate(["#foo", "#foo/a"]);
    expect(getAllSubtags(ss, "#foo")).not.toContain("#foo");
  });

  it("returns [] when the tag has no descendants (only itself + unrelated siblings)", () => {
    const ss = fakeSuperstate(["#foo", "#foobar", "#bar/x"]);
    expect(getAllSubtags(ss, "#foo")).toEqual([]);
  });

  it("returns [] when readTags() is empty", () => {
    const ss = fakeSuperstate([]);
    expect(getAllSubtags(ss, "#foo")).toEqual([]);
  });

  it("scopes nested tags by their full path: '#foo/a' yields only '#foo/a/*', never '#foo/ab'", () => {
    const ss = fakeSuperstate([
      "#foo/a",
      "#foo/ab", // sibling under #foo, NOT a descendant of #foo/a
      "#foo/a/x",
      "#foo/a/y",
    ]);
    expect(getAllSubtags(ss, "#foo/a")).toEqual(["#foo/a/x", "#foo/a/y"]);
  });

  // --- LOCKED detail of the chosen contract: matching is by raw string prefix
  // (no case-folding). getAllSubtags preserves the existing implementation's
  // case-sensitivity; only the '/' boundary changed. A differently-cased
  // sibling is NOT a descendant. (If case-insensitive grouping is ever wanted,
  // that is a separate, deliberate decision — not silently folded in here.)
  it("is case-sensitive by raw prefix (only the '/' boundary changed, not casing)", () => {
    const ss = fakeSuperstate(["#foo", "#foo/a", "#Foo/b"]);
    expect(getAllSubtags(ss, "#foo")).toEqual(["#foo/a"]);
  });
});

// ===========================================================================
// DEPTH (Notidian-23bl) — renameTag's recursive subtag rewrite under the
// tightened getAllSubtags set. We do NOT drive the live spaceManager here;
// instead we PIN the exact transform renameTag applies to each descendant:
//   for each subtag in getAllSubtags(superstate, tag):
//     renameTag(superstate, subtag, subtag.replace(tag, newTag))
// The load-bearing claim is that `subtag.replace(tag, newTag)` rewrites ONLY
// the leading `tag` prefix (String.prototype.replace replaces the FIRST
// occurrence, and `tag` is, by construction of the '/'-boundary filter, that
// leading prefix). Under the OLD over-match a captured sibling '#foobar' would
// be mangled to '#barbar'; under the FIX no sibling is ever captured, so every
// rewrite preserves the descendant's child segments.
// ===========================================================================
describe("renameTag recursive rewrite (.replace) under the tightened subtag set", () => {
  it("rewrites each true descendant's leading prefix, preserving child segments", () => {
    const ss = fakeSuperstate(["#foo", "#foo/a", "#foo/a/b", "#foo/c"]);
    const tag = "#foo";
    const newTag = "#bar";
    // Exactly the loop renameTag runs over its subtags.
    const rewritten = getAllSubtags(ss, tag).map((subtag) =>
      subtag.replace(tag, newTag)
    );
    expect(rewritten).toEqual(["#bar/a", "#bar/a/b", "#bar/c"]);
  });

  it("never mangles a textual-prefix sibling, because the fix never captures one", () => {
    // The corruption the fix prevents: with the OLD filter, '#foobar' would be
    // in the set and `'#foobar'.replace('#foo','#bar')` -> '#barbar'. The fix
    // keeps '#foobar' OUT, so it is never a rename target at all.
    const ss = fakeSuperstate(["#foo", "#foobar", "#foo/a"]);
    const subtags = getAllSubtags(ss, "#foo");
    expect(subtags).not.toContain("#foobar");
    const rewritten = subtags.map((s) => s.replace("#foo", "#bar"));
    expect(rewritten).toEqual(["#bar/a"]);
    expect(rewritten).not.toContain("#barbar");
  });
});
