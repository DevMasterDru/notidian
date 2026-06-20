// Co-located adversarial + property suite for the PURE, superstate-free top half
// of src/core/utils/frames/frame.ts (bd Notidian-eeoa). frame.ts had ZERO prior
// coverage; everything above the makemd-core `saveFrameRoot` boundary (line ~147)
// is reached on the frame-execution / render path:
//
//   - parseLinkedPropertyToValue(property): routes a frame-property string —
//     `$contexts`-prefixed -> parseContextNode, else parseLinkedNode.
//   - parseContextNode / parseLinkedNode: multi-line-aware acorn.parse +
//     acorn-walk simple(MemberExpression) walkers that BUILD a `path` array out
//     of member-access segments, then index path[1]/path[2] (context) or
//     path[0]/path[2] (node) AFTER a `if (path.length < 3) return null` guard.
//     acorn.parse is wrapped in a silent try/catch.
//   - executableChanged / stateChangedForProps: the render-SKIP equality
//     (deepOmit + lodash isEqual) deciding whether a frame node re-renders.
//
// Why this is crash/empty-result territory: the walkers split('\n') and re-join
// arbitrary user / imported frame text, run it through acorn, then blindly index
// path[1]/path[2]/path[0]. A malformed string, a computed bracket whose property
// is a non-literal (an Identifier or a nested MemberExpression rather than a
// Literal), or a deeply nested member chain all flow through here — any one of
// them throwing would crash the render path; a wrong equality would either
// short-circuit a needed re-render or thrash it.
//
// This suite imports ONLY the pure top-half exports. The makemd-core
// `Superstate` import in frame.ts is type-only, so ts-jest elides it and the
// module loads clean under the node jest env (no DOM, no superstate). The
// superstate-dependent saveFrameRoot / replaceFrameWithFrameRoot /
// mdbFrameToDBTables below line 147 are explicitly out of scope and untouched.
//
// What is LOCKED here (the *actual* observed behaviour — this is an adversarial
// lock, not an idealized spec):
//   1. Happy path: valid $contexts['ctx'].prop and $root['node'].prop in BOTH
//      computed-bracket and dot notation return the correct {context,prop} /
//      {node,prop}; multi-line trailing-`return` blocks parse to the same shape.
//      Note the real contract: `node` is path[0] (the BASE identifier, e.g.
//      "$root"), and `prop` is path[2] (the THIRD member segment), never deeper.
//   2. Guards: a SHORT chain (<3 path members) returns null, not a crash; an
//      empty/whitespace/non-parseable/stringIsConst input returns null; null /
//      undefined input returns null.
//   3. Never-throws: a computed bracket with a NON-literal property (an
//      Identifier, or a nested member like obj.key), and arbitrarily deep nested
//      member expressions, produce a possibly-nonsense-but-defined result and
//      NEVER throw. (No extra never-throw guard is added: the existing acorn
//      try/catch + length<3 guard already make the render path crash-proof for
//      every adversarial input exercised here — asserted explicitly below.)
//   4. Routing: parseLinkedPropertyToValue sends a `$contexts`-prefixed string
//      through parseContextNode (returning its .prop) and every other string
//      through parseLinkedNode (returning its .prop); falsy input -> null.
//   5. executableChanged: IGNORES execProps/execStyles/execActions/
//      execPropsOptions/parent (changing only those = NOT changed); a real
//      node/id/isRef/children/editorProps diff = changed; tolerates parent
//      back-refs (deepOmit strips `parent`, so an isEqual on a parent-cycle does
//      not blow the stack).
//   6. stateChangedForProps: returns ONLY the setters whose newState prop
//      deep-differs from the current prop; a missing schemaID (optional-chain
//      short-circuit) or a missing newState entry yields NO false positive and
//      NO crash.
//
// Pure logic. No `new Function`, no eval, no user code is executed — the parsers
// only read AST node shapes; the equalities only diff plain objects.

import {
  parseContextNode,
  parseLinkedNode,
  parseLinkedPropertyToValue,
  executableChanged,
  stateChangedForProps,
} from "./frame";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode, FrameTreeProp } from "shared/types/mframe";

// ---------------------------------------------------------------------------
// Builders — minimal FrameNode / FrameExecutable shapes; only the fields the
// equalities actually read need to be real, the rest are well-typed filler.
// ---------------------------------------------------------------------------

const plainNode = (id: string, props: Record<string, string> = {}): FrameNode => ({
  id,
  schemaId: "s1",
  name: id,
  type: "text",
  rank: 0,
  props,
  styles: {},
  actions: {},
  types: {},
});

const baseExec = (
  id: string,
  node: FrameNode,
  children: FrameExecutable[] = []
): FrameExecutable =>
  ({
    id,
    node,
    isRef: false,
    children,
    editorProps: { editMode: 0 },
    parent: null,
  } as unknown as FrameExecutable);

// ===========================================================================
// 1. parseContextNode — happy path + notation equivalence
// ===========================================================================
describe("parseContextNode — valid $contexts access", () => {
  it("computed bracket: $contexts['ctx'].prop -> {context,prop} (path[1],path[2])", () => {
    expect(parseContextNode("$contexts['ctx'].propA")).toEqual({
      context: "ctx",
      prop: "propA",
    });
  });

  it("dot notation: $contexts.ctx.prop -> the SAME shape", () => {
    expect(parseContextNode("$contexts.ctx.propA")).toEqual({
      context: "ctx",
      prop: "propA",
    });
  });

  it("double-quoted bracket literal works identically", () => {
    expect(parseContextNode('$contexts["ctx"].propA')).toEqual({
      context: "ctx",
      prop: "propA",
    });
  });

  it("a DEEPER chain still keys off path[2] only (prop is the 3rd segment, not the leaf)", () => {
    // $contexts['ctx'].props.deep.more -> path ['$contexts','ctx','props','deep','more']
    // context=path[1]='ctx', prop=path[2]='props'. Deeper members are ignored.
    expect(parseContextNode("$contexts['ctx'].props.deep.more")).toEqual({
      context: "ctx",
      prop: "props",
    });
  });

  it("multi-line block with a trailing `return` parses to the context shape", () => {
    const block = "const x = 1\nreturn $contexts['ctx'].propA";
    expect(parseContextNode(block)).toEqual({ context: "ctx", prop: "propA" });
  });

  it("multi-line block whose trailing line has NO `return` still parses", () => {
    const block = "const x = 1\n$contexts['ctx'].propA";
    expect(parseContextNode(block)).toEqual({ context: "ctx", prop: "propA" });
  });
});

// ===========================================================================
// 2. parseLinkedNode — happy path + notation equivalence
// ===========================================================================
describe("parseLinkedNode — valid $root access", () => {
  it("computed bracket: $root['n1'].prop -> {node: '$root', prop} (path[0],path[2])", () => {
    // The real contract: `node` is the BASE identifier path[0] ('$root'), NOT
    // the bracketed node name. Locked deliberately.
    expect(parseLinkedNode("$root['n1'].propB")).toEqual({
      node: "$root",
      prop: "propB",
    });
  });

  it("dot notation: $root.n1.prop -> the SAME shape", () => {
    expect(parseLinkedNode("$root.n1.propB")).toEqual({
      node: "$root",
      prop: "propB",
    });
  });

  it("a DEEPER chain keys off path[2] (prop is the 3rd segment)", () => {
    // $root['n1'].props.deep.more -> path ['$root','n1','props','deep','more']
    expect(parseLinkedNode("$root['n1'].props.deep.more")).toEqual({
      node: "$root",
      prop: "props",
    });
  });

  it("multi-line block with trailing `return` parses to the node shape", () => {
    const block = "const x = 1\nreturn $root['n1'].propB";
    expect(parseLinkedNode(block)).toEqual({ node: "$root", prop: "propB" });
  });

  it("a non-$root base identifier is captured at path[0] just the same", () => {
    expect(parseLinkedNode("someNode['x'].value")).toEqual({
      node: "someNode",
      prop: "value",
    });
  });

  it("a call wrapping the member chain still yields the inner node/prop (no throw)", () => {
    expect(parseLinkedNode("doThing($root['n1'].propB)")).toEqual({
      node: "$root",
      prop: "propB",
    });
  });
});

// ===========================================================================
// 3. Guards — short chains and empty/const/falsy input return null, not a crash
// ===========================================================================
describe("parseContextNode / parseLinkedNode — null-returning guards", () => {
  const guarded = (fn: (s: string) => unknown, name: string) => {
    describe(name, () => {
      it("a 2-member chain (<3 path) returns null", () => {
        expect(fn("$root.n1")).toBeNull();
      });
      it("a 1-member identifier returns null", () => {
        expect(fn("$root")).toBeNull();
      });
      it("empty string returns null", () => {
        expect(fn("")).toBeNull();
      });
      it("whitespace-only returns null", () => {
        expect(fn("   \n  \t ")).toBeNull();
      });
      it("non-parseable JS returns null (acorn try/catch -> empty path -> <3)", () => {
        expect(fn("this is not ( valid javascript {{{")).toBeNull();
      });
      it("unterminated string returns null", () => {
        expect(fn("'oops")).toBeNull();
      });
      it("a numeric-literal stringIsConst input returns null", () => {
        expect(fn("42")).toBeNull();
      });
      it("a quoted-literal stringIsConst input returns null", () => {
        expect(fn("'hello'")).toBeNull();
      });
      it("an array-literal stringIsConst input returns null", () => {
        expect(fn("[1, 2, 3]")).toBeNull();
      });
      it("a boolean stringIsConst input returns null", () => {
        expect(fn("true")).toBeNull();
      });
      it("null input returns null", () => {
        expect(fn(null as unknown as string)).toBeNull();
      });
      it("undefined input returns null", () => {
        expect(fn(undefined as unknown as string)).toBeNull();
      });
    });
  };
  guarded(parseContextNode, "parseContextNode");
  guarded(parseLinkedNode, "parseLinkedNode");
});

// ===========================================================================
// 4. Never-throws — hostile member shapes produce a defined result, never throw.
//    This is the crash surface the bead is about: computed brackets with a
//    NON-literal property and arbitrarily deep member chains. The existing acorn
//    try/catch + length<3 guard already make these crash-proof, so NO extra
//    guard is added; we LOCK that crash-proofness here.
// ===========================================================================
describe("parsers never throw on adversarial member shapes", () => {
  const adversarial: Array<[string, unknown]> = [
    ["non-parseable JS", "this is not ( valid {{{"],
    ["empty string", ""],
    ["whitespace only", "   \n\t  "],
    ["null", null],
    ["undefined", undefined],
    ["bare object literal", "{ a: 1 }"],
    ["parenthesized object literal", "({ a: 1 })"],
    ["computed member with Identifier property", "$root[someVar].propB"],
    ["computed context with Identifier property", "$contexts[someVar].propA"],
    ["computed member with nested member property", "$root[obj.key].value"],
    ["optional chaining", "$root?.n1?.propB"],
    ["deep nested member chain", "$root.a.b.c.d.e.f.g"],
    ["call expression wrapping", "fn($root['n'].p, $contexts['c'].q)"],
    ["array of members", "[$root['n1'].p, $contexts['c'].q]"],
    ["template literal with member", "`${$root['n1'].p}-x`"],
    ["dangling return keyword", "return $root['n1'].p"],
    ["multi-line with blank lines", "\n\n$root['n1'].propB\n\n"],
    ["only a return keyword", "return"],
    ["number literal value", 42],
    ["unterminated bracket", "$root['n1'"],
    ["assignment expression", "$root['n1'].p = 5"],
  ];

  it.each(adversarial)(
    "parseContextNode does not throw on %s",
    (_label, value) => {
      expect(() => parseContextNode(value as string)).not.toThrow();
    }
  );

  it.each(adversarial)(
    "parseLinkedNode does not throw on %s",
    (_label, value) => {
      expect(() => parseLinkedNode(value as string)).not.toThrow();
    }
  );

  it.each(adversarial)(
    "parseLinkedPropertyToValue does not throw on %s",
    (_label, value) => {
      expect(() => parseLinkedPropertyToValue(value as string)).not.toThrow();
    }
  );

  it("a computed bracket with a non-literal property yields prop=path[2] without throwing", () => {
    // $contexts[someVar].propA -> path ['$contexts', undefined, 'propA']:
    // computed property.value is undefined (the property is an Identifier, not a
    // Literal). length is 3, so it passes the guard; context=undefined,
    // prop='propA'. The key invariant: no throw and prop is still recovered.
    const r = parseContextNode("$contexts[someVar].propA") as { prop: string };
    expect(r).not.toBeNull();
    expect(r.prop).toBe("propA");
  });

  it("a deeply-nested computed key never throws and returns a defined object", () => {
    // $root[obj.key].value walks the inner obj.key member first; the result is
    // intentionally garbage-but-defined. We lock 'does not throw, not null'.
    expect(() => parseLinkedNode("$root[obj.key].value")).not.toThrow();
    expect(parseLinkedNode("$root[obj.key].value")).not.toBeNull();
  });

  it("real content WRAPPED in blank lines parses correctly (blank-line filter)", () => {
    // bd Notidian-eeoa: the multi-line branch filters out blank lines before
    // rewriting the last one. Real content surrounded by blanks must still parse;
    // a string of ONLY blanks must filter to [] and return null, not crash.
    expect(parseLinkedNode("\n\n$root['n1'].propB\n\n")).toEqual({
      node: "$root",
      prop: "propB",
    });
    expect(parseContextNode("\n\n$contexts['c'].q\n\n")).toEqual({
      context: "c",
      prop: "q",
    });
    expect(parseLinkedNode("   \n  \t ")).toBeNull();
    expect(parseContextNode("\n \n\t")).toBeNull();
  });
});

// ===========================================================================
// 5. parseLinkedPropertyToValue — routing
// ===========================================================================
describe("parseLinkedPropertyToValue — routes by $contexts prefix", () => {
  it("a $contexts-prefixed string routes through parseContextNode and returns .prop", () => {
    expect(parseLinkedPropertyToValue("$contexts['ctx'].propA")).toBe("propA");
  });

  it("a $root string routes through parseLinkedNode and returns .prop", () => {
    expect(parseLinkedPropertyToValue("$root['n1'].propB")).toBe("propB");
  });

  it("any non-$contexts string routes through parseLinkedNode", () => {
    expect(parseLinkedPropertyToValue("someNode['x'].value")).toBe("value");
  });

  it("falsy input returns null (the leading !property guard)", () => {
    expect(parseLinkedPropertyToValue("")).toBeNull();
    expect(parseLinkedPropertyToValue(null as unknown as string)).toBeNull();
    expect(parseLinkedPropertyToValue(undefined as unknown as string)).toBeNull();
  });

  it("a $contexts string that fails the <3 guard returns undefined WITHOUT throwing", () => {
    // bd Notidian-eeoa: parseContextNode('$contexts.ctx') -> null. The OLD code
    // bare-destructured `{context,prop}` off that null and threw on the render
    // path ('Cannot destructure property context of null'). The fix optional-
    // chains (linkedContext?.prop), so a short/malformed $contexts string now
    // returns undefined cleanly, mirroring the $root branch.
    expect(() => parseLinkedPropertyToValue("$contexts.ctx")).not.toThrow();
    expect(parseLinkedPropertyToValue("$contexts.ctx")).toBeUndefined();
  });

  it("a non-parseable $contexts-prefixed string returns undefined WITHOUT throwing", () => {
    expect(() =>
      parseLinkedPropertyToValue("$contexts((( broken")
    ).not.toThrow();
    expect(parseLinkedPropertyToValue("$contexts((( broken")).toBeUndefined();
  });

  it("a non-$contexts string that fails the <3 guard returns undefined (linkedNode?.prop)", () => {
    // parseLinkedNode('$root.n1') -> null; optional chain `linkedNode?.prop`
    // yields undefined, no throw.
    expect(parseLinkedPropertyToValue("$root.n1")).toBeUndefined();
  });
});

// ===========================================================================
// 6. executableChanged — render-skip equality ignores exec*/parent
// ===========================================================================
describe("executableChanged — omits execProps*/parent before isEqual", () => {
  it("two structurally-identical executables compare as NOT changed", () => {
    const a = baseExec("root", plainNode("root", { p: "1" }));
    const b = baseExec("root", plainNode("root", { p: "1" }));
    expect(executableChanged(a, b)).toBe(false);
  });

  it("changing ONLY execProps does NOT count as changed (omitted key)", () => {
    const a = baseExec("root", plainNode("root", { p: "1" }));
    const b = baseExec("root", plainNode("root", { p: "1" }));
    (a as unknown as { execProps: unknown }).execProps = { p: "A" };
    (b as unknown as { execProps: unknown }).execProps = { p: "TOTALLY DIFFERENT" };
    expect(executableChanged(a, b)).toBe(false);
  });

  it("changing ONLY execStyles / execActions / execPropsOptions is NOT a change", () => {
    const a = baseExec("root", plainNode("root"));
    const b = baseExec("root", plainNode("root"));
    Object.assign(a as object, {
      execStyles: { w: "1" },
      execActions: { c: "x" },
      execPropsOptions: { props: [{ name: "p" }] },
    });
    Object.assign(b as object, {
      execStyles: { w: "999" },
      execActions: { c: "ZZZ" },
      execPropsOptions: { props: [{ name: "q" }, { name: "r" }] },
    });
    expect(executableChanged(a, b)).toBe(false);
  });

  it("a REAL node-prop diff is detected as changed", () => {
    const a = baseExec("root", plainNode("root", { p: "1" }));
    const b = baseExec("root", plainNode("root", { p: "2" }));
    expect(executableChanged(a, b)).toBe(true);
  });

  it("a changed id / isRef / editorProps is detected as changed", () => {
    const a = baseExec("root", plainNode("root"));
    const bId = baseExec("DIFFERENT", plainNode("root"));
    expect(executableChanged(a, bId)).toBe(true);

    const bRef = baseExec("root", plainNode("root"));
    (bRef as unknown as { isRef: boolean }).isRef = true;
    expect(executableChanged(a, bRef)).toBe(true);

    const bEditor = baseExec("root", plainNode("root"));
    (bEditor as unknown as { editorProps: unknown }).editorProps = { editMode: 2 };
    expect(executableChanged(a, bEditor)).toBe(true);
  });

  it("a differing child node is detected as changed (children are compared)", () => {
    const a = baseExec("root", plainNode("root"), [
      baseExec("c1", plainNode("c1", { x: "1" })),
    ]);
    const b = baseExec("root", plainNode("root"), [
      baseExec("c1", plainNode("c1", { x: "2" })),
    ]);
    expect(executableChanged(a, b)).toBe(true);
  });

  it("tolerates parent back-references (deepOmit strips parent — no cycle blow-up)", () => {
    // Build a real parent<->child cycle on BOTH sides. Without deepOmit('parent'),
    // lodash isEqual would recurse forever / overflow. With it, the parent edge is
    // stripped and the comparison terminates.
    const aParent = baseExec("root", plainNode("root"));
    const aChild = baseExec("c1", plainNode("c1", { x: "1" }));
    (aChild as unknown as { parent: unknown }).parent = aParent;
    aParent.children = [aChild];

    const bParent = baseExec("root", plainNode("root"));
    const bChild = baseExec("c1", plainNode("c1", { x: "1" }));
    (bChild as unknown as { parent: unknown }).parent = bParent;
    bParent.children = [bChild];

    let result!: boolean;
    expect(() => {
      result = executableChanged(aParent, bParent);
    }).not.toThrow();
    // Identical (modulo parent) => not changed.
    expect(result).toBe(false);

    // And a real diff under the cycle is still caught.
    (bChild.node as FrameNode).props = { x: "2" };
    expect(executableChanged(aParent, bParent)).toBe(true);
  });
});

// ===========================================================================
// 7. stateChangedForProps — only deep-differing setters, no false positives
// ===========================================================================
describe("stateChangedForProps — deep-diff filter on present setters", () => {
  const props: FrameTreeProp = { a: 1, b: { x: 1 }, c: "same" };

  it("returns only the setters whose newState prop deep-differs from current", () => {
    const newState: FrameTreeProp = {
      s1: { props: { a: 2, b: { x: 1 }, c: "same" } },
    };
    // a changed (1->2); b deep-equal ({x:1}); c equal. Only 'a' returned.
    expect(
      stateChangedForProps(["a", "b", "c"], props, newState, "s1")
    ).toEqual(["a"]);
  });

  it("a deep change inside a nested object IS detected", () => {
    const newState: FrameTreeProp = {
      s1: { props: { a: 1, b: { x: 2 } } },
    };
    expect(
      stateChangedForProps(["a", "b"], props, newState, "s1")
    ).toEqual(["b"]);
  });

  it("a setter ABSENT from newState[schemaID].props is a no-op (falsy guard)", () => {
    const newState: FrameTreeProp = { s1: { props: { a: 2 } } };
    // 'b' is not present in newState props -> filtered out even though it would
    // differ; only 'a' is reported.
    expect(
      stateChangedForProps(["a", "b"], props, newState, "s1")
    ).toEqual(["a"]);
  });

  it("a falsy newState prop value (e.g. 0 / '' / null) is treated as no-change", () => {
    // newState[schemaID].props[f] must be truthy to even be considered; a 0/''
    // newState value short-circuits to 'no change' regardless of current.
    const newState: FrameTreeProp = {
      s1: { props: { a: 0, c: "" } },
    };
    expect(
      stateChangedForProps(["a", "c"], props, newState, "s1")
    ).toEqual([]);
  });

  it("a MISSING schemaID yields no setters and does NOT throw (optional chain)", () => {
    const newState: FrameTreeProp = { other: { props: { a: 2 } } };
    let result!: string[];
    expect(() => {
      result = stateChangedForProps(["a", "b", "c"], props, newState, "missing");
    }).not.toThrow();
    expect(result).toEqual([]);
  });

  it("an entirely empty newState yields no setters and does NOT throw", () => {
    expect(stateChangedForProps(["a", "b"], props, {}, "s1")).toEqual([]);
  });

  it("an empty propSetters list returns empty regardless of state", () => {
    const newState: FrameTreeProp = { s1: { props: { a: 2 } } };
    expect(stateChangedForProps([], props, newState, "s1")).toEqual([]);
  });

  it("identical current and new props report NO change (no false positives)", () => {
    const newState: FrameTreeProp = {
      s1: { props: { a: 1, b: { x: 1 }, c: "same" } },
    };
    expect(
      stateChangedForProps(["a", "b", "c"], props, newState, "s1")
    ).toEqual([]);
  });

  it("a missing `props` on the current side still reports present, differing setters", () => {
    const newState: FrameTreeProp = { s1: { props: { a: 5 } } };
    // props?.[f] is undefined for every f -> any truthy newState value differs.
    expect(
      stateChangedForProps(["a"], undefined as unknown as FrameTreeProp, newState, "s1")
    ).toEqual(["a"]);
  });
});

// ===========================================================================
// 8. Property-style invariant — random member chains never throw and obey the
//    length<3 contract. Deterministic xorshift => reproducible.
// ===========================================================================
describe("parser invariants over randomized member chains", () => {
  const RUNS = 200;
  let seed = 0x1234abcd;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0xffffffff;
  };

  const segments = ["a", "b", "ctx", "n1", "propA", "propB", "props"];
  const seg = () => segments[Math.floor(rand() * segments.length)];

  const buildChain = (base: string, depth: number, computed: boolean): string => {
    let s = base;
    for (let i = 0; i < depth; i++) {
      if (computed && rand() < 0.5) {
        s += `['${seg()}']`;
      } else {
        s += `.${seg()}`;
      }
    }
    return s;
  };

  it("never throws; <3-member chains are null, >=3 are a defined {node/context, prop} object", () => {
    for (let r = 0; r < RUNS; r++) {
      const base = rand() < 0.5 ? "$contexts" : "$root";
      const depth = Math.floor(rand() * 6); // 0..5 members after the base
      const chain = buildChain(base, depth, rand() < 0.5);
      const isContext = base === "$contexts";
      const fn = isContext ? parseContextNode : parseLinkedNode;

      let result!: unknown;
      expect(() => {
        result = fn(chain);
      }).not.toThrow();

      // The path length equals (base counted once) + number of appended members.
      // The walker pushes the base identifier once + one entry per member access.
      // A chain with <2 appended members can never reach length 3, so it is null.
      if (depth < 2) {
        expect(result).toBeNull();
      } else if (result !== null) {
        // When non-null, it is a well-formed object exposing `prop`.
        expect(result).toHaveProperty("prop");
        if (isContext) {
          expect(result).toHaveProperty("context");
        } else {
          expect(result).toHaveProperty("node");
        }
      }
    }
  });

  it("parseLinkedPropertyToValue never throws over random chains and falsy noise", () => {
    const noise = ["", "   ", "((((", "{ a: 1 }", "return", "42", "[1,2]"];
    for (let r = 0; r < RUNS; r++) {
      const useNoise = rand() < 0.3;
      const input = useNoise
        ? (noise[Math.floor(rand() * noise.length)] as string)
        : buildChain(rand() < 0.5 ? "$contexts" : "$root", 1 + Math.floor(rand() * 4), rand() < 0.5);
      expect(() => parseLinkedPropertyToValue(input)).not.toThrow();
    }
  });
});
