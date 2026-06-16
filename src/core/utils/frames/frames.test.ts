// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-jwue) — property + characterization net
// for the const-vs-closure predicates in src/core/utils/frames/frames.ts:
//   removeTrailingSemicolon (l.27), objectIsConst (l.31), stringIsConst (l.44).
//
// WHAT THEY ARE. These three pure predicates decide whether a frame node's
// prop / style / action code STRING is a literal CONSTANT or must be compiled
// into an executable closure. They are consumed by:
//   - executable.ts generateCodeForProp: `objectIsConst(codeBlock, type)` gates
//     whether a multi-line, non-closure object block is wrapped as a statement
//     `new Function("with(this){ ... }")` vs a returning expression
//     `new Function("with(this){ return ...; }")` — i.e. which shape reaches the
//     `new Function` / $api trust surface (ADR 0018 / Notidian-vke: a trusted
//     frame node evaluates this code with $api = full vault write access).
//   - executable.ts buildExecutable: `stringIsConst(props[f])` populates the
//     per-prop `isConst` flag on execPropsOptions (drives const folding /
//     dependency tracking).
//   - frame.ts (linkProps / path resolution), PropertiesSubmenu.tsx
//     (static-vs-dynamic editor affordance), and several EditorNodes views that
//     branch their rendered UI on `stringIsConst(...)`.
//
// WHY IT MATTERS. Misclassification is SILENT and changes execution semantics:
// a value wrongly judged const is folded / shown as a static field instead of
// being evaluated; a const wrongly judged dynamic is compiled into a closure and
// run on the $api surface. There was ZERO direct coverage. Each assertion below
// pins LIVE behavior characterized with throwaway node probes against the real
// lodash isInteger/isString.
//
// METHOD (AGENTS.md Long Autonomous Mode). Where current behavior is the
// CORRECT contract we assert it as the contract. Where it is a latent DEFECT /
// surprising edge we assert it explicitly under a `defect/quirk (characterized)`
// label so the silent path is PINNED — a future deliberate fix flips a RED test
// on purpose. We NEVER assert buggy behavior silently and NEVER "fix" the source
// here (this bead is the net, not the repair). Pure offline: node env, no DOM,
// no makemd-core runtime.
// ===========================================================================

import {
  removeTrailingSemicolon,
  objectIsConst,
  stringIsConst,
} from "core/utils/frames/frames";

// ---------------------------------------------------------------------------
// removeTrailingSemicolon — strips ONLY a trailing run of `;` (regex /;+$/).
// ---------------------------------------------------------------------------
describe("removeTrailingSemicolon — trailing `;` only", () => {
  test("strips a single trailing semicolon", () => {
    expect(removeTrailingSemicolon("a;b;")).toBe("a;b");
  });

  test("strips a run of trailing semicolons (greedy `;+$`)", () => {
    expect(removeTrailingSemicolon("foo;;;")).toBe("foo");
  });

  test("a string that is ALL semicolons collapses to empty", () => {
    expect(removeTrailingSemicolon(";;;")).toBe("");
  });

  test("preserves INTERIOR semicolons — only the trailing run is removed", () => {
    expect(removeTrailingSemicolon("a;b")).toBe("a;b");
  });

  test("leading semicolon is NOT trailing — preserved", () => {
    expect(removeTrailingSemicolon(";a")).toBe(";a");
  });

  test("a string with no trailing semicolon is returned unchanged", () => {
    expect(removeTrailingSemicolon("x")).toBe("x");
    expect(removeTrailingSemicolon("")).toBe("");
  });

  // quirk (characterized): the regex anchors the `;` run to end-of-string, so a
  // space BEFORE the trailing `;` is NOT consumed — trailing whitespace before
  // the semicolon survives. This is the seam that defeats objectIsConst for
  // `" [..] ;"` (see below) because the post-strip string then ends in a space.
  test("quirk (characterized): whitespace before the trailing `;` is preserved", () => {
    expect(removeTrailingSemicolon("a; b ;")).toBe("a; b ");
  });
});

// ---------------------------------------------------------------------------
// objectIsConst(objString, type) — const iff:
//   type === 'object'        and trimmed/`;`-stripped value is `{...}`, OR
//   type === 'object-multi'  and trimmed/`;`-stripped value is `[...]`, OR
//   the value is null/empty (the `objString == null || objString == ""` clause,
//   reached only after the leading `if (!objString) return false`, so it is in
//   practice unreachable for empty input — characterized below).
// Note the ORDER: it does `removeTrailingSemicolon(objString.trim())` — TRIM
// first, THEN strip the trailing `;`.
// ---------------------------------------------------------------------------
describe("objectIsConst — object/object-multi literal detection", () => {
  test("type 'object' + `{...}` is const", () => {
    expect(objectIsConst("{a:1}", "object")).toBe(true);
  });

  test("type 'object' tolerates surrounding whitespace (trim)", () => {
    expect(objectIsConst(" {a:1} ", "object")).toBe(true);
  });

  test("type 'object' tolerates a trailing semicolon", () => {
    expect(objectIsConst("{a:1};", "object")).toBe(true);
  });

  test("type 'object' tolerates MULTIPLE trailing semicolons (`;+$`)", () => {
    expect(objectIsConst("{a:1};;", "object")).toBe(true);
  });

  test("empty object literal `{}` is const for type 'object'", () => {
    expect(objectIsConst("{}", "object")).toBe(true);
  });

  test("type 'object-multi' + `[...]` is const", () => {
    expect(objectIsConst("[1,2]", "object-multi")).toBe(true);
    expect(objectIsConst("[]", "object-multi")).toBe(true);
  });

  test("type/bracket mismatch is NOT const (object<->object-multi are distinct)", () => {
    expect(objectIsConst("[1,2]", "object")).toBe(false);
    expect(objectIsConst("{a:1}", "object-multi")).toBe(false);
  });

  test("an unrelated type (e.g. 'super') is never const here", () => {
    expect(objectIsConst("{a:1}", "super")).toBe(false);
  });

  test("a code expression (not a bracketed literal) is dynamic -> closure", () => {
    expect(objectIsConst("$api.x()", "object")).toBe(false);
    expect(objectIsConst("notobj", "object")).toBe(false);
  });

  test("an unbalanced/partial literal is NOT const", () => {
    expect(objectIsConst("{a:1", "object")).toBe(false);
  });

  test("falsy input short-circuits to false via the leading guard", () => {
    // `if (!objString) return false` fires for "" and null/undefined.
    expect(objectIsConst("", "object")).toBe(false);
    expect(objectIsConst(null as unknown as string, "object")).toBe(false);
    expect(objectIsConst(undefined as unknown as string, "object")).toBe(false);
  });

  // quirk (characterized): trim-then-strip ORDER means a SPACE before the
  // trailing `;` survives removeTrailingSemicolon, leaving the value ending in
  // " " (not "]"), so a benign `" [1,2] ;"` is judged DYNAMIC even though the
  // same value without the inner trailing space (`"[1,2];"`) is const. A real,
  // silent classification asymmetry rooted in removeTrailingSemicolon's `/;+$/`.
  test("quirk (characterized): a space BEFORE the trailing `;` defeats object-multi", () => {
    expect(objectIsConst(" [1,2] ;", "object-multi")).toBe(false);
    // contrast: no inner trailing space -> const
    expect(objectIsConst("[1,2];", "object-multi")).toBe(true);
  });

  // quirk (characterized): the `objString == null || objString == ""` clause on
  // line 40 can never be reached for "" / null because the leading
  // `if (!objString) return false` already returned. It is dead defensive code;
  // pin that the OBSERVABLE result for those inputs is false (above), so a future
  // refactor that "activates" the dead clause would flip a RED test on purpose.
  test("quirk (characterized): the null/empty const clause is unreachable (observable = false)", () => {
    expect(objectIsConst("", "object-multi")).toBe(false);
    expect(objectIsConst("", "anything")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stringIsConst(str) — true when the value is a literal we can fold rather than
// compile. Internals (characterized against real lodash):
//   - `if (!str || isInteger(str)) return true` — `!str` catches "", 0, null,
//     undefined, false, NaN; `isInteger(str)` is a NO-OP for STRING input
//     (lodash isInteger("5") === false) — the dead branch is pinned below.
//   - `if (!isString(str)) return false` — non-empty non-strings (true, {}, [..])
//     are dynamic.
//   - quoted-literal regex: /^["'](?:[^"\\]|\\.)*["'](?:;)?$/ — a single- or
//     double-quoted string, escapes allowed, tolerating EXACTLY ONE trailing `;`.
//   - numeric coercion: parseFloat(fixed) not NaN AND Number(fixed) not NaN
//     (`isNaN(fixedStr as any)`), where fixed = str without trailing `;` run.
//   - array literal: fixed startsWith('[') && endsWith(']') (NO trim).
//   - boolean literals: fixed === 'true' | 'false'.
// ---------------------------------------------------------------------------
describe("stringIsConst — the `isInteger` branch is dead for string input", () => {
  // characterization (do NOT 'fix'): lodash isInteger requires a number, so on a
  // STRING it is always false. The `|| isInteger(str)` clause therefore never
  // contributes for the string callers in executable.ts/frame.ts; numeric
  // strings are classified const ONLY via the parseFloat/Number path below.
  test("integer-looking STRINGS are const via the NUMERIC path, not isInteger", () => {
    expect(stringIsConst("5")).toBe(true);
    expect(stringIsConst("42")).toBe(true);
  });
});

describe("stringIsConst — early `!str` truthiness guard", () => {
  test("empty string is const", () => {
    expect(stringIsConst("")).toBe(true);
  });

  // quirk (characterized): WHITESPACE-only is NOT empty (`!"  "` is false) and is
  // not numeric (parseFloat("  ") is NaN), so it is judged DYNAMIC. Contrast with
  // the empty string. A space-only prop value is therefore compiled, not folded.
  test("quirk (characterized): whitespace-only is NOT const (unlike empty string)", () => {
    expect(stringIsConst("  ")).toBe(false);
    expect(stringIsConst(" ")).toBe(false);
  });
});

describe("stringIsConst — quoted string literals", () => {
  test("double- and single-quoted literals are const", () => {
    expect(stringIsConst('"hello"')).toBe(true);
    expect(stringIsConst("'hello'")).toBe(true);
  });

  test("empty quoted literal is const", () => {
    expect(stringIsConst('""')).toBe(true);
  });

  test("escaped quote inside is tolerated by the regex `(?:[^\"\\\\]|\\\\.)*`", () => {
    expect(stringIsConst('"a\\"b"')).toBe(true);
  });

  test("a single trailing `;` after the closing quote is tolerated", () => {
    expect(stringIsConst('"x";')).toBe(true);
  });

  test("an UNterminated quote is not a const literal", () => {
    expect(stringIsConst('"unterminated')).toBe(false);
  });

  test("an interior unescaped quote breaks the literal", () => {
    expect(stringIsConst('"a"b"')).toBe(false);
  });

  // quirk (characterized): the quoted-literal regex allows AT MOST ONE trailing
  // `;` (`(?:;)?`); the numeric path strips a `;` RUN but a quoted string is not
  // numeric. So a string with a DOUBLE trailing semicolon after a quote
  // (`"a";;`) falls through every branch and is judged DYNAMIC. Single `;` ok,
  // double `;` not — an asymmetry vs objectIsConst (which tolerates `;+`).
  test("quirk (characterized): a DOUBLE trailing `;` after a quote is not const", () => {
    expect(stringIsConst('"a";;')).toBe(false);
    expect(stringIsConst('"a";')).toBe(true);
  });
});

describe("stringIsConst — numeric coercion (parseFloat + Number(isNaN as any))", () => {
  test("plain integers and decimals are const", () => {
    expect(stringIsConst("5")).toBe(true);
    expect(stringIsConst("3.14")).toBe(true);
    expect(stringIsConst(".5")).toBe(true);
    expect(stringIsConst("-0")).toBe(true);
  });

  test("surrounding whitespace is tolerated by Number() coercion", () => {
    expect(stringIsConst("  5  ")).toBe(true);
  });

  test("scientific notation is const (`1e3`)", () => {
    expect(stringIsConst("1e3")).toBe(true);
  });

  test("`Infinity` coerces to a number and is const", () => {
    expect(stringIsConst("Infinity")).toBe(true);
  });

  // quirk (characterized): the SECOND test is `!isNaN(fixedStr as any)`, i.e.
  // `Number(fixedStr)`, which accepts hex/binary/octal/whitespace forms that
  // parseFloat alone would NOT. So `0x10`/`0b101` are judged const numbers even
  // though parseFloat("0x10") === 0 (stops at 'x'); it is Number() that makes
  // them const. Surprising but pinned: hex/binary code strings fold to const.
  test("quirk (characterized): hex/binary literals are const via Number(), not parseFloat", () => {
    expect(stringIsConst("0x10")).toBe(true);
    expect(stringIsConst("0b101")).toBe(true);
    expect(stringIsConst("  0x10  ")).toBe(true);
  });

  // The two-pronged AND is what REJECTS unit/partial-number strings: parseFloat
  // accepts the leading digits but Number() rejects the whole string -> dynamic.
  test("partial-number strings (`5px`) are NOT const (Number() rejects the whole)", () => {
    expect(stringIsConst("5px")).toBe(false);
  });

  test("comma/underscore-grouped numbers are NOT const", () => {
    expect(stringIsConst("1,2")).toBe(false);
    expect(stringIsConst("1_000")).toBe(false);
  });

  test("`NaN` (the literal word) is NOT const", () => {
    expect(stringIsConst("NaN")).toBe(false);
  });
});

describe("stringIsConst — array literals", () => {
  test("array literal is const", () => {
    expect(stringIsConst("[1,2,3]")).toBe(true);
  });

  test("array literal with a trailing `;` run is const (fixed strips `;`)", () => {
    expect(stringIsConst("[1,2];")).toBe(true);
  });

  // quirk (characterized): the array branch uses fixedStr.startsWith('[') &&
  // endsWith(']') with NO trim, while removeTrailingSemicolon does not eat a
  // trailing SPACE. So `"[1,2] "` (trailing space, no `;`) does NOT end with ']'
  // and is judged DYNAMIC — the same trim/strip-order asymmetry seen in
  // objectIsConst. A bare array with a trailing space is compiled, not folded.
  test("quirk (characterized): a trailing SPACE defeats the array-literal check", () => {
    expect(stringIsConst("[1,2] ")).toBe(false);
  });

  test("an array that is actually an expression (`[a].map(...)`) is dynamic", () => {
    expect(stringIsConst("[a].map(x=>x)")).toBe(false);
  });
});

describe("stringIsConst — boolean literals", () => {
  // quirk (characterized): the STRING "true" reaches the explicit
  // `fixed == 'true'` clause and is const. The STRING "false" is also const, but
  // for a DIFFERENT reason: it matches the same explicit clause. Both string
  // forms are const; the trailing-`;` form works too.
  test("string boolean literals are const", () => {
    expect(stringIsConst("true")).toBe(true);
    expect(stringIsConst("false")).toBe(true);
    expect(stringIsConst("true;")).toBe(true);
  });
});

describe("stringIsConst — non-string inputs (executable.ts may pass raw values)", () => {
  // The `!str` early return makes these "const":
  test("falsy primitives are const via the `!str` guard", () => {
    expect(stringIsConst(0 as unknown as string)).toBe(true);
    expect(stringIsConst(null as unknown as string)).toBe(true);
    expect(stringIsConst(undefined as unknown as string)).toBe(true);
    expect(stringIsConst(false as unknown as string)).toBe(true);
    expect(stringIsConst(NaN as unknown as string)).toBe(true);
  });

  // quirk (characterized): a non-zero NUMBER is const via lodash isInteger when
  // it is an integer (the branch that is dead for strings is LIVE for numbers).
  test("quirk (characterized): a real integer NUMBER is const via isInteger", () => {
    expect(stringIsConst(5 as unknown as string)).toBe(true);
  });

  // quirk (characterized): boolean `true` is asymmetric vs `false` — `true` is
  // truthy so it skips the `!str` guard, then fails `isString`, so it is DYNAMIC;
  // `false` is falsy so the `!str` guard returns const. Same TYPE, opposite
  // classification. Objects/arrays-as-values are likewise dynamic.
  test("quirk (characterized): boolean `true` is dynamic while `false` is const", () => {
    expect(stringIsConst(true as unknown as string)).toBe(false);
    expect(stringIsConst(false as unknown as string)).toBe(true);
  });

  test("non-empty non-string objects/arrays are dynamic", () => {
    expect(stringIsConst({} as unknown as string)).toBe(false);
    expect(stringIsConst([1] as unknown as string)).toBe(false);
  });
});

describe("stringIsConst — genuine expressions are dynamic (-> closure on $api)", () => {
  test("an $api call string is dynamic", () => {
    expect(stringIsConst("$api.foo()")).toBe(false);
  });
});
