import { formulas } from "./formulas";

// ---------------------------------------------------------------------------
// Co-located coverage for the rawArgs formula helpers in formulas.ts.
//
// These functions receive UNEVALUATED mathjs arg nodes plus (math, scope) and
// decide whether to evaluate. Their guard branches (wrong arity / a var slot
// that is not a SymbolNode / a non-array operand) are the offline-testable,
// degrade-gracefully-to-"" contract — exercised here with tiny stub nodes so no
// real mathjs context or vault is needed. We assert the GUARD outputs (the
// safety net), not the happy-path mathjs evaluation (covered via parser.test).
//
// Stub MathNode just needs: isSymbolNode?, name?, toString(), compile().evaluate().
// ---------------------------------------------------------------------------

type StubNode = {
  isSymbolNode?: boolean;
  name?: string;
  toString: () => string;
  compile: () => { evaluate: (scope?: unknown) => unknown };
};

const f = formulas as unknown as Record<
  string,
  ((args: StubNode[], math: any, scope: Map<string, any>) => unknown) & {
    rawArgs?: boolean;
  }
>;

const symbolNode = (name: string): StubNode => ({
  isSymbolNode: true,
  name,
  toString: () => name,
  compile: () => ({ evaluate: () => name }),
});

const nonSymbolNode = (value: unknown = 1): StubNode => ({
  isSymbolNode: false,
  toString: () => String(value),
  compile: () => ({ evaluate: () => value }),
});

const valueNode = (value: unknown): StubNode => ({
  toString: () => JSON.stringify(value),
  compile: () => ({ evaluate: () => value }),
});

const newMath = () => ({ evaluate: jest.fn() });
const newScope = () => new Map<string, any>();

describe("let (rawArgs guard branches)", () => {
  it("is registered as a rawArgs function", () => {
    expect(f.let.rawArgs).toBe(true);
  });

  it("returns '' when the variable slot is not a SymbolNode", () => {
    const math = newMath();
    expect(f.let([nonSymbolNode("x"), valueNode(1), valueNode(2)], math, newScope())).toBe("");
    expect(math.evaluate).not.toHaveBeenCalled();
  });

  it("returns '' on wrong arity (must be exactly 3 args)", () => {
    const math = newMath();
    expect(f.let([symbolNode("x"), valueNode(1)], math, newScope())).toBe("");
    expect(
      f.let([symbolNode("x"), valueNode(1), valueNode(2), valueNode(3)], math, newScope()),
    ).toBe("");
    expect(math.evaluate).not.toHaveBeenCalled();
  });

  it("binds the var then evaluates the body on the happy path", () => {
    const math = newMath();
    const scope = newScope();
    const body = valueNode("RESULT");
    const out = f.let([symbolNode("x"), valueNode(1), body], math, scope);
    expect(math.evaluate).toHaveBeenCalledWith("x = 1", scope);
    expect(out).toBe("RESULT");
  });
});

describe("lets (rawArgs guard branches)", () => {
  it("is registered as a rawArgs function", () => {
    expect(f.lets.rawArgs).toBe(true);
  });

  it("returns '' on even arity (needs an odd count: N pairs + 1 body)", () => {
    const math = newMath();
    expect(f.lets([symbolNode("x"), valueNode(1)], math, newScope())).toBe("");
    expect(math.evaluate).not.toHaveBeenCalled();
  });

  it("returns '' when any variable slot is not a SymbolNode", () => {
    const math = newMath();
    expect(
      f.lets([nonSymbolNode("x"), valueNode(1), valueNode("body")], math, newScope()),
    ).toBe("");
  });

  it("binds every pair then evaluates the trailing body", () => {
    const math = newMath();
    const scope = newScope();
    const body = valueNode("OUT");
    const out = f.lets(
      [symbolNode("a"), valueNode(1), symbolNode("b"), valueNode(2), body],
      math,
      scope,
    );
    expect(math.evaluate).toHaveBeenCalledWith("a = 1", scope);
    expect(math.evaluate).toHaveBeenCalledWith("b = 2", scope);
    expect(out).toBe("OUT");
  });
});

describe("ifs (rawArgs)", () => {
  it("returns '' when the condition/value pairs are mis-arity (even arg count)", () => {
    expect(f.ifs([valueNode(true), valueNode("a")], newMath(), newScope())).toBe("");
  });

  it("returns the first matching branch", () => {
    // ifs evaluates conditions with NO scope (compile().evaluate()) — use bare booleans.
    const trueCond: StubNode = { toString: () => "true", compile: () => ({ evaluate: () => true }) };
    const falseCond: StubNode = { toString: () => "false", compile: () => ({ evaluate: () => false }) };
    expect(
      f.ifs([falseCond, valueNode("a"), trueCond, valueNode("b"), valueNode("fallback")], newMath(), newScope()),
    ).toBe("b");
  });

  it("returns the trailing fallback when nothing matches", () => {
    const falseCond: StubNode = { toString: () => "false", compile: () => ({ evaluate: () => false }) };
    expect(
      f.ifs([falseCond, valueNode("a"), valueNode("fallback")], newMath(), newScope()),
    ).toBe("fallback");
  });
});

describe("array rawArgs helpers — arity + non-array guards degrade to ''", () => {
  const math = newMath();
  const scope = newScope();

  it("filter / some / every / find / findIndex / map require exactly 2 args", () => {
    for (const name of ["filter", "some", "every", "find", "findIndex"]) {
      expect(f[name]([valueNode([1, 2])], math, scope)).toBe("");
    }
    // map's arity guard also returns "" (only its non-array operand returns [])
    expect(f.map([valueNode([1, 2])], math, scope)).toBe("");
  });

  it("flat requires exactly 1 arg", () => {
    expect(f.flat([valueNode([1]), valueNode(2)], math, scope)).toBe("");
  });

  it("returns '' when the operand is not an array (map returns [])", () => {
    expect(f.filter([valueNode("notarray"), valueNode(1)], math, scope)).toBe("");
    expect(f.find([valueNode("notarray"), valueNode(1)], math, scope)).toBe("");
    expect(f.flat([valueNode("notarray")], math, scope)).toBe("");
    expect(f.map([valueNode("notarray"), valueNode(1)], math, scope)).toEqual([]);
  });
});

describe("formatDate (rawArgs) arity guard", () => {
  it("returns '' with zero args or more than two args", () => {
    expect(f.formatDate([], newMath(), newScope())).toBe("");
    expect(
      f.formatDate([valueNode(new Date(2024, 0, 1)), valueNode("yyyy"), valueNode("x")], newMath(), newScope()),
    ).toBe("");
  });

  it("formats a Date with an explicit pattern on the happy path", () => {
    const out = f.formatDate(
      [valueNode(new Date(2024, 0, 2)), valueNode("yyyy-MM-dd")],
      newMath(),
      newScope(),
    );
    expect(out).toBe("2024-01-02");
  });
});

describe("plain (non-rawArgs) helpers — pure data ops", () => {
  it("list helpers", () => {
    expect(formulas.at([10, 20, 30], 1)).toBe(20);
    expect(formulas.first([10, 20, 30])).toBe(10);
    expect(formulas.last([10, 20, 30])).toBe(30);
    expect(formulas.concat([1], [2, 3])).toEqual([1, 2, 3]);
    expect(formulas.join(["a", "b"], "-")).toBe("a-b");
    expect(formulas.includes([1, 2], 2)).toBe(true);
    expect(formulas.split("a,b,c", ",")).toEqual(["a", "b", "c"]);
    expect(formulas.uniques([1, 1, 2])).toBe(2);
    expect(formulas.values([[1, 2], [3]])).toBe(3);
  });

  it("string helpers normalize non-string input via format()", () => {
    expect(formulas.upper("abc")).toBe("ABC");
    expect(formulas.lower("ABC")).toBe("abc");
    expect(formulas.format(3 as unknown as string)).toBe("3");
    expect(formulas.format(new Date(2024, 0, 2) as unknown as string)).toBe("2024-01-02");
    expect(formulas.format(null as unknown as string)).toBe("");
  });

  it("empty() treats falsy / zero-length as empty", () => {
    expect(formulas.empty("")).toBe(true);
    expect(formulas.empty([])).toBe(true);
    expect(formulas.empty(undefined as unknown as string)).toBe(true);
    expect(formulas.empty("x")).toBe(false);
    expect(formulas.empty(["x"])).toBe(false);
  });

  it("date arithmetic helpers are deterministic", () => {
    const base = new Date(2024, 0, 1, 0, 0, 0);
    expect(formulas.year(base)).toBe(2024);
    expect(formulas.month(base)).toBe(1);
    expect(formulas.date(base)).toBe(1);
    expect(
      formulas.dateBetween(new Date(2024, 0, 1), new Date(2024, 0, 11), "days"),
    ).toBe(10);
  });
});
