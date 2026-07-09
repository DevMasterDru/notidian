// Adversarial hostile-shape net for the PURE parent-delete PLANNER
// (Notidian-anhe). requestRowDeleteWithSubItems (nonDestructiveDelete.ts,
// ADR 0050 / Notidian-5ond.8) is the single most data-loss-critical surface in
// the sub-items engine: it decides which descendant .md files a parent-row
// delete destroys. Its pure core is the subtree derivation —
// subtreePathsFromTree over buildRowTree's FULL depth-first output — and a bug
// there is IRREVERSIBLE data loss: an over-broad plan cascade-deletes a row's
// rendered ANCESTOR / SIBLING; an under-broad plan silently ORPHANS children a
// count claimed would be removed.
//
// The companion suite (nonDestructiveDelete.test.ts) pins the six decision-matrix
// EDGES on a single well-formed fixture. This suite instead attacks the planner
// with a SYSTEMATIC net of HOSTILE sub-item graphs — cyclic (A->B->A) and
// self-referential parent links, deep chains, dangling / duplicate / empty
// paths, non-string parent values, and hundreds of randomized graphs — and
// asserts the five planner-safety invariants the bead names:
//
//   (I1) NEVER THROWS on any hostile shape (the sync planning path).
//   (I2) NO OVER-DELETION: the plan never contains a path outside the rendered
//        subtree of the target — never the target itself, its ancestor, or a
//        sibling.
//   (I3) EXACTLY ONCE: every rendered descendant is accounted for exactly once —
//        no orphan silently dropped, no path listed twice — and the modal's
//        claimed count EQUALS the set actually removed.
//   (I4) IDEMPOTENT: planning the same input twice yields an equal plan.
//   (I5) CYCLES TERMINATE: cyclic / self / duplicate graphs plan in finite time
//        (no infinite recursion).
//
// Method (matches the companion suite): the REAL buildRowTree + the REAL
// subtreePathsFromTree run over the hostile fixtures; requestRowDeleteWithSubItems
// is driven end-to-end and its concrete removal PLAN is captured off a capturing
// openModal spy (deleteRecursive invoked directly — no jsdom). The delete set is
// cross-checked against an INDEPENDENT oracle (descendantsOracle) that
// reconstructs the rendered forest from the emitted DEPTH sequence and walks it
// by parent pointers — a different derivation from the SUT's contiguous
// depth-window slice, so an agreement is real evidence and a divergence is a real
// bug. Only deletePath is mocked (its real module pulls a heavy transitive graph
// ts-jest cannot parse here); the planner and the tree utilities stay REAL.

import {
  buildRowTree,
  subtreePathsFromTree,
  RowTreeNode,
} from "core/utils/contexts/tableRowTree";

// Superstate is a type-only import in the SUT, but isolatedModules makes ts-jest
// emit a runtime require — stub the heavy module so the graph stays isolated.
jest.mock("makemd-core", () => ({}));
// Mock ONLY deletePath (the higher-authority, file-destroying sink). If the SUT
// ever escalates a removal to it wrongly, or removes a path outside the plan,
// these spies capture it.
jest.mock("core/superstate/utils/path", () => ({
  deletePath: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deletePath } = require("core/superstate/utils/path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  requestRowDeleteWithSubItems,
} = require("core/utils/contexts/nonDestructiveDelete");

const PATH_KEY = "File";
const PARENT_KEY = "parent";

const treeOf = (rows: Record<string, any>[]): RowTreeNode[] =>
  buildRowTree({ rows, parentKey: PARENT_KEY, pathKey: PATH_KEY });

const pathOfNode = (n: RowTreeNode) => String(n.row[PATH_KEY] ?? "");

// ---------------------------------------------------------------------------
// Independent oracle: the rendered descendant set of `rootPath`, derived from
// buildRowTree's emitted DEPTH sequence WITHOUT reusing subtreePathsFromTree's
// contiguous-window slice. It reconstructs the visual forest (each node's parent
// is the most recent node one depth shallower — the canonical inverse of a
// depth-annotated pre-order flatten) and returns a pre-order DFS of the target's
// subtree. For any well-formed buildRowTree output this MUST equal the SUT's
// slice; the two derivations disagreeing is exactly the data-loss bug this net
// exists to catch.
const descendantsOracle = (
  nodes: RowTreeNode[],
  rootPath: string
): string[] => {
  if (!rootPath) return [];
  const childrenOf = new Map<string, string[]>();
  const openAtDepth: string[] = []; // openAtDepth[d] = path currently open at depth d
  let present = false;
  for (const node of nodes) {
    const path = pathOfNode(node);
    const depth = node.depth;
    // Drop every frame at this depth or deeper before recording the parent link.
    openAtDepth.length = depth;
    if (depth > 0) {
      const parent = openAtDepth[depth - 1];
      if (parent !== undefined) {
        const bucket = childrenOf.get(parent);
        if (bucket) bucket.push(path);
        else childrenOf.set(parent, [path]);
      }
    }
    openAtDepth[depth] = path;
    if (path === rootPath) present = true;
  }
  if (!present) return [];
  const out: string[] = [];
  const seen = new Set<string>([rootPath]);
  const visit = (path: string) => {
    for (const child of childrenOf.get(path) ?? []) {
      if (seen.has(child)) continue; // rendered forest is acyclic; guard anyway
      seen.add(child);
      out.push(child);
      visit(child);
    }
  };
  visit(rootPath);
  return out;
};

// A capturing openModal spy: records (title, element, win) and DOES NOT render.
// The captured element is React.createElement(SubItemDeleteModal, props); we
// reach its props to invoke deleteRecursive / deleteOnly with no jsdom.
type ModalCapture = { title: string; element: any; win: unknown };
const makeSuperstate = (captures: ModalCapture[]): any => ({
  ui: {
    openModal: (title: string, element: any, win: unknown) => {
      captures.push({ title, element, win });
      return { update: () => {}, hide: () => {} };
    },
  },
});

type CapturedPlan = {
  prompted: boolean; // did the parent 3-way modal open (vs a silent leaf delete)?
  subItemCount: number | null; // the count the modal claims (null when silent)
  plan: string[]; // the ordered descendant paths actually removed
  selfCalls: number; // how many times the parent's own removal ran
};

// Drive the REAL planner end-to-end for `rootPath` and capture the concrete
// removal PLAN. On the primary surface descendant removal is deletePath; the
// captured order is the plan the recursive branch executes.
const capturePlan = async (
  rows: Record<string, any>[],
  rootPath: string,
  isPrimarySurface = true
): Promise<CapturedPlan> => {
  (deletePath as jest.Mock).mockReset();
  const captures: ModalCapture[] = [];
  const removed: string[] = [];
  let selfCalls = 0;
  const deleteSelf = jest.fn(async () => {
    selfCalls++;
  });
  const removeFromSurface = jest.fn(async (path: string) => {
    removed.push(path);
  });
  requestRowDeleteWithSubItems({
    superstate: makeSuperstate(captures),
    rootPath,
    subItemsDelete: isPrimarySurface
      ? { treeNodes: treeOf(rows), isPrimarySurface: true }
      : { treeNodes: treeOf(rows), isPrimarySurface: false, removeFromSurface },
    deleteSelf,
    win: {} as Window,
  });
  if (captures.length === 0) {
    // Leaf (or off): silent, immediate deleteSelf, no modal, no descendant removal.
    return { prompted: false, subItemCount: null, plan: [], selfCalls };
  }
  const props = captures[0].element.props;
  props.deleteRecursive();
  // Flush the awaited chain (parent + N descendants + microtask hops).
  for (let i = 0; i < 50; i++) await Promise.resolve();
  const plan = isPrimarySurface
    ? (deletePath as jest.Mock).mock.calls.map((c: any[]) => c[1])
    : removed;
  return { prompted: true, subItemCount: props.subItemCount, plan, selfCalls };
};

// Assert the full planner-safety contract for `rootPath` against `rows`.
// Returns the derived plan for callers that want to add case-specific checks.
const assertPlannerSafe = async (
  rows: Record<string, any>[],
  rootPath: string
): Promise<string[]> => {
  const nodes = treeOf(rows);
  const presentPaths = new Set(nodes.map(pathOfNode));

  // The pure core: derive the plan two independent ways.
  let sliceA: string[] = [];
  let sliceB: string[] = [];
  let oracle: string[] = [];
  expect(() => {
    sliceA = subtreePathsFromTree(nodes, PATH_KEY, rootPath);
    sliceB = subtreePathsFromTree(nodes, PATH_KEY, rootPath); // (I5) re-run terminates
    oracle = descendantsOracle(nodes, rootPath);
  }).not.toThrow(); // (I1) never throws

  // (I4) idempotence: the slice is stable across re-planning.
  expect(sliceB).toEqual(sliceA);
  // Independent-derivation agreement: no over-deletion AND no dropped orphan.
  expect(sliceA).toEqual(oracle);
  // (I3) exactly once: no path appears twice.
  expect(new Set(sliceA).size).toBe(sliceA.length);
  // (I2) no over-deletion: never the target itself; every path is a real node.
  expect(sliceA).not.toContain(rootPath);
  for (const p of sliceA) expect(presentPaths.has(p)).toBe(true);

  // End-to-end: the SUT's executed plan MATCHES the pure slice, and the modal's
  // claimed count EQUALS the set removed (no "claim N, delete M").
  const captured = await capturePlan(rows, rootPath, true);
  expect(captured.plan).toEqual(sliceA);
  expect(captured.prompted).toBe(sliceA.length > 0); // prompt iff descendants exist
  if (captured.prompted) {
    expect(captured.subItemCount).toBe(sliceA.length);
    expect(captured.selfCalls).toBe(1); // parent removed exactly once
  } else {
    expect(captured.selfCalls).toBe(1); // leaf: silent single deleteSelf
  }
  return sliceA;
};

beforeEach(() => {
  (deletePath as jest.Mock).mockReset();
});

// ===========================================================================
describe("nonDestructiveDelete planner — hostile shapes never throw (I1) & terminate (I5)", () => {
  // Each fixture pairs a hostile graph with the target(s) to plan against. The
  // harness proves the SYNC planning path never throws and re-planning
  // terminates (an infinite recursion would hang the runner, not pass).
  const cases: Array<{ name: string; rows: Record<string, any>[]; roots: string[] }> = [
    { name: "empty row set", rows: [], roots: ["A"] },
    {
      name: "self-referential parent (A -> A)",
      rows: [{ File: "A", parent: "[[A]]" }],
      roots: ["A"],
    },
    {
      name: "two-node cycle (A -> B -> A)",
      rows: [
        { File: "A", parent: "[[B]]" },
        { File: "B", parent: "[[A]]" },
      ],
      roots: ["A", "B"],
    },
    {
      name: "three-node cycle (A -> B -> C -> A)",
      rows: [
        { File: "A", parent: "[[B]]" },
        { File: "B", parent: "[[C]]" },
        { File: "C", parent: "[[A]]" },
      ],
      roots: ["A", "B", "C"],
    },
    {
      name: "cycle with an outside child hanging off it",
      rows: [
        { File: "A", parent: "[[B]]" },
        { File: "B", parent: "[[A]]" },
        { File: "X", parent: "[[A]]" },
      ],
      roots: ["A", "B", "X"],
    },
    {
      name: "dangling parent link (points outside the set)",
      rows: [
        { File: "A", parent: "[[Ghost]]" },
        { File: "B", parent: "[[A]]" },
      ],
      roots: ["A", "B", "Ghost"],
    },
    {
      name: "duplicate path (two rows named A)",
      rows: [
        { File: "A", parent: "" },
        { File: "C", parent: "[[A]]" },
        { File: "A", parent: "" },
      ],
      roots: ["A", "C"],
    },
    {
      name: "non-string / null parent values",
      rows: [
        { File: "A", parent: null },
        { File: "B", parent: 42 as any },
        { File: "C", parent: ["[[A]]"] as any },
        { File: "D", parent: { toString: () => "[[A]]" } as any },
        { File: "E", parent: undefined },
      ],
      roots: ["A", "B", "C", "D", "E"],
    },
    {
      name: "non-string path values",
      rows: [
        { File: 0 as any, parent: "" },
        { File: 1 as any, parent: "[[0]]" },
      ],
      roots: ["0", "1"],
    },
    {
      name: "empty and whitespace paths",
      rows: [
        { File: "", parent: "" },
        { File: "   ", parent: "" },
        { File: "A", parent: "" },
      ],
      roots: ["A", "", "   "],
    },
    {
      name: "multi-parent (first-resolving wins), one link a cycle",
      rows: [
        { File: "A", parent: "" },
        { File: "B", parent: "" },
        { File: "C", parent: "[[A]], [[B]]" },
        { File: "A2", parent: "[[C]], [[A]]" },
      ],
      roots: ["A", "B", "C", "A2"],
    },
  ];

  for (const { name, rows, roots } of cases) {
    it(`${name}: sync planning never throws and re-planning terminates`, () => {
      const nodes = treeOf(rows);
      for (const root of roots) {
        expect(() => {
          const a = subtreePathsFromTree(nodes, PATH_KEY, root);
          const b = subtreePathsFromTree(nodes, PATH_KEY, root);
          expect(b).toEqual(a); // (I4) idempotent, (I5) terminates
          expect(new Set(a).size).toBe(a.length); // (I3) no dup
          expect(a).not.toContain(root); // (I2) never the target
        }).not.toThrow();
      }
    });

    it(`${name}: the SUT wrapper never throws for any target`, () => {
      for (const root of roots) {
        expect(() =>
          requestRowDeleteWithSubItems({
            superstate: makeSuperstate([]),
            rootPath: root,
            subItemsDelete: { treeNodes: treeOf(rows), isPrimarySurface: true },
            deleteSelf: () => {},
            win: {} as Window,
          })
        ).not.toThrow();
      }
    });
  }

  it("a deep chain (1000 nodes) plans without stack overflow and stays finite", () => {
    // A0 -> A1 -> ... -> A999. Deleting A0 removes exactly its 999 descendants,
    // in order, once each — proving deep nesting neither throws nor drops a link.
    const rows: Record<string, any>[] = [{ File: "A0", parent: "" }];
    for (let i = 1; i < 1000; i++) {
      rows.push({ File: `A${i}`, parent: `[[A${i - 1}]]` });
    }
    const nodes = treeOf(rows);
    let plan: string[] = [];
    expect(() => {
      plan = subtreePathsFromTree(nodes, PATH_KEY, "A0");
    }).not.toThrow();
    expect(plan).toHaveLength(999);
    expect(plan[0]).toBe("A1");
    expect(plan[plan.length - 1]).toBe("A999");
    expect(new Set(plan).size).toBe(plan.length); // no dup across the whole chain
    expect(plan).toEqual(descendantsOracle(nodes, "A0")); // matches the oracle
  });
});

// ===========================================================================
describe("nonDestructiveDelete planner — no over-deletion / exactly-once / idempotence (I2/I3/I4)", () => {
  it("cycle partner is a rendered leaf: never destroys its ancestor or sibling", async () => {
    // A<->B cycle, X child of A. buildRowTree renders A@0 > B@1, X@1. Deleting B
    // (the non-root partner, a rendered leaf) must plan [] — NEVER walk back into
    // the loop and cascade-delete A (its rendered parent) or X (its sibling).
    const rows = [
      { File: "A", parent: "[[B]]" },
      { File: "B", parent: "[[A]]" },
      { File: "X", parent: "[[A]]" },
    ];
    const planA = await assertPlannerSafe(rows, "A");
    expect(planA).toEqual(["B", "X"]); // A owns the whole rendered subtree
    const planB = await assertPlannerSafe(rows, "B");
    expect(planB).toEqual([]); // partner owns nothing — the over-deletion fix
    const planX = await assertPlannerSafe(rows, "X");
    expect(planX).toEqual([]);
  });

  it("self-parent is a root leaf: cannot be its own descendant", async () => {
    const plan = await assertPlannerSafe([{ File: "A", parent: "[[A]]" }], "A");
    expect(plan).toEqual([]);
  });

  it("deleting one parent never pulls a SIBLING tree's rows", async () => {
    // P > {C1 > G, C2}  ||  Q > QC  (two independent trees).
    const rows = [
      { File: "P", parent: "" },
      { File: "C1", parent: "[[P]]" },
      { File: "G", parent: "[[C1]]" },
      { File: "C2", parent: "[[P]]" },
      { File: "Q", parent: "" },
      { File: "QC", parent: "[[Q]]" },
    ];
    const planP = await assertPlannerSafe(rows, "P");
    expect(planP).toEqual(["C1", "G", "C2"]);
    expect(planP).not.toContain("Q");
    expect(planP).not.toContain("QC");
    const planQ = await assertPlannerSafe(rows, "Q");
    expect(planQ).toEqual(["QC"]);
    for (const p of ["P", "C1", "G", "C2"]) expect(planQ).not.toContain(p);
    // A child whose parent is the target IS pulled; a child of a sibling is NOT.
    expect(await assertPlannerSafe(rows, "C1")).toEqual(["G"]);
  });

  it("duplicate path does not double-count or drop the descendant", async () => {
    // Two rows named A; buildRowTree emits A once, so the plan lists C exactly
    // once and never re-emits A.
    const rows = [
      { File: "A", parent: "" },
      { File: "C", parent: "[[A]]" },
      { File: "A", parent: "" },
    ];
    const plan = await assertPlannerSafe(rows, "A");
    expect(plan).toEqual(["C"]);
  });

  it("dangling parent link surfaces the orphan as a root, not a phantom descendant", async () => {
    const rows = [
      { File: "A", parent: "[[Ghost]]" }, // Ghost is not in the set
      { File: "B", parent: "[[A]]" },
    ];
    // Deleting the ghost target resolves nothing.
    expect(await assertPlannerSafe(rows, "Ghost")).toEqual([]);
    // A surfaced as a root still owns its real child B.
    expect(await assertPlannerSafe(rows, "A")).toEqual(["B"]);
  });

  it("multi-parent child attaches to the FIRST resolving parent only (no double home)", async () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "" },
      { File: "C", parent: "[[A]], [[B]]" }, // first resolver A wins
    ];
    expect(await assertPlannerSafe(rows, "A")).toEqual(["C"]);
    expect(await assertPlannerSafe(rows, "B")).toEqual([]); // B never claims C
  });

  it("empty row set: any target plans to an empty, non-throwing silent delete", async () => {
    const plan = await assertPlannerSafe([], "Anything");
    expect(plan).toEqual([]);
  });

  it("planning the same parent twice yields an equal plan (idempotence)", async () => {
    const rows = [
      { File: "P", parent: "" },
      { File: "C1", parent: "[[P]]" },
      { File: "G", parent: "[[C1]]" },
      { File: "C2", parent: "[[P]]" },
    ];
    const first = await capturePlan(rows, "P");
    const second = await capturePlan(rows, "P");
    expect(second.plan).toEqual(first.plan);
    expect(second.subItemCount).toBe(first.subItemCount);
    expect(first.plan).toEqual(["C1", "G", "C2"]);
  });
});

// ===========================================================================
describe("nonDestructiveDelete planner — surface authority holds under hostile shapes", () => {
  it("non-primary surface removes the SAME plan as primary but never file-deletes", async () => {
    // The plan (which paths) must be surface-independent; only the authority
    // (un-list vs file-delete) differs. A cycle fixture stresses the derivation.
    const rows = [
      { File: "A", parent: "[[B]]" },
      { File: "B", parent: "[[A]]" },
      { File: "X", parent: "[[A]]" },
    ];
    const primary = await capturePlan(rows, "A", true);
    const nonPrimary = await capturePlan(rows, "A", false);
    expect(nonPrimary.plan).toEqual(primary.plan);
    expect(primary.plan).toEqual(["B", "X"]);
    // On the non-primary surface, deletePath (the file-destroying sink) is NEVER
    // reached — descendants are un-listed via removeFromSurface only.
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("non-primary surface with removeFromSurface ABSENT never escalates to deletePath", async () => {
    // Missing un-lister must degrade to a no-op, never a higher-authority file
    // delete — even for a deep hostile chain.
    const rows = [
      { File: "P", parent: "" },
      { File: "C1", parent: "[[P]]" },
      { File: "G", parent: "[[C1]]" },
    ];
    const captures: ModalCapture[] = [];
    const deleteSelf = jest.fn(async () => {});
    requestRowDeleteWithSubItems({
      superstate: makeSuperstate(captures),
      rootPath: "P",
      subItemsDelete: {
        treeNodes: treeOf(rows),
        isPrimarySurface: false,
        // removeFromSurface intentionally ABSENT.
      },
      deleteSelf,
      win: {} as Window,
    });
    captures[0].element.props.deleteRecursive();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(deleteSelf).toHaveBeenCalledTimes(1); // parent still un-listed
    expect(deletePath).not.toHaveBeenCalled(); // NOT ONE descendant file-deleted
  });
});

// ===========================================================================
// Property fuzz: hundreds of randomly-generated HOSTILE graphs (roots, cycles,
// self-links, danglers, multi-parents, occasional duplicate paths). For every
// node in every graph, the SUT's slice must equal the independent oracle, carry
// no duplicate, exclude the target, and be stable across re-planning — and the
// end-to-end SUT plan (sampled) must match. A single divergence is a real
// over-deletion / orphan bug.
describe("nonDestructiveDelete planner — property fuzz over hostile graphs (I1–I5)", () => {
  // Deterministic PRNG (mulberry32) so a failure is reproducible from the seed.
  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const randomGraph = (rng: () => number): Record<string, any>[] => {
    const n = 2 + Math.floor(rng() * 9); // 2..10 nodes
    const rows: Record<string, any>[] = [];
    for (let i = 0; i < n; i++) {
      // ~12% duplicate a prior name to stress the emit-once / dedup path.
      const name =
        i > 0 && rng() < 0.12 ? `r${Math.floor(rng() * i)}` : `r${i}`;
      let parent: string;
      const roll = rng();
      if (roll < 0.25) {
        parent = ""; // genuine root
      } else if (roll < 0.4) {
        parent = "[[ghost]]"; // dangling / orphan
      } else {
        const j = Math.floor(rng() * n); // any node — incl. self, cycles, forward refs
        parent = `[[r${j}]]`;
        if (rng() < 0.25) {
          const k = Math.floor(rng() * n); // second link -> multi-parent
          parent = `[[r${k}]], ${parent}`;
        }
      }
      rows.push({ File: name, parent });
    }
    return rows;
  };

  it("400 hostile graphs: every node's plan equals the oracle, no dup, excludes target, idempotent", () => {
    const rng = mulberry32(0x9e3779b9);
    for (let iter = 0; iter < 400; iter++) {
      const rows = randomGraph(rng);
      const nodes = treeOf(rows);
      const present = new Set(nodes.map(pathOfNode));
      for (const path of present) {
        if (!path) continue; // empty path -> planner guards to []
        let slice: string[] = [];
        let sliceAgain: string[] = [];
        let oracle: string[] = [];
        expect(() => {
          slice = subtreePathsFromTree(nodes, PATH_KEY, path);
          sliceAgain = subtreePathsFromTree(nodes, PATH_KEY, path);
          oracle = descendantsOracle(nodes, path);
        }).not.toThrow(); // (I1) + (I5) terminates
        // (I2)/(I3): the two independent derivations agree exactly.
        expect(slice).toEqual(oracle);
        // (I4) idempotence.
        expect(sliceAgain).toEqual(slice);
        // (I3) exactly once.
        expect(new Set(slice).size).toBe(slice.length);
        // (I2) never the target, always a real node.
        expect(slice).not.toContain(path);
        for (const p of slice) expect(present.has(p)).toBe(true);
      }
    }
  });

  it("120 hostile graphs: the end-to-end SUT plan matches the pure slice for a sampled target", async () => {
    const rng = mulberry32(0x1234abcd);
    for (let iter = 0; iter < 120; iter++) {
      const rows = randomGraph(rng);
      const nodes = treeOf(rows);
      const paths = nodes.map(pathOfNode).filter((p) => p);
      if (paths.length === 0) continue;
      const target = paths[Math.floor(rng() * paths.length)];
      const slice = subtreePathsFromTree(nodes, PATH_KEY, target);
      const captured = await capturePlan(rows, target, true);
      // The executed plan is exactly the pure slice — no path outside it, none
      // dropped — and the claimed count matches the set removed.
      expect(captured.plan).toEqual(slice);
      expect(captured.prompted).toBe(slice.length > 0);
      if (captured.prompted) expect(captured.subItemCount).toBe(slice.length);
    }
  });
});
