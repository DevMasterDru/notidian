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
//   1. ensureString(code) coerces non-strings; a top-level `return` is stripped
//      (see 2) and THEN brace-wrapped object literals ({...}) are parenthesized
//      to ({...}) so acorn parses them as an expression, not a block.
//   2. TOP-LEVEL RETURN handling (Notidian-gxx6): a leading `return` is detected
//      and stripped ONLY at a statement boundary via the anchored, word-bounded
//      /^\s*return\b/ — for BOTH single-line and multi-line bodies (multi-line
//      keys off the last non-blank line). The `return` is re-prepended AFTER a
//      SUCCESSFUL parse, structurally onto the last top-level statement (so a
//      multi-line returned object literal is not corrupted). Earlier this was
//      MULTI-LINE-only with UNANCHORED substring ops (.includes/.replace) that
//      mutilated identifiers like `myreturn` and lost single-line returns — the
//      `defect (characterized)` cases below now flipped to regression guards.
//   3. acorn-walk ancestor() renames Identifier nodes whose name === oldName,
//      GUARDED so a MemberExpression PROPERTY name (foo.oldName) is NOT renamed
//      but the OBJECT of a member access (oldName.x) and object-literal KEYS
//      ({oldName: 1}) ARE.
//   4. parse failure is SWALLOWED: string := '"error"' (silent corruption path),
//      and the failed body is NOT re-wrapped in `return ` (Notidian-gxx6).
//
// METHOD. We first characterized the LIVE behavior with throwaway probes, then
// encoded it. Where behavior is CORRECT we assert it as the contract. Cases that
// were DEFECTS were asserted under a `defect (characterized)` label so the
// silent path was PINNED; the Notidian-gxx6 fix flipped them on purpose and they
// are now labelled `fixed (Notidian-gxx6)` REGRESSION GUARDS (never assert buggy
// behavior silently — AGENTS.md Long Autonomous Mode). Pure offline: node env,
// no DOM, no makemd-core runtime.
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

  test("the anchored strip removes only the leading `return` keyword, leaving the returned identifier `returnX` intact", () => {
    // Last line `return returnX`: /^\s*return\b/ matches only the LEADING
    // `return ` keyword and strips it, leaving the identifier `returnX` (a
    // different name, NOT oldName) fully intact; `return ` is re-prepended after
    // a successful parse. The `return` substring INSIDE `returnX` is never
    // touched because `\b` anchors the match to the leading keyword boundary.
    expect(run("const returnX = oldName\nreturn returnX", "oldName", "newName")).toBe(
      "const returnX = newName;\nreturn returnX;"
    );
  });
});

describe("preprocessCode — parse failure falls back to literal \"error\" + return handling (Notidian-gxx6)", () => {
  // The first case pins the SWALLOWED-PARSE-ERROR path: for genuinely invalid JS
  // the function returns the literal string `"error"` (WITH quotes) and logs to
  // console — the original code is DESTROYED. The remaining cases are former
  // `defect (characterized)` pins now flipped to REGRESSION GUARDS by the
  // Notidian-gxx6 fix: single-line returns are handled, and the `"error"`
  // fallback is no longer re-wrapped in `return `.

  test("syntactically invalid code collapses to the \"error\" literal", () => {
    expect(run("this is not valid js !!!", "oldName", "newName")).toBe('"error"');
  });

  test("fixed (Notidian-gxx6): a SINGLE-LINE `return X` is stripped, renamed, and the `return` re-prepended", () => {
    // REGRESSION GUARD (was `defect (characterized)`). A single-line body is now
    // detected as a top-level return via /^\s*return\b/ (not gated on
    // isMultiLine), so `return $root` is stripped to `$root`, the rename runs,
    // and `return ` is re-prepended after a SUCCESSFUL parse. The single-line
    // frame action keeps BOTH its node-id rewrite AND its `return` framing
    // instead of collapsing to the `"error"` literal.
    expect(run("return $root", "$root", "main")).toBe("return main;");
    // `return { oldName: 1 }`: strip `return ` -> `{oldName: 1}` -> brace-wrap
    // (now AFTER the strip) -> `({oldName: 1})` -> key renamed -> `return `
    // re-prepended structurally onto the (multi-line) returned object literal.
    expect(run("return {oldName: 1}", "oldName", "newName")).toBe(
      "return ({\n  newName: 1\n});"
    );
  });

  test("fixed (Notidian-gxx6): on parse failure of a MULTI-LINE return body, the bare \"error\" literal is NOT re-wrapped in `return `", () => {
    // REGRESSION GUARD (was `defect (characterized)`). Last line
    // `return return $root`: the anchored strip removes ONE leading `return`,
    // leaving `return $root`, which is still an illegal top-level return, so
    // acorn fails and the body falls back to the `"error"` literal. Because
    // re-prepend now happens ONLY inside the parse-success branch, the failed
    // body is NOT framed as `return "error"` — it stays the bare `"error"`
    // literal (still a corruption surface, but no longer doubly wrong).
    expect(run("a\nb\nreturn return $root", "$root", "main")).toBe('"error"');
  });
});

describe("preprocessCode — ANCHORED top-level `return` detection (Notidian-gxx6 fix)", () => {
  test("fixed (Notidian-gxx6): a last line that merely CONTAINS 'return' as a substring is left intact (no strip, no spurious return)", () => {
    // REGRESSION GUARD (was `defect (characterized)`, the heart of the
    // rename-corruption family). Last line `myreturn = oldName` contains the
    // substring "return" inside the identifier `myreturn`, but the anchored,
    // word-bounded /^\s*return\b/ does NOT match it, so there is no strip and no
    // re-prepend. The identifier `myreturn` is preserved and only the genuine
    // rename target `oldName -> newName` is applied.
    expect(run("a\nmyreturn = oldName", "oldName", "newName")).toBe(
      "a;\nmyreturn = newName;"
    );
  });

  test("fixed (Notidian-gxx6): a comment on the last line is NOT treated as a return statement", () => {
    // REGRESSION GUARD (was `defect (characterized)`). Last line
    // `// return comment with oldName` starts with `//`, so /^\s*return\b/ does
    // not match: no strip, no re-prepend. acorn still ignores the comment, so the
    // body is just `a;` — but crucially no spurious `return ` is synthesized and
    // the comment line is not mistaken for code. (The token inside the comment is
    // never an Identifier, so it is correctly never renamed.)
    expect(run("a\n// return comment with oldName", "oldName", "newName")).toBe(
      "a;"
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
