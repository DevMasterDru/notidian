// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-z6n3) — adversarial + characterization
// net for preprocessCode() in src/core/utils/frames/linker.ts.
//
// WHAT IT IS. preprocessCode(code, oldName, newName) is a PURE, acorn-based code
// rewriter. relinkProps / linkNodes / linkTreeNodes call it to PROPAGATE a
// node-id rename (oldName -> newName) through every prop/action/style code
// string of a frame node when ids are reassigned during link/expansion. It is
// the same bug FAMILY as the closed P0 link-rename-corruption defects
// (Notidian-5tl / 97l, replaceLinkInValue in links.ts): a string rewriter that
// must rename one token everywhere it MEANS the node and NOWHERE it does not.
//
// WHY IT MATTERS (authority). The rewritten string is fed back into the frame
// node's prop/action/style code, which the frame runtime evaluates on the $api
// trust surface (ADR 0018 / Notidian-vke: a trusted frame node keeps $api =
// full vault write access). A mis-rewrite is therefore a correctness AND an
// authority hazard: corrupting executable code that runs with vault-write
// authority. Yet this function had ZERO direct coverage.
//
// HOW THE REWRITER WORKS (the seams this suite pins):
//   1. ensureString(code) coerces non-strings; brace-wrapped object literals
//      ({...}) are parenthesized to ({...}) so acorn parses them as an
//      expression, not a block.
//   2. MULTI-LINE handling: if the code contains '\n', the LAST non-blank line
//      is stripped of a leading "return " (via String.replace, FIRST-occurrence)
//      BEFORE parsing, and "return " is re-prepended AFTER generate() — but only
//      if that last line ".includes('return')". Both the strip and the detect
//      are UNANCHORED substring ops (a real defect class — see below).
//   3. acorn-walk ancestor() renames Identifier nodes whose name === oldName,
//      GUARDED so a MemberExpression PROPERTY name (foo.oldName) is NOT renamed
//      but the OBJECT of a member access (oldName.x) and object-literal KEYS
//      ({oldName: 1}) ARE.
//   4. parse failure is SWALLOWED: string := '"error"' (silent corruption path).
//
// METHOD. We first characterized the LIVE behavior with throwaway probes, then
// encoded it. Where current behavior is CORRECT we assert it as the contract;
// where it is a DEFECT we assert it explicitly under a `defect (characterized)`
// label so the silent path is PINNED and a future fix flips a RED test on
// purpose (never assert buggy behavior silently — AGENTS.md Long Autonomous
// Mode). Pure offline: node env, no DOM, no makemd-core runtime.
//
// Output-format note: astring renders an ExpressionStatement with a trailing
// ';' and preprocessCode .trimEnd()s — so a bare expression `foo` round-trips
// to `foo;`. That ';' is an astring artifact, not part of the rename contract;
// we assert on the rename, not on punctuation, except where the exact string is
// the point (object parenthesization, return round-trip).
// ===========================================================================

import { preprocessCode } from "core/utils/frames/linker";

const run = (code: unknown, oldName: string, newName: string): string =>
  preprocessCode(code, oldName, newName);

describe("preprocessCode — Identifier rename + MemberExpression guard", () => {
  test("renames a bare identifier reference (the core node-id rename)", () => {
    // A frame prop that is just the node id: `$root` -> `main_abc`.
    expect(run("$root", "$root", "main_abc")).toBe("main_abc;");
  });

  test("renames the OBJECT of a member access (oldName.prop)", () => {
    // `$root` is the object => it MEANS the node => rename. `.value` is the
    // member property and is untouched.
    expect(run("$root.value", "$root", "main")).toBe("main.value;");
  });

  test("does NOT rename a member-access PROPERTY name (foo.oldName)", () => {
    // THE GUARD. `props.$root` reads a field literally named `$root` off `props`
    // — it does not mean the node. Renaming it would corrupt the access. This is
    // the exact mis-rewrite that sank the sibling P0 link-rename bugs.
    expect(run("props.$root.value", "$root", "main")).toBe("props.$root.value;");
    expect(run("a.$root", "$root", "main")).toBe("a.$root;");
  });

  test("does NOT rename the property at the tail of a deep member chain", () => {
    // `$api.frames.$root` — `$root` is the deepest property, never the object.
    expect(run("$api.frames.$root", "$root", "main")).toBe("$api.frames.$root;");
  });

  test("renames object-literal KEYS but leaves member properties alone in one expr", () => {
    // Mixed: `oldName` bare (rename) + `oldName.x` object (rename) + `y.oldName`
    // property (KEEP). One pass must get all three right.
    expect(run("oldName + oldName.x + y.oldName", "oldName", "newName")).toBe(
      "newName + newName.x + y.oldName;"
    );
  });

  test("renames a shorthand object-literal key", () => {
    // `{oldName}` shorthand -> brace-wrapped -> parenthesized -> key renamed.
    expect(run("{oldName}", "oldName", "newName")).toBe("({\n  newName\n});");
  });

  test("identity rename (oldName === newName) is a stable no-op on tokens", () => {
    expect(run("$root", "$root", "$root")).toBe("$root;");
  });

  test("a name that does not occur is left untouched (aside from astring reformat)", () => {
    expect(run("a + b.c", "$root", "main")).toBe("a + b.c;");
  });
});

describe("preprocessCode — object literals get parenthesized", () => {
  test("brace-wrapped object literal is parenthesized and keys renamed", () => {
    // `{ oldName: 1 }` is ambiguous (block vs object) — preprocessCode wraps it
    // in ( ) so acorn reads an ObjectExpression, then renames the key.
    expect(run("{ oldName: 1 }", "oldName", "newName")).toBe(
      "({\n  newName: 1\n});"
    );
  });

  test("already-parenthesized object literal renames keys the same way", () => {
    expect(run("({ oldName: 1 })", "oldName", "newName")).toBe(
      "({\n  newName: 1\n});"
    );
  });

  test("object literal renames KEY and OBJECT-position values, not member props", () => {
    // key `a`,`b` untouched (not oldName); value `oldName` -> object pos rename;
    // value `oldName.x` -> object pos rename.
    expect(run("{a: oldName, b: oldName.x}", "oldName", "newName")).toBe(
      "({\n  a: newName,\n  b: newName.x\n});"
    );
  });

  test("a real node-id rename inside a brace style object renames the object, not the css prop", () => {
    expect(run("{ width: $root.width }", "$root", "main")).toBe(
      "({\n  width: main.width\n});"
    );
  });
});

describe("preprocessCode — names inside string literals are NOT renamed", () => {
  test("single-quoted string content is preserved verbatim", () => {
    expect(run("'oldName'", "oldName", "newName")).toBe("'oldName';");
  });

  test("double-quoted string content (even containing the token) is preserved", () => {
    expect(run('"oldName is here"', "oldName", "newName")).toBe(
      '"oldName is here";'
    );
  });

  test("token only inside a string-valued object property is preserved", () => {
    // The KEY `label` is not oldName; the string VALUE contains the token but is
    // never an Identifier, so it stays literal.
    expect(run("{ label: 'the oldName node' }", "oldName", "newName")).toBe(
      "({\n  label: 'the oldName node'\n});"
    );
  });
});

describe("preprocessCode — multi-line return strip / re-prepend round-trip", () => {
  test("multi-line body with a trailing `return X` round-trips and renames X", () => {
    // The canonical happy path: last line `return w` is stripped to `w` before
    // parse, the body renames `$root` -> `main`, then `return ` is re-prepended.
    expect(run("const w = $root\nreturn w", "$root", "main")).toBe(
      "const w = main;\nreturn w;"
    );
  });

  test("multi-line body WITHOUT return does not gain one", () => {
    expect(run("const a = 1\noldName", "oldName", "newName")).toBe(
      "const a = 1;\nnewName;"
    );
  });

  test("multi-line `return <expr-with-oldName>` renames inside the returned expr", () => {
    expect(run("const a = oldName\nreturn a", "oldName", "newName")).toBe(
      "const a = newName;\nreturn a;"
    );
  });

  test("trailing blank/whitespace lines are filtered before the last-line logic", () => {
    // The `.filter(line => line.trim() !== '')` drops the empty tail lines so
    // the LAST line for strip/re-prepend is the real `return a`, not "".
    expect(run("const a = oldName\nreturn a\n\n  \n", "oldName", "newName")).toBe(
      "const a = newName;\nreturn a;"
    );
  });

  test(".replace('return ',\"\") strips only the FIRST 'return ' of the last line", () => {
    // Last line `return returnX`: the FIRST 'return ' is removed leaving
    // `returnX` (a different identifier, NOT oldName), then re-prepended. The
    // SECOND 'return' substring inside `returnX` is untouched — this is the
    // first-occurrence edge working in our favor here.
    expect(run("const returnX = oldName\nreturn returnX", "oldName", "newName")).toBe(
      "const returnX = newName;\nreturn returnX;"
    );
  });
});

describe("preprocessCode — parse failure falls back to literal \"error\" (silent-corruption path)", () => {
  // These pin the SWALLOWED-PARSE-ERROR path. The function returns the literal
  // string `"error"` (WITH quotes) and logs to console — the original code is
  // DESTROYED. This is the silent-corruption surface; pinning it means any
  // future change that starts throwing, or starts preserving the source, flips
  // a RED test on purpose.

  test("syntactically invalid code collapses to the \"error\" literal", () => {
    expect(run("this is not valid js !!!", "oldName", "newName")).toBe('"error"');
  });

  test("defect (characterized): a SINGLE-LINE `return X` is NOT stripped, so acorn rejects the illegal top-level return and the code is lost", () => {
    // BUG-CLASS PIN. isMultiLine is false for a single line, so the return-strip
    // is skipped, `return $root` is parsed as-is, acorn errors ("'return'
    // outside of function"), and the rename is LOST -> '"error"'. A single-line
    // frame action of the form `return <expr referencing the node>` silently
    // loses its node-id rewrite. If single-line return handling is ever fixed,
    // this becomes `return main;` and this assertion must be updated.
    expect(run("return $root", "$root", "main")).toBe('"error"');
    expect(run("return {oldName: 1}", "oldName", "newName")).toBe('"error"');
  });

  test("defect (characterized): on parse failure of a MULTI-LINE return body, \"error\" is still wrapped back in `return `", () => {
    // The re-prepend branch keys off `hasReturn` (detected pre-parse), NOT off a
    // successful parse. So a failed multi-line return body yields the doubly
    // wrong `return "error"` — the source is destroyed AND falsely framed as a
    // returned value. Pinning the exact corrupted shape.
    expect(run("a\nb\nreturn return $root", "$root", "main")).toBe('return "error"');
  });
});

describe("preprocessCode — UNANCHORED 'return ' substring handling (defect class)", () => {
  test("defect (characterized): `.replace('return ', '')` mutilates a last line that merely CONTAINS 'return ' as a substring", () => {
    // BUG-CLASS PIN (the heart of the rename-corruption family). Last line
    // `myreturn = oldName` contains the substring "return " inside the
    // identifier `myreturn`. The unanchored strip turns it into `my = oldName`,
    // acorn parses `my = newName`, then `.includes('return')` (also unanchored)
    // is true so `return ` is re-prepended => the last line becomes
    // `return my = newName;`. The identifier `myreturn` was CORRUPTED into `my`
    // and a bogus `return` framing was added (the prior `a` line is preserved as
    // `a;`). A correct fix (anchor 'return' to a statement boundary) would leave
    // `myreturn = newName;` intact and flip this test.
    expect(run("a\nmyreturn = oldName", "oldName", "newName")).toBe(
      "a;\nreturn my = newName;"
    );
  });

  test("defect (characterized): a comment on the last line is treated as 'return' content and dropped", () => {
    // Last line `// return comment with oldName` is non-blank so it survives the
    // filter; `.includes('return')` is true; `.replace('return ','')` trims the
    // first 'return ' from inside the comment, acorn ignores the comment so only
    // `a` survives, and `return ` is re-prepended => `return a;`. The token
    // inside the comment is silently gone and a spurious return is synthesized.
    expect(run("a\n// return comment with oldName", "oldName", "newName")).toBe(
      "return a;"
    );
  });
});

describe("preprocessCode — binding vs reference rename (acorn-walk visits value-position Identifiers only)", () => {
  // acorn-walk's ancestor() base visitor does NOT descend into BINDING
  // identifier slots (FunctionDeclaration.id, VariableDeclarator.id, params):
  // it only visits REFERENCE/value-position Identifiers. So a declaration named
  // oldName is not renamed, but its uses are. For frame node-ids (always
  // referenced, never declared as JS bindings) this is harmless, but it is a
  // sharp characterization fact: if the walker base ever changes, these flip.

  test("characterized: a function DECLARATION name is not renamed (binding slot)", () => {
    expect(run("function oldName(){ return 1 }", "oldName", "newName")).toBe(
      "function oldName() {\n  return 1;\n}"
    );
  });

  test("characterized: a const DECLARATION name is not renamed, but its later USE is", () => {
    expect(run("const oldName = 1\noldName", "oldName", "newName")).toBe(
      "const oldName = 1;\nnewName;"
    );
  });
});

describe("preprocessCode — non-string and empty inputs (ensureString coercion)", () => {
  test("null/undefined code coerces to empty and yields empty output", () => {
    expect(run(null, "oldName", "newName")).toBe("");
    expect(run(undefined, "oldName", "newName")).toBe("");
  });

  test("empty / whitespace-only code yields empty output", () => {
    expect(run("", "oldName", "newName")).toBe("");
    expect(run("   ", "oldName", "newName")).toBe("");
  });

  test("a numeric code value is stringified and parsed", () => {
    // ensureString(42) -> "42"; acorn parses the numeric literal.
    expect(run(42, "oldName", "newName")).toBe("42;");
  });
});
