/**
 * @jest-environment jsdom
 */
// Co-located adversarial + property suite for src/core/utils/frames/executable.ts
// (bd Notidian-ylqv). executable.ts has ZERO prior coverage yet sits on the
// always-on frame-execution render path: runner.ts calls buildExecutable on
// every list-template expansion and feeds execPropsOptions.props (the ORDER
// props/styles are evaluated) and .deps (which cross-node values invalidate a
// node) straight into the prop/style render + the ADR 0018 / Notidian-vke trust
// boundary. Wrong evaluation order or a swallowed dependency silently corrupts
// render; an unhandled throw on imported frame text crashes it.
//
// The load-bearing logic is module-PRIVATE — extractDependencies (an acorn-AST
// walk) and sortKeysByDependencies (a DFS topological sort) are not exported.
// This suite drives them through the only public seam, buildExecutable(root),
// asserting on the observable contract: execPropsOptions.props (topo order +
// per-prop deps) and execPropsOptions.deps (self-id-filtered cross-node deps).
//
// What is locked here:
//   1. Topological correctness: a prop that reads $root.props.a is evaluated
//      AFTER a; chains a<-b<-c order a,b,c; independent props keep declaration
//      order; a self-referencing prop (props.x reading x) is SKIPPED, not a
//      crash and not a phantom dependency.
//   2. Cycle fail-safe (the clear-correct fix this bead adds): a true
//      prop<->prop cycle no longer throws 'Circular dependency detected' on the
//      render path — it degrades to insertion order (every key once) and warns,
//      because buildExecutable is reached from a .catch-less render promise.
//   3. Adversarial AST never throws: non-parseable JS, '', undefined, an object
//      literal ({...}), computed member obj[var], optional chaining
//      (ChainExpression), and deep nested member expressions all flow through
//      acorn.parse's try/catch -> [] (or a sane dep) and buildExecutable
//      completes.
//   4. Structure: nested children recurse (each gets its own execProps*);
//      a list-type node populates execPropsOptions.template; node-level deps
//      exclude the node's own id (f[0] != treeNode.id).
//
// Pure logic. generateCodeForProp DOES produce `new Function(...)` values, but
// this suite NEVER invokes them, so no eval/user code executes. jsdom matches
// the sibling frame suites (trust.test.ts); no DOM is touched.
import { FrameNode } from "shared/types/mframe";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { buildExecutable } from "./executable";

// ---------------------------------------------------------------------------
// Builders — a stored-shaped FrameNode and the FrameTreeNode wrapper exactly as
// the runtime materializes them (mirrors trust.test.ts / trustBoundary.test.ts).
// ---------------------------------------------------------------------------

type Parts = {
  props?: Record<string, string>;
  styles?: Record<string, string>;
  actions?: Record<string, string>;
  types?: Record<string, string>;
};

const plainNode = (id: string, parts: Parts = {}, type = "text"): FrameNode => ({
  id,
  schemaId: "s1",
  name: id,
  type,
  rank: 0,
  props: parts.props ?? {},
  styles: parts.styles ?? {},
  actions: parts.actions ?? {},
  types: parts.types ?? {},
});

const treeNode = (
  node: FrameNode,
  children: FrameTreeNode[] = []
): FrameTreeNode => ({
  id: node.id,
  node,
  isRef: false,
  children,
  editorProps: { editMode: 0 },
  parent: null,
});

// Convenience: build a single-node executable from prop/style strings.
const buildOne = (id: string, parts: Parts, type = "text"): FrameExecutable =>
  buildExecutable(treeNode(plainNode(id, parts, type))) as FrameExecutable;

// Ordered prop names as buildExecutable emits them (the topo order).
const propOrder = (exec: FrameExecutable): string[] =>
  (exec.execPropsOptions?.props ?? []).map((p) => p.name);

// deps recorded for one prop name.
const depsFor = (exec: FrameExecutable, name: string): string[][] =>
  (exec.execPropsOptions?.props ?? []).find((p) => p.name === name)?.deps ?? [];

// ---------------------------------------------------------------------------
// 1. Topological correctness
// ---------------------------------------------------------------------------
describe("buildExecutable topological prop ordering", () => {
  it("orders a dependency before its dependent (b reads $root.props.a => a first)", () => {
    const exec = buildOne("root", {
      props: {
        b: "root.props.a + 1",
        a: "5",
      },
    });
    const order = propOrder(exec);
    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });

  it("orders a dependency CHAIN a<-b<-c so each comes after what it reads", () => {
    const exec = buildOne("root", {
      props: {
        c: "root.props.b + 1",
        b: "root.props.a + 1",
        a: "1",
      },
    });
    const order = propOrder(exec);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("preserves declaration order for fully independent props", () => {
    const exec = buildOne("root", {
      props: { first: "1", second: "2", third: "3" },
    });
    // No edges => DFS visits keys in for..in (declaration) order.
    expect(propOrder(exec)).toEqual(["first", "second", "third"]);
  });

  it("records the local dependency on the dependent prop's .deps", () => {
    const exec = buildOne("root", {
      props: { a: "1", b: "root.props.a" },
    });
    const bDeps = depsFor(exec, "b");
    // The recorded dep path is the full member chain ending in the referenced key.
    expect(bDeps.some((d) => d[d.length - 1] === "a")).toBe(true);
    // The independent prop has no local prop dependency.
    expect(depsFor(exec, "a")).toEqual([]);
  });

  it("keeps every declared prop in the output (none dropped by sorting)", () => {
    const exec = buildOne("root", {
      props: { a: "1", b: "root.props.a", c: "2", d: "root.props.c" },
    });
    expect(new Set(propOrder(exec))).toEqual(new Set(["a", "b", "c", "d"]));
    expect(propOrder(exec)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 2. Self-reference is skipped (not a crash, not a phantom edge/cycle)
// ---------------------------------------------------------------------------
describe("buildExecutable self-reference handling", () => {
  it("a prop that reads its own value (props.x referencing x) is skipped, not crashed", () => {
    expect(() =>
      buildOne("root", { props: { x: "root.props.x + 1" } })
    ).not.toThrow();
    const exec = buildOne("root", { props: { x: "root.props.x + 1" } });
    expect(propOrder(exec)).toEqual(["x"]);
  });

  it("a self-referencing prop does not introduce a spurious circular-dependency failure", () => {
    // Self-dep is filtered out (depStr === key => continue) BEFORE the graph
    // edge is added, so the topo sort sees no cycle and produces a clean order.
    const exec = buildOne("root", {
      props: { x: "root.props.x", y: "root.props.x" },
    });
    expect(new Set(propOrder(exec))).toEqual(new Set(["x", "y"]));
    // y still depends on x => x before y.
    expect(propOrder(exec).indexOf("x")).toBeLessThan(
      propOrder(exec).indexOf("y")
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Cycle fail-safe (the clear-correct contract this bead establishes)
// ---------------------------------------------------------------------------
describe("buildExecutable circular-dependency fail-safe (Notidian-ylqv)", () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("a true prop<->prop cycle DEGRADES to insertion order instead of throwing on the render path", () => {
    // a reads b, b reads a: an unbreakable cycle. The OLD contract threw
    // 'Circular dependency detected'; because buildExecutable is reached from a
    // .catch-less render promise (FrameInstanceContext), that throw silently
    // killed the frame. New contract: complete, keep both keys, warn.
    let exec!: FrameExecutable;
    expect(() => {
      exec = buildOne("root", {
        props: {
          a: "root.props.b + 1",
          b: "root.props.a + 1",
        },
      });
    }).not.toThrow();
    expect(new Set(propOrder(exec))).toEqual(new Set(["a", "b"]));
    // Insertion order, each key exactly once.
    expect(propOrder(exec)).toEqual(["a", "b"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("a longer cycle (a->b->c->a) also degrades, preserving all keys once each", () => {
    const exec = buildOne("root", {
      props: {
        a: "root.props.c",
        b: "root.props.a",
        c: "root.props.b",
      },
    });
    expect(propOrder(exec)).toEqual(["a", "b", "c"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("a cycle in STYLES does not crash buildExecutable either", () => {
    expect(() =>
      buildOne("root", {
        styles: {
          width: "root.styles.height",
          height: "root.styles.width",
        },
      })
    ).not.toThrow();
  });

  it("an acyclic graph that merely LOOKS dense still sorts without a false-positive cycle", () => {
    const exec = buildOne("root", {
      props: {
        a: "1",
        b: "root.props.a",
        c: "root.props.a",
        d: "root.props.b + root.props.c",
      },
    });
    const order = propOrder(exec);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Adversarial AST: extractDependencies must NEVER throw (acorn try/catch->[])
//    and buildExecutable must complete for hostile / malformed prop strings.
// ---------------------------------------------------------------------------
describe("buildExecutable adversarial / malformed prop strings", () => {
  const adversarial: Array<[string, any]> = [
    ["non-parseable JS", "this is not ( valid javascript {{{"],
    ["empty string", ""],
    ["undefined value", undefined],
    ["null value", null],
    ["bare object literal", "{ a: 1, b: root.props.x }"],
    ["parenthesized object literal", "({ a: 1 })"],
    ["computed member obj[var]", "root.props[someVar]"],
    ["computed member with literal index", "root.props['a']"],
    ["optional chaining (ChainExpression)", "root?.props?.a"],
    ["deep nested member expr", "root.props.a.b.c.d.e"],
    ["call expression", "doThing(root.props.a, root.props.b)"],
    ["nested computed + member", "root.props[obj.key].value"],
    ["dangling return keyword", "return root.props.a"],
    ["number literal", 42 as any],
    ["array literal with refs", "[root.props.a, root.props.b]"],
    ["template literal with member", "`${root.props.a}-x`"],
    ["only whitespace", "   \n  \t "],
    ["unterminated string", "'oops"],
  ];

  it.each(adversarial)(
    "does not throw building a prop whose value is %s",
    (_label, value) => {
      expect(() =>
        buildExecutable(
          treeNode(plainNode("root", { props: { value } as any }))
        )
      ).not.toThrow();
    }
  );

  it("non-parseable prop yields no dependencies (acorn parse failure -> [])", () => {
    const exec = buildOne("root", {
      props: { bad: "this is not ( valid javascript {{{" },
    });
    expect(propOrder(exec)).toEqual(["bad"]);
    expect(depsFor(exec, "bad")).toEqual([]);
  });

  it("completes and keeps all keys even when one prop is malformed among valid ones", () => {
    const exec = buildOne("root", {
      props: {
        a: "1",
        broken: "((((",
        b: "root.props.a",
      },
    });
    expect(new Set(propOrder(exec))).toEqual(new Set(["a", "broken", "b"]));
    // The valid edge a<-b still orders correctly despite the malformed sibling.
    expect(propOrder(exec).indexOf("a")).toBeLessThan(
      propOrder(exec).indexOf("b")
    );
  });

  it("an object literal that contains a member ref still completes (no throw)", () => {
    expect(() =>
      buildOne("root", {
        props: { a: "1", obj: "{ x: root.props.a }" },
      })
    ).not.toThrow();
  });

  it("computed and optional-chaining member access never throw and produce sane deps", () => {
    const exec = buildOne("root", {
      props: {
        a: "1",
        viaOptional: "root?.props?.a",
      },
    });
    expect(propOrder(exec)).toContain("a");
    expect(propOrder(exec)).toContain("viaOptional");
  });

  // Notidian-qwc9: a computed member root.props[col] reads a RUNTIME key (the
  // value of `col`), unknowable at parse time. The OLD contract pushed the
  // variable's NAME ('col') as if it were a literal key, registering a PHANTOM
  // dep path ending in 'col'. That path feeds runner.ts's skip-if-unchanged
  // check (store.newState[f[0]][f[1]][f[2]]) — a dep on a key that never exists
  // in state, corrupting render-invalidation precision. New contract: a
  // non-literal computed subscript yields NO static dep (drop it), while a
  // LITERAL subscript root.props['a'] and a STATIC member root.props.a are real
  // resolvable keys and DO record a dep ending in 'a'.
  it("a computed member root.props[col] records NO phantom dep on the variable name", () => {
    const exec = buildOne("root", {
      props: {
        col: "'a'", // a real prop literally named 'col'
        viaComputed: "root.props[col]",
      },
    });
    // No throw, both props survive.
    expect(propOrder(exec)).toContain("col");
    expect(propOrder(exec)).toContain("viaComputed");
    // The computed read resolves to a runtime key, so it contributes NO static
    // dependency at all — and crucially never a phantom dep ending in 'col'.
    const computedDeps = depsFor(exec, "viaComputed");
    expect(computedDeps.some((d) => d[d.length - 1] === "col")).toBe(false);
    // It reads root.props[...] but the subscript is non-literal, so there is no
    // resolvable root.props.* dependency recorded for it.
    expect(
      computedDeps.some((d) => d[0] === "root" && d[1] === "props")
    ).toBe(false);
  });

  it("a LITERAL computed member root.props['a'] still records its real dep", () => {
    const exec = buildOne("root", {
      props: {
        a: "1",
        viaLiteral: "root.props['a']",
      },
    });
    const literalDeps = depsFor(exec, "viaLiteral");
    // obj['a'] === obj.a: a real static key, still a resolvable dependency.
    expect(literalDeps.some((d) => d[d.length - 1] === "a")).toBe(true);
    // And it orders after the prop it reads.
    expect(propOrder(exec).indexOf("a")).toBeLessThan(
      propOrder(exec).indexOf("viaLiteral")
    );
  });

  it("a STATIC member root.props.a still records its real dep (regression guard)", () => {
    const exec = buildOne("root", {
      props: {
        a: "1",
        viaStatic: "root.props.a",
      },
    });
    const staticDeps = depsFor(exec, "viaStatic");
    expect(staticDeps.some((d) => d[d.length - 1] === "a")).toBe(true);
    expect(propOrder(exec).indexOf("a")).toBeLessThan(
      propOrder(exec).indexOf("viaStatic")
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Structure: nested-child recursion, list template, self-id dep filter
// ---------------------------------------------------------------------------
describe("buildExecutable structural contract", () => {
  it("recurses into nested children, building execProps for each level", () => {
    const child = plainNode("child", { props: { cp: "1" } });
    const grandchild = plainNode("gc", { props: { gp: "2" } });
    const root = treeNode(plainNode("root", { props: { rp: "0" } }), [
      treeNode(child, [treeNode(grandchild)]),
    ]);
    const exec = buildExecutable(root) as FrameExecutable;

    expect(exec.execProps).toBeDefined();
    const c = exec.children[0];
    const gc = c.children[0];
    expect(c.execProps).toBeDefined();
    expect(c.execPropsOptions?.props?.map((p) => p.name)).toEqual(["cp"]);
    expect(gc.execProps).toBeDefined();
    expect(gc.execPropsOptions?.props?.map((p) => p.name)).toEqual(["gp"]);
  });

  it("collects descendant ids into execPropsOptions.children", () => {
    const root = treeNode(plainNode("root"), [
      treeNode(plainNode("c1"), [treeNode(plainNode("g1"))]),
      treeNode(plainNode("c2")),
    ]);
    const exec = buildExecutable(root) as FrameExecutable;
    expect(new Set(exec.execPropsOptions?.children)).toEqual(
      new Set(["g1", "c1", "c2"])
    );
  });

  it("populates execPropsOptions.template only for a list-type node", () => {
    const listNode = plainNode("list", {}, "list");
    const root = treeNode(listNode, [treeNode(plainNode("item"))]);
    const exec = buildExecutable(root) as FrameExecutable;
    expect(exec.execPropsOptions?.template).toBeDefined();
    expect(exec.execPropsOptions?.template).toHaveLength(1);
    expect(exec.execPropsOptions?.template?.[0].id).toBe("item");

    const nonList = buildExecutable(
      treeNode(plainNode("plain"), [treeNode(plainNode("kid"))])
    ) as FrameExecutable;
    expect(nonList.execPropsOptions?.template).toBeUndefined();
  });

  it("excludes the node's OWN id from execPropsOptions.deps (self-id filter f[0] != id)", () => {
    // A prop that references the node's own props produces a dep path starting
    // with the node id; that self-edge must be filtered out of node-level deps.
    const exec = buildOne("root", {
      props: { a: "1", b: "root.props.a" },
    });
    const nodeDeps = exec.execPropsOptions?.deps ?? [];
    expect(nodeDeps.every((d) => d[0] !== "root")).toBe(true);
  });

  it("surfaces a CROSS-node dependency (referencing another node's id) in node deps", () => {
    // A child prop reading $other.props.v yields a dep whose head is 'other'
    // (not the child's own id) and must survive the self-id filter, bubbling up.
    const child = plainNode("c1", { props: { v: "other.props.value" } });
    const root = treeNode(plainNode("root"), [treeNode(child)]);
    const exec = buildExecutable(root) as FrameExecutable;
    const childDeps = exec.children[0].execPropsOptions?.deps ?? [];
    expect(childDeps.some((d) => d[0] === "other")).toBe(true);
    // It bubbles to the root's node deps too (root collects children deps).
    const rootDeps = exec.execPropsOptions?.deps ?? [];
    expect(rootDeps.some((d) => d[0] === "other")).toBe(true);
  });

  it("a node with no props/styles/actions builds to empty, well-formed options", () => {
    const exec = buildOne("empty", {});
    expect(exec.execPropsOptions?.props).toEqual([]);
    expect(exec.execPropsOptions?.deps).toEqual([]);
    expect(exec.children).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Property-style invariants — randomized prop sets never break the seam.
// ---------------------------------------------------------------------------
describe("buildExecutable property invariants over random acyclic prop graphs", () => {
  const RUNS = 60;
  let seed = 0x1234abcd;
  const rand = () => {
    // Deterministic xorshift so failures are reproducible.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0xffffffff;
  };

  // Build a strictly-acyclic prop graph: prop i may only reference props < i.
  const makeAcyclicProps = (n: number): Record<string, string> => {
    const names = Array.from({ length: n }, (_, i) => `p${i}`);
    const props: Record<string, string> = {};
    names.forEach((name, i) => {
      if (i === 0 || rand() < 0.4) {
        props[name] = `${i}`;
      } else {
        const refIdx = Math.floor(rand() * i); // strictly < i
        props[name] = `root.props.${names[refIdx]} + ${i}`;
      }
    });
    return props;
  };

  it("never throws and emits a valid topo order for any acyclic prop set", () => {
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    try {
      for (let r = 0; r < RUNS; r++) {
        const n = 1 + Math.floor(rand() * 8);
        const props = makeAcyclicProps(n);
        const names = Object.keys(props);

        let exec!: FrameExecutable;
        expect(() => {
          exec = buildOne("root", { props });
        }).not.toThrow();

        const order = propOrder(exec);
        // Invariant 1: output is a permutation of the input keys (none lost/dup'd).
        expect(new Set(order)).toEqual(new Set(names));
        expect(order).toHaveLength(names.length);

        // Invariant 2: a referenced prop always precedes the prop that reads it.
        order.forEach((name, pos) => {
          const refMatch = props[name].match(/root\.props\.(p\d+)/);
          if (refMatch) {
            const ref = refMatch[1];
            if (ref !== name) {
              expect(order.indexOf(ref)).toBeGreaterThanOrEqual(0);
              expect(order.indexOf(ref)).toBeLessThan(pos);
            }
          }
        });

        // Invariant 3: acyclic input never triggers the cycle fail-safe.
        expect(warnSpy).not.toHaveBeenCalled();
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("never throws for random mixtures of valid refs and malformed garbage", () => {
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const garbage = [
      "(((",
      "{ a: }",
      "root.props[",
      "return return",
      "`${`",
      "????",
      "",
    ];
    try {
      for (let r = 0; r < RUNS; r++) {
        const n = 1 + Math.floor(rand() * 6);
        const props: Record<string, string> = {};
        for (let i = 0; i < n; i++) {
          props[`p${i}`] =
            rand() < 0.5
              ? garbage[Math.floor(rand() * garbage.length)]
              : i > 0
              ? `root.props.p${Math.floor(rand() * i)}`
              : `${i}`;
        }
        const names = Object.keys(props);
        let exec!: FrameExecutable;
        expect(() => {
          exec = buildOne("root", { props });
        }).not.toThrow();
        // Even with garbage, every key survives exactly once.
        expect(new Set(propOrder(exec))).toEqual(new Set(names));
        expect(propOrder(exec)).toHaveLength(names.length);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});
