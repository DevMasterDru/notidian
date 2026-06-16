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
// objectIsConst(objString, type) — const iff (post Notidian-akxe fix):
//   type === 'object'        and the normalized value is `{...}`, OR
//   type === 'object-multi'  and the normalized value is `[...]`.
// Normalization is `removeTrailingSemicolon(objString.trim()).trim()` — TRIM,
// strip a trailing `;` RUN, then RE-TRIM — so a space before the trailing `;`
// (or a bare trailing space) no longer survives to defeat detection. The former
// unreachable `objString == null || objString == ""` clause was removed (the
// leading `if (!objString) return false` already owns empty/null).
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

  // FIXED (Notidian-akxe): the normalization is now `removeTrailingSemicolon(
  // objString.trim()).trim()` — strip the trailing `;` run, then RE-TRIM — so a
  // space before the trailing `;` (or a bare trailing space) no longer survives
  // to defeat detection. `" [1,2] ;"` is now correctly CONST, matching the
  // no-inner-trailing-space form `"[1,2];"`. Was deliberately RED-on-fix.
  test("a space before the trailing `;` no longer defeats object-multi (Notidian-akxe)", () => {
    expect(objectIsConst(" [1,2] ;", "object-multi")).toBe(true);
    expect(objectIsConst("[1,2];", "object-multi")).toBe(true);
    // bare trailing space (no `;`) is now const too
    expect(objectIsConst("[1,2] ", "object-multi")).toBe(true);
    expect(objectIsConst(" {a:1} ;", "object")).toBe(true);
  });

  // FIXED (Notidian-akxe): the dead `objString == null || objString == ""` clause
  // (unreachable past the leading `if (!objString) return false`) was removed.
  // The OBSERVABLE result for "" is still false (the leading guard owns it), so
  // this remains a stable contract — only the unreachable line is gone.
  test("empty input is false; the removed null/empty clause did not change behavior (Notidian-akxe)", () => {
    expect(objectIsConst("", "object-multi")).toBe(false);
    expect(objectIsConst("", "anything")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stringIsConst(str) — true when the value is a literal we can fold rather than
// compile. Internals (post Notidian-akxe normalization fix):
//   - `if (!str) return true` — catches "", 0, null, undefined, false, NaN. (The
//     former `|| isInteger(str)` clause was removed: dead under `str: string`.)
//   - `if (!isString(str)) return false` — non-empty non-strings (true, 5, {},
//     [..]) are dynamic.
//   - fixed = `removeTrailingSemicolon(str).trim()` — strip a trailing `;` RUN
//     then RE-TRIM, so a trailing space (or a space before the `;`) is normalized
//     away symmetrically with objectIsConst.
//   - quoted-literal regex: /^["'](?:[^"\\]|\\.)*["'](?:;+)?\s*$/ on str.trim() —
//     a single-/double-quoted string, escapes allowed, tolerating a trailing `;`
//     RUN (aligned with objectIsConst's `;+`).
//   - numeric coercion: parseFloat(fixed) not NaN AND Number(fixed) not NaN
//     (`isNaN(fixedStr as any)`).
//   - array literal: fixed startsWith('[') && endsWith(']') (fixed is trimmed).
//   - boolean literals: fixed === 'true' | 'false'.
// ---------------------------------------------------------------------------
describe("stringIsConst — integer-looking strings fold via the NUMERIC path", () => {
  // FIXED (Notidian-akxe): the `|| isInteger(str)` clause was REMOVED. For the
  // declared `str: string` contract it was provably dead (lodash isInteger("5")
  // === false), so for the real string callers in executable.ts/frame.ts nothing
  // changes: numeric strings are — and always were — classified const via the
  // parseFloat/Number path below, not via isInteger.
  test("integer-looking STRINGS are const via the NUMERIC path", () => {
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

  // FIXED (Notidian-akxe): the quoted-literal regex now tolerates a trailing `;`
  // RUN (`(?:;+)?\s*$`), aligning it with objectIsConst's `;+` tolerance. A
  // DOUBLE trailing semicolon after a quote (`"a";;`) is now const, matching the
  // single-`;` form. Was deliberately RED-on-fix.
  test("a DOUBLE trailing `;` after a quote is now const (Notidian-akxe)", () => {
    expect(stringIsConst('"a";;')).toBe(true);
    expect(stringIsConst('"a";')).toBe(true);
    expect(stringIsConst('"a";;;')).toBe(true);
  });

  // FIXED (Notidian-akxe round 2): the quoted-literal regex previously tolerated
  // whitespace AFTER the trailing `;+` run (`(?:;+)?\s*$`) but NOT before it, so a
  // SPACE BEFORE the `;` (e.g. `'"a" ;'`) fell through to the dynamic/$api closure
  // path. The regex now allows optional whitespace BOTH sides of the `;+` run
  // (`["']\s*(?:;+)?\s*$`), so a quoted literal followed by ` ;`, `; `, or `  ;  `
  // stays CONST — symmetric with how objectIsConst trims around its `;` strip.
  // Was RED before the round-2 fix.
  test("whitespace BEFORE the trailing `;` after a quote is now const (Notidian-akxe r2)", () => {
    expect(stringIsConst('"a" ;')).toBe(true);
    expect(stringIsConst('"a"  ;  ')).toBe(true);
    expect(stringIsConst("'a' ;")).toBe(true);
    // a quote with trailing whitespace but no `;` was already const; pinned for symmetry
    expect(stringIsConst('"a" ')).toBe(true);
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

  // FIXED (Notidian-akxe): fixedStr is now `removeTrailingSemicolon(str).trim()`,
  // so a trailing SPACE (or space-before-`;`) no longer prevents the value from
  // ending in ']'. `"[1,2] "` (trailing space, no `;`) is now correctly const,
  // matching objectIsConst's symmetric normalization. Was deliberately RED-on-fix.
  test("a trailing SPACE no longer defeats the array-literal check (Notidian-akxe)", () => {
    expect(stringIsConst("[1,2] ")).toBe(true);
    expect(stringIsConst("[1,2] ;")).toBe(true);
    expect(stringIsConst(" [1,2] ")).toBe(true);
  });

  // FIXED (Notidian-akxe round 2): the FIRST fix re-trimmed AFTER stripping but
  // still ran removeTrailingSemicolon on the RAW, untrimmed string, so a space
  // AFTER the trailing `;` (e.g. `"[1,2];  "`) left the `;` un-stripped (its
  // `/;+$/` only matches a `;` at the absolute end) and the value ended in `;`,
  // not `]` — `stringIsConst` returned false while `objectIsConst` (which trims
  // FIRST) returned true. fixedStr is now `removeTrailingSemicolon(str.trim())
  // .trim()` — TRIM FIRST, matching objectIsConst exactly — so trailing space
  // after the `;` run (and combined leading/trailing/interspersed whitespace) is
  // normalized away and the array literal is correctly CONST. Was RED before the
  // round-2 fix; pins the symmetry the reviewer found still broken.
  test("space AFTER the trailing `;` no longer defeats the array-literal check (Notidian-akxe r2)", () => {
    expect(stringIsConst("[1,2];  ")).toBe(true);
    expect(stringIsConst(" [1,2]  ;  ")).toBe(true);
    // symmetry pin: stringIsConst now agrees with objectIsConst on this form
    expect(objectIsConst("[1,2];  ", "object-multi")).toBe(true);
    expect(stringIsConst("[1,2];  ")).toBe(objectIsConst("[1,2];  ", "object-multi"));
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

  // FIXED (Notidian-akxe): the `isInteger` clause was removed (it was dead under
  // the declared `str: string` contract). A non-zero integer NUMBER passed as a
  // contract-violating raw value now fails the `isString` guard and is DYNAMIC —
  // consistent with every other non-falsy non-string value (e.g. boolean `true`
  // below). Numeric *strings* (`"5"`) are unaffected: still const via the numeric
  // path. Was deliberately RED-on-fix for the integer-NUMBER input.
  test("a non-string integer NUMBER is now dynamic (no isInteger fast-path) (Notidian-akxe)", () => {
    expect(stringIsConst(5 as unknown as string)).toBe(false);
  });

  // boolean `true` is asymmetric vs `false`: `true` is truthy so it skips the
  // `!str` guard, then fails `isString`, so it is DYNAMIC; `false` is falsy so
  // the `!str` guard returns const. Same TYPE, opposite classification.
  test("boolean `true` is dynamic while `false` is const", () => {
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
