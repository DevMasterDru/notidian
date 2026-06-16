import {
  parseFormula,
  runFormulaNode,
  FormulaNode,
} from "./parser";
import { SpaceProperty, DBRow } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// Co-located unit coverage for the pure formula-evaluation engine
// (parser.ts: parseFormula / runFormulaNode). These functions are offline,
// deterministic, and produce derived values the user reads as DATA — so this
// suite LOCKS the current observable behavior rather than changing it.
//
// Engine shape (verified, not assumed):
//   * parseFormula(src, propMap) -> { formula: FormulaNode | undefined, errors }
//     It wraps mathjs's parser and lowers the mathjs AST into a small typed
//     FormulaNode tree (property / function / operator / conditional / literal /
//     symbol / error). Unsupported mathjs node kinds (arrays, ranges, blocks,
//     assignments, ...) lower to an `error` node; a hard mathjs parse failure
//     yields { formula: undefined, errors: ["Could not parse formula 😭"] }.
//
//   * runFormulaNode(node, propMap) walks a FormulaNode against a flat row
//     (DBRow = Record<string,string>). It is a PARTIAL evaluator: for function
//     and operator nodes it re-evaluates by stringifying the already-evaluated
//     child args and feeding the concatenation back to a fresh mathjs context.
//     That means string LITERAL args round-trip (they keep their quotes) but a
//     string PROPERTY value injected into a nested function loses its quotes and
//     becomes an undefined mathjs symbol — see the "engine boundaries" block.
//     The defensive "" fallbacks live in the runFormula / runFormulaWithContext
//     wrappers (try/catch), not in runFormulaNode itself.
//
// NOTE (Notidian-ie5r — fixed): a conditional whose CONDITION is a boolean
// (a true/false keyword, or a symbol/operator returning a real boolean) now
// selects the correct branch. runFormulaNode previously compared only
// `condition === "true"` (string) while a boolean condition evaluates to the JS
// boolean `true`, so every boolean-conditioned ternary fell through to ifFalse;
// it now accepts both forms (`condition === "true" || condition === true`),
// keeping the exact-match contract (no broadening to a truthy check). Verified
// by the "engine boundaries" block below. (This standalone walker is offline
// only; the production render path uses runFormulaWithContext / mathjs evaluate
// and was never affected.)
// ---------------------------------------------------------------------------

const propMap: SpaceProperty[] = [
  { name: "Title", type: "text" },
  { name: "Count", type: "number" },
  { name: "When", type: "date" },
];

const node = (src: string): FormulaNode => {
  const { formula } = parseFormula(src, propMap);
  if (!formula) throw new Error(`expected ${src} to parse to a FormulaNode`);
  return formula;
};

const run = (src: string, row: DBRow = {}): unknown =>
  runFormulaNode(node(src), row);

describe("parseFormula -> AST shape", () => {
  it("lowers a prop() reference to a property node, resolving the declared type", () => {
    const { formula, errors } = parseFormula('prop("Title")', propMap);
    expect(errors).toEqual([]);
    expect(formula).toEqual({
      type: "property",
      name: "Title",
      propertyType: "text",
    });
  });

  it("defaults an unknown property's type to 'other'", () => {
    expect(parseFormula('prop("Ghost")', propMap).formula).toEqual({
      type: "property",
      name: "Ghost",
      propertyType: "other",
    });
  });

  it("lowers a function call, recursing into its arguments", () => {
    expect(parseFormula('lower("ABC")', propMap).formula).toEqual({
      type: "function",
      name: "lower",
      args: [{ type: "literal", value: '"ABC"' }],
    });
  });

  it("lowers a binary operator with both operands", () => {
    expect(parseFormula('prop("Count") + 1', propMap).formula).toEqual({
      type: "operator",
      operator: "+",
      args: [
        { type: "property", name: "Count", propertyType: "number" },
        { type: "literal", value: 1 as unknown as string },
      ],
    });
  });

  it("lowers a ternary to a conditional node (boolean condition is a literal, not a symbol)", () => {
    expect(parseFormula('true ? "a" : "b"', propMap).formula).toEqual({
      type: "conditional",
      // mathjs parses `true` as a boolean ConstantNode, so it lowers to a
      // literal node holding the JS boolean — NOT a symbol node.
      condition: { type: "literal", value: true as unknown as string },
      ifTrue: { type: "literal", value: '"a"' },
      ifFalse: { type: "literal", value: '"b"' },
    });
  });

  it("quotes string literals (preserving \\n, \\\" and \\t) and passes numbers through raw", () => {
    expect(parseFormula('"hi"', propMap).formula).toEqual({
      type: "literal",
      value: '"hi"',
    });
    expect(parseFormula('"a\nb"', propMap).formula).toEqual({
      type: "literal",
      value: '"a\\nb"',
    });
    expect(parseFormula("42", propMap).formula).toEqual({
      type: "literal",
      value: 42 as unknown as string,
    });
  });

  it("lowers e and pi to symbol nodes", () => {
    for (const name of ["e", "pi"]) {
      expect(parseFormula(name, propMap).formula).toEqual({ type: "symbol", name });
    }
  });

  it("lowers the boolean keywords true/false to boolean literal nodes (mathjs treats them as constants)", () => {
    expect(parseFormula("true", propMap).formula).toEqual({
      type: "literal",
      value: true as unknown as string,
    });
    expect(parseFormula("false", propMap).formula).toEqual({
      type: "literal",
      value: false as unknown as string,
    });
  });

  it("lowers an undefined identifier to an error node", () => {
    expect(parseFormula("ghost", propMap).formula).toEqual({
      type: "error",
      message: "Undefined constant: ghost",
    });
  });

  it("unwraps parentheses to the inner expression (no parentheses node survives)", () => {
    expect(parseFormula("(1 + 2)", propMap).formula).toEqual({
      type: "operator",
      operator: "+",
      args: [
        { type: "literal", value: 1 as unknown as string },
        { type: "literal", value: 2 as unknown as string },
      ],
    });
  });

  it("lowers unsupported mathjs syntax (array) to an error node", () => {
    const { formula } = parseFormula("[1,2,3]", propMap);
    expect(formula).toEqual({
      type: "error",
      message: "Invalid syntax: [1, 2, 3]",
    });
  });

  it("flags too many arguments to prop()", () => {
    expect(parseFormula('prop("a","b")', propMap).formula).toEqual({
      type: "error",
      message: "Too many arguments passed to prop().",
    });
  });

  it("flags a non-constant property reference", () => {
    expect(parseFormula("prop(ghost)", propMap).formula).toEqual({
      type: "error",
      message: "Invalid property reference: ghost",
    });
  });

  it("returns the canonical parse-failure result for malformed input", () => {
    expect(parseFormula("1 +", propMap)).toEqual({
      formula: undefined,
      errors: ["Could not parse formula 😭"],
    });
  });

  it("never throws on adversarial / garbage input (returns the failure result)", () => {
    for (const bad of ["", "(((", ")", "@@@", "prop(", '"unterminated']) {
      expect(() => parseFormula(bad, propMap)).not.toThrow();
      const { formula, errors } = parseFormula(bad, propMap);
      // either a clean parse-failure, or a lowered node — never an exception
      expect(formula === undefined || typeof formula === "object").toBe(true);
      expect(Array.isArray(errors)).toBe(true);
    }
  });
});

describe("runFormulaNode — literals, symbols, properties, errors", () => {
  it("returns a literal node's stored (quoted) value verbatim", () => {
    expect(runFormulaNode({ type: "literal", value: '"x"' }, {})).toBe('"x"');
  });

  it("reads a property out of the row, falling back to '' when absent", () => {
    const prop: FormulaNode = { type: "property", name: "Title", propertyType: "text" };
    expect(runFormulaNode(prop, { Title: "world" })).toBe("world");
    expect(runFormulaNode(prop, {})).toBe("");
  });

  it("resolves the supported symbols to their string forms", () => {
    expect(runFormulaNode({ type: "symbol", name: "true" }, {})).toBe("true");
    expect(runFormulaNode({ type: "symbol", name: "false" }, {})).toBe("false");
    expect(runFormulaNode({ type: "symbol", name: "pi" }, {})).toBe(
      "3.141592653589793",
    );
    expect(runFormulaNode({ type: "symbol", name: "e" }, {})).toBe(
      "2.718281828459045",
    );
  });

  it("evaluates an error node to '' (never throws)", () => {
    expect(runFormulaNode({ type: "error", message: "boom" }, {})).toBe("");
    // and an error node produced by the parser, end-to-end
    expect(run("[1,2,3]")).toBe("");
    expect(run("ghost")).toBe("");
  });
});

describe("runFormulaNode — string / number / list functions over literal args", () => {
  it("string functions", () => {
    expect(run('upper("abc")')).toBe("ABC");
    expect(run('lower("ABC")')).toBe("abc");
    expect(run('slice("abcdef",1,3)')).toBe("bc");
    expect(run('substring("hello",1)')).toBe("ello");
    expect(run('repeat("ab",3)')).toBe("ababab");
    expect(run('pad("5",3,"0")')).toBe("005");
    expect(run('replace("hello","l","L")')).toBe("heLlo");
    expect(run('contains("hello","ell")')).toBe(true);
    expect(run('startsWith("hello","he")')).toBe(true);
    expect(run('format(3)')).toBe("3");
  });

  it("number / boolean functions and operators", () => {
    expect(run('length("abcd")')).toBe(4);
    expect(run('toNumber("42")')).toBe(42);
    expect(run('empty("")')).toBe(true);
    expect(run('empty("a")')).toBe(false);
    expect(run("1 + 2")).toBe(3);
    expect(run('prop("Count") + 1', { Count: "5" })).toBe(6);
  });
});

describe("runFormulaNode — engine boundaries (pinned, not aspirational)", () => {
  it("a boolean-condition ternary honors the condition (Notidian-ie5r — fixed)", () => {
    // The condition lowers to a boolean literal; runFormulaNode on a literal
    // returns node.value verbatim (the JS boolean `true`/`false`). The
    // conditional branch now accepts BOTH the string "true" and the JS boolean
    // `true` (`condition === "true" || condition === true`), so a boolean
    // condition selects the correct branch. The string-literal branch values
    // round-trip with their quotes (see the partial-evaluator note above).
    expect(run('true ? "a" : "b"')).toBe('"a"');
    expect(run('false ? "a" : "b"')).toBe('"b"');
  });

  it("returns non-string values despite the ': string' signature (type leaks through)", () => {
    expect(typeof run('length("abcd")')).toBe("number");
    expect(typeof run('contains("hello","x")')).toBe("boolean");
    expect(typeof run("1 + 2")).toBe("number");
  });

  it("throws when a string PROPERTY is nested inside a function (lost-quotes limitation)", () => {
    // prop("Title") -> "world" -> re-evaluated as upper(world); `world` is an
    // undefined mathjs symbol. The defensive '' lives in the runFormula
    // wrappers' try/catch, NOT in runFormulaNode.
    expect(() => run('upper(prop("Title"))', { Title: "world" })).toThrow();
  });

  it("throws when a missing property feeds a non-defensive function (.length of undefined)", () => {
    expect(() => run('length(prop("Ghost"))', {})).toThrow();
  });
});

describe("runFormulaNode — determinism", () => {
  it("same node + same row => identical output (pure)", () => {
    const cases = ['upper("abc")', "1 + 2", 'slice("abcdef",1,3)', 'length("abcd")'];
    for (const src of cases) {
      const n = node(src);
      const row: DBRow = { Title: "x", Count: "5" };
      const a = runFormulaNode(n, { ...row });
      const b = runFormulaNode(n, { ...row });
      expect(a).toStrictEqual(b);
    }
  });

  it("evaluating a node does not mutate the input row", () => {
    const row: DBRow = { Title: "world", Count: "5" };
    const snapshot = { ...row };
    runFormulaNode(node('prop("Title")'), row);
    runFormulaNode(node("1 + 2"), row);
    expect(row).toEqual(snapshot);
  });
});
