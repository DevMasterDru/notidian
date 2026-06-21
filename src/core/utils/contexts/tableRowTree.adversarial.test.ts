import { parseRelationLinks } from "core/utils/contexts/tableRollup";
import {
  buildRowTree,
  collectSubtreePaths,
  flattenVisibleTree,
  nextCollapsedPaths,
  rootDescendantCounts,
  RowTreeNode,
  scopeRowsByFilter,
  subItemAddRowsAfter,
  subtreePathsFromTree,
} from "core/utils/contexts/tableRowTree";
import { SubItemsFilterScope } from "shared/types/predicate";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the SUB-ITEMS TREE engine (Notidian-ev6n).
// tableRowTree.ts (ADR 0024) is the largest/newest/most-complex pure context
// engine (8 exported fns) and the surface of the just-fixed crash regression
// (6ba6f3d / 5ond.5) — yet it was the ONLY engine in its family without a
// .property/.adversarial suite (tableRollup, tableRollupRuntime,
// tableBackRelationRuntime, tableRowOrder, tableAssembly all have one). Its
// example-based tableRowTree.test.ts does not randomize. This file HARDENS it.
//
// It property-tests, over randomized ADVERSARIAL trees (self-parents,
// multi-parent values, dangling/out-of-set parents, cycles of length 1..N,
// forests, duplicate paths, empty/missing pathKey, deep chains > depth 12),
// the LOAD-BEARING invariants of every exported pure fn:
//
//   (1) buildRowTree emits each DISTINCT in-set path EXACTLY ONCE and ALWAYS
//       TERMINATES — even on cycles, self-parents, and dense random graphs.
//   (2) every non-root node's parent appears EARLIER in DF order at depth
//       exactly one less.
//   (3) surfacedAsRoot is true IFF depth==0 AND the row has >=1 parseable
//       parent link.
//   (4) childCount / hasChildren == the actual in-set DIRECT-child count
//       (children whose resolved parent is this node).
//   (5) subtreePathsFromTree == a CONTIGUOUS deeper-than-root window that NEVER
//       includes the root, an ancestor, or a sibling (the 5ond.8 delete-safety
//       property: a delete set never contains a rendered ancestor).
//   (6) flattenVisibleTree NEVER hides a non-descendant of a collapsed node,
//       always hides every descendant of a collapsed node, and is a subset.
//   (7) scopeRowsByFilter is order-preserving, a SUBSET, == rows.filter(matches)
//       for "parentsAndSubItems", MONOTONIC (parents/subItems superset of the
//       match set), and TERMINATES on cycles.
//   (8) rootDescendantCounts sums to (#nodes - #roots), and each root's count
//       == that root's subtreePathsFromTree window length.
//   (9) subItemAddRowsAfter only keys on VISIBLE-node paths and only for
//       EXPANDED parents (hasChildren and not collapsed); keys never leak
//       outside the visible set.
//
// Pure / offline / deterministic-seeded — no render path, no flag.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency — matching tableRollup.property.test.ts /
// tableAssembly.adversarial.test.ts and the other property suites in this tree.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: () => number, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];

const PROPERTY_RUNS = 2000;

// --- canonical keys for the whole suite ------------------------------------
const PARENT = "parent";
const PATH = "File";
const pathOf = (row: Record<string, any>) => String(row[PATH] ?? "");
const nodePath = (n: RowTreeNode) => String(n.row[PATH] ?? "");

// Build a tree the way every live caller does: identity resolveLink (paths are
// already canonical) over the shared parentKey/pathKey.
const buildTree = (rows: Record<string, any>[]): RowTreeNode[] =>
  buildRowTree({ rows, parentKey: PARENT, pathKey: PATH });

// The EXACT parent resolution buildRowTree nests by, mirrored independently so
// the invariants are checked against a second implementation (not the same
// code under test). A row's parent is the FIRST parsed link that is in-set and
// not self; else null = root/orphan. (Identity resolveLink — matches buildTree.)
const expectedParentOf = (
  rows: Record<string, any>[],
  row: Record<string, any>
): string | null => {
  const inSet = new Set<string>();
  for (const r of rows) {
    const p = pathOf(r);
    if (p && !inSet.has(p)) inSet.add(p);
  }
  const self = pathOf(row);
  for (const link of parseRelationLinks(row[PARENT])) {
    if (link !== self && inSet.has(link)) return link;
  }
  return null;
};

// --- adversarial random-tree generator -------------------------------------
// Emits the WHOLE family the engine must survive: forests, deep chains
// (>depth 12), self-parents, multi-parent values (only the first in-set link
// wins), dangling/out-of-set parents, cycles of length 1..N, duplicate paths,
// and missing/empty pathKey rows.
const NODE_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const randomAdversarialRows = (rng: () => number): Record<string, any>[] => {
  const n = randInt(rng, 0, 14);
  // A pool of candidate paths, including a "" (empty pathKey) and an out-of-set
  // dangling target that no row owns.
  const labelPool = NODE_POOL.slice(0, randInt(rng, 1, NODE_POOL.length));
  const rows: Record<string, any>[] = [];
  const usedPaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const mode = randInt(rng, 0, 9);
    let path: string;
    if (mode === 0) path = ""; // missing/empty pathKey
    else if (mode === 1 && usedPaths.length > 0)
      path = pick(rng, usedPaths); // duplicate path (later dup ignored by byPath)
    else path = pick(rng, labelPool) + (rng() < 0.3 ? randInt(rng, 0, 4) : "");
    if (path) usedPaths.push(path);

    // Build a (possibly multi-) parent value adversarially.
    const parentMode = randInt(rng, 0, 12);
    let parent: any;
    switch (parentMode) {
      case 0:
        parent = ""; // genuine root
        break;
      case 1:
        parent = undefined; // missing parent key
        break;
      case 2:
        parent = `[[${path}]]`; // self-parent -> root
        break;
      case 3: {
        // single in-set-ish link to a (maybe) existing path
        const t = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        parent = `[[${t}]]`;
        break;
      }
      case 4:
        parent = "[[OUT_OF_SET_DANGLING]]"; // orphan
        break;
      case 5: {
        // multi-parent: a dangling first, a real second (first in-set wins)
        const t = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        parent = `[[Missing1]], [[${t}]]`;
        break;
      }
      case 6: {
        // multi-parent: two real links (FIRST in-set wins, dup collapses)
        const a = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        const b = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        parent = `[[${a}]], [[${b}]]`;
        break;
      }
      case 7:
        parent = "[[]]"; // empty wikilink -> no links
        break;
      case 8: {
        // YAML-array parent value
        const t = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        parent = [`[[${t}]]`];
        break;
      }
      case 9: {
        // alias + fragment link to a real path
        const t = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        parent = `[[${t}#Section|Alias]]`;
        break;
      }
      case 10:
        parent = "garbage no links here"; // bare non-link string => one plain seg
        break;
      case 11: {
        // bare plain path (no wikilink) to a real path
        const t = usedPaths.length ? pick(rng, usedPaths) : pick(rng, labelPool);
        parent = t;
        break;
      }
      default:
        parent = null;
        break;
    }
    const row: Record<string, any> = { [PATH]: path };
    // Sometimes omit the parent key entirely (missing key path).
    if (parentMode !== 1) row[PARENT] = parent;
    rows.push(row);
  }

  // Inject deliberate CYCLES of length 1..N and a DEEP chain (>12) with some
  // probability so those shapes are reliably exercised, not just stumbled into.
  if (rng() < 0.4 && rows.length >= 2) {
    const cycLen = randInt(rng, 2, Math.min(6, rows.length));
    const labels: string[] = [];
    for (let i = 0; i < cycLen; i++) labels.push(`CYC${i}`);
    const cycRows = labels.map((lab, i) => ({
      [PATH]: lab,
      // each points at the NEXT, last wraps to first => pure cycle, no root
      [PARENT]: `[[${labels[(i + 1) % cycLen]}]]`,
    }));
    rows.push(...cycRows);
  }
  if (rng() < 0.3) {
    const depth = randInt(rng, 13, 20); // > depth 12
    let prev: string | null = null;
    for (let i = 0; i < depth; i++) {
      const lab = `CHAIN${i}`;
      rows.push({ [PATH]: lab, [PARENT]: prev ? `[[${prev}]]` : "" });
      prev = lab;
    }
  }
  return rows;
};

// The DISTINCT in-set paths (non-empty, first-occurrence wins for dups) — the
// set buildRowTree is expected to emit, each exactly once.
const distinctInSetPaths = (rows: Record<string, any>[]): Set<string> => {
  const s = new Set<string>();
  for (const r of rows) {
    const p = pathOf(r);
    if (p) s.add(p);
  }
  return s;
};

// =========================================================================
// (1) buildRowTree: emit each distinct in-set path EXACTLY ONCE + TERMINATE.
// =========================================================================
describe("buildRowTree — total emission + cycle termination (property)", () => {
  it("emits every distinct in-set path exactly once and terminates on any input", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 2654435761);
      const rows = randomAdversarialRows(rng);
      // The mere fact this returns (no throw, no hang) proves termination.
      const tree = buildTree(rows);
      const emitted = tree.map(nodePath);
      const expected = distinctInSetPaths(rows);

      // CHARACTERIZATION of the empty/missing pathKey degenerate input: a row
      // with "" pathKey has NO identity. byPath never stores an empty key, and
      // the emit() visited-guard keys on pathOf(row) === "" — so ALL empty-path
      // rows collide in `visited` and at most ONE is emitted (the rest are
      // dedup'd by the same cycle/re-entry guard that breaks loops). This is the
      // safe, intended behaviour: an identity-less row can't participate in a
      // sub-items hierarchy. We pin it rather than "fix" it.
      const emptyCount = emitted.filter((p) => p === "").length;
      const emptyRows = rows.filter((r) => pathOf(r) === "").length;
      const expectedEmptyEmitted = Math.min(emptyRows, 1);
      expect(emptyCount).toBe(expectedEmptyEmitted);

      // Every distinct in-set (non-empty) path appears EXACTLY once.
      for (const p of expected) {
        expect(emitted.filter((e) => e === p).length).toBe(1);
      }
      // No path is emitted that wasn't an in-set row path.
      for (const e of emitted) {
        if (e !== "") expect(expected.has(e)).toBe(true);
      }
      // Total emitted == distinct-non-empty paths + at-most-one empty-path row.
      expect(tree.length).toBe(expected.size + expectedEmptyEmitted);
    }
  });
});

// =========================================================================
// (2) parent-appears-earlier-at-depth-1-less  +  (3) surfacedAsRoot  +
// (4) childCount/hasChildren correctness.
// =========================================================================
describe("buildRowTree — depth, ancestry, surfacedAsRoot, childCount (property)", () => {
  it("holds the depth/ancestry/surfaced/childCount invariants on any input", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 40503 + 7);
      const rows = randomAdversarialRows(rng);
      const tree = buildTree(rows);

      // first-occurrence index of each emitted path, for the ancestry check.
      const indexOfPath = new Map<string, number>();
      tree.forEach((n, i) => {
        const p = nodePath(n);
        if (!indexOfPath.has(p)) indexOfPath.set(p, i);
      });

      // Expected direct-child counts from the independent resolver: a child is a
      // row whose expected parent == this path. (Counts DISTINCT child rows; the
      // tree counts childrenOf entries which include every row that resolved to
      // the parent — including duplicate-path rows. To stay faithful we count
      // the same way the engine does: number of rows resolving to this parent.)
      const childCountByParent = new Map<string, number>();
      for (const r of rows) {
        const par = expectedParentOf(rows, r);
        if (par) childCountByParent.set(par, (childCountByParent.get(par) ?? 0) + 1);
      }

      for (let i = 0; i < tree.length; i++) {
        const node = tree[i];
        const p = nodePath(node);
        expect(node.depth).toBeGreaterThanOrEqual(0);

        // (3) surfacedAsRoot IFF depth==0 AND row has >=1 parseable parent link.
        const linkCount = parseRelationLinks(node.row[PARENT]).length;
        expect(node.surfacedAsRoot).toBe(node.depth === 0 && linkCount > 0);

        // (4) childCount == in-set direct-child count; hasChildren == childCount>0.
        // (only meaningful for an identifiable path; "" rows can't be a parent
        //  target since byPath never stores an empty key.)
        if (p !== "") {
          const expectedKids = childCountByParent.get(p) ?? 0;
          expect(node.childCount).toBe(expectedKids);
          expect(node.hasChildren).toBe(expectedKids > 0);
        }

        // (2) a NON-root node's parent appears EARLIER at depth exactly 1 less.
        if (node.depth > 0) {
          const par = expectedParentOf(rows, node.row);
          expect(par).not.toBeNull();
          const parIdx = indexOfPath.get(par!);
          expect(parIdx).toBeDefined();
          expect(parIdx!).toBeLessThan(i);
          expect(tree[parIdx!].depth).toBe(node.depth - 1);
        }
      }
    }
  });
});

// =========================================================================
// (5) subtreePathsFromTree / collectSubtreePaths: contiguous deeper window that
//     NEVER contains the root, an ancestor, or a sibling (5ond.8 delete-safety).
// =========================================================================
describe("subtreePathsFromTree — contiguous deeper window, never an ancestor (property)", () => {
  it("is the contiguous deeper run and never returns a rendered ancestor/sibling/self", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 22695477 + 1);
      const rows = randomAdversarialRows(rng);
      const tree = buildTree(rows);
      const paths = tree.map(nodePath);

      for (let r = 0; r < tree.length; r++) {
        const rootPath = paths[r];
        if (!rootPath) continue; // "" rootPath short-circuits to [] (pinned below)
        // findIndex picks the FIRST occurrence — the same node subtreePathsFromTree uses.
        const firstIdx = paths.indexOf(rootPath);
        const window = subtreePathsFromTree(tree, PATH, rootPath);

        // Independently compute the contiguous deeper run after firstIdx.
        const rootDepth = tree[firstIdx].depth;
        const expectedWindow: string[] = [];
        for (let i = firstIdx + 1; i < tree.length; i++) {
          if (tree[i].depth <= rootDepth) break;
          expectedWindow.push(paths[i]);
        }
        expect(window).toEqual(expectedWindow);

        // DELETE-SAFETY: the window never contains the root itself, nor any
        // node rendered AT OR ABOVE the root's depth before it (ancestors/
        // siblings). Each window entry is strictly deeper than the root.
        for (const w of window) {
          expect(w).not.toBe(rootPath);
        }
        // Every entry is a contiguous deeper node => its depth > rootDepth.
        for (let k = 0; k < window.length; k++) {
          const idx = firstIdx + 1 + k;
          expect(tree[idx].depth).toBeGreaterThan(rootDepth);
        }
        // collectSubtreePaths (the row-based shim) yields the SAME set.
        const viaRows = collectSubtreePaths(rows, PARENT, PATH, undefined, rootPath);
        expect(viaRows).toEqual(window);
      }

      // A rootPath not in the tree -> [].
      expect(subtreePathsFromTree(tree, PATH, "DEFINITELY_ABSENT_PATH_xyz")).toEqual([]);
      // Empty rootPath short-circuits to [] regardless of tree contents.
      expect(subtreePathsFromTree(tree, PATH, "")).toEqual([]);
    }
  });
});

// =========================================================================
// (6) flattenVisibleTree: subset, never hides a NON-descendant of a collapsed
//     node, always hides every descendant of a collapsed node.
// =========================================================================
describe("flattenVisibleTree — collapse hides descendants only (property)", () => {
  it("is an order-preserving subset that hides exactly the descendants of collapsed parents", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 19349663 + 3);
      const rows = randomAdversarialRows(rng);
      const tree = buildTree(rows);

      // Randomly collapse a subset of nodes that actually have children.
      const collapsible = tree
        .filter((n) => n.hasChildren)
        .map((n) => nodePath(n))
        .filter((p) => p !== "");
      const collapsed = new Set<string>();
      for (const p of collapsible) if (rng() < 0.5) collapsed.add(p);

      const visible = flattenVisibleTree(tree, collapsed, PATH);

      // SUBSET + order-preserving: visible is a subsequence of tree by index.
      let ti = 0;
      for (const v of visible) {
        while (ti < tree.length && tree[ti] !== v) ti++;
        expect(ti).toBeLessThan(tree.length);
        ti++;
      }

      // Compute the EXPECTED hidden set: for each collapsed node with children,
      // its contiguous deeper window (its descendants) is hidden. Union over all
      // collapsed nodes (nested collapses overlap harmlessly).
      const hiddenIdx = new Set<number>();
      for (let i = 0; i < tree.length; i++) {
        const p = nodePath(tree[i]);
        if (tree[i].hasChildren && collapsed.has(p)) {
          const d = tree[i].depth;
          for (let j = i + 1; j < tree.length; j++) {
            if (tree[j].depth <= d) break;
            hiddenIdx.add(j);
          }
        }
      }
      const expectedVisible = tree.filter((_, i) => !hiddenIdx.has(i));
      expect(visible).toEqual(expectedVisible);

      // EXPLICIT: no descendant of a collapsed node is visible, and no
      // non-descendant of any collapsed node is hidden.
      const visibleSet = new Set(visible);
      for (let i = 0; i < tree.length; i++) {
        if (hiddenIdx.has(i)) expect(visibleSet.has(tree[i])).toBe(false);
        else expect(visibleSet.has(tree[i])).toBe(true);
      }
    }
  });
});

// =========================================================================
// (7) scopeRowsByFilter: order-preserving subset; == rows.filter(matches) for
//     parentsAndSubItems; MONOTONIC (parents/subItems ⊇ match set); terminates.
// =========================================================================
const SCOPES: readonly SubItemsFilterScope[] = [
  "parents",
  "parentsAndSubItems",
  "subItems",
];

describe("scopeRowsByFilter — subset, monotonic, default==filter, cycle-safe (property)", () => {
  it("holds the scope invariants for every scope on any input", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 2246822519 + 5);
      const rows = randomAdversarialRows(rng);

      // A deterministic, side-effect-free predicate keyed off the path's char code.
      const threshold = randInt(rng, 0, 30);
      const matches = (row: Record<string, any>) => {
        const p = pathOf(row);
        let h = 0;
        for (let i = 0; i < p.length; i++) h = (h + p.charCodeAt(i)) % 31;
        return h <= threshold;
      };
      const matchRowSet = new Set(rows.filter(matches));

      for (const scope of SCOPES) {
        const out = scopeRowsByFilter({
          rows,
          matches,
          parentKey: PARENT,
          pathKey: PATH,
          scope,
        });

        // SUBSET + ORDER-PRESERVING (subsequence of rows by reference).
        let ri = 0;
        for (const o of out) {
          while (ri < rows.length && rows[ri] !== o) ri++;
          expect(ri).toBeLessThan(rows.length);
          ri++;
        }

        // Default scope == rows.filter(matches), byte-for-byte (same refs).
        if (scope === "parentsAndSubItems") {
          expect(out).toEqual(rows.filter(matches));
        }

        // MONOTONIC: parents/subItems keep AT LEAST every matching row (the
        // match set is a subset of the kept set). (Note: matched rows are kept
        // by reference; closure only ADDS ancestors/descendants.)
        if (scope === "parents" || scope === "subItems") {
          const outSet = new Set(out);
          for (const m of matchRowSet) expect(outSet.has(m)).toBe(true);
          // and the kept set is a superset of the default's kept set in size.
          expect(out.length).toBeGreaterThanOrEqual(matchRowSet.size);
        }

        // EMPTY filter (matches all) => everything visible for every scope.
        const all = scopeRowsByFilter({
          rows,
          matches: () => true,
          parentKey: PARENT,
          pathKey: PATH,
          scope,
        });
        expect(all).toEqual(rows);
      }
    }
  });

  it("'parents' result == match set ∪ ancestor spines; 'subItems' == match set ∪ descendant subtrees", () => {
    for (let seed = 1; seed <= 800; seed++) {
      const rng = makeRng(seed * 374761393 + 11);
      const rows = randomAdversarialRows(rng);
      const threshold = randInt(rng, 0, 30);
      const matches = (row: Record<string, any>) => {
        const p = pathOf(row);
        let h = 0;
        for (let i = 0; i < p.length; i++) h = (h + p.charCodeAt(i)) % 31;
        return h <= threshold;
      };

      // Independent ancestry maps (identity resolveLink).
      const parentOf = new Map<string, string | null>();
      const childrenOf = new Map<string, string[]>();
      for (const r of rows) {
        const p = pathOf(r);
        const par = expectedParentOf(rows, r);
        parentOf.set(p, par);
        if (par) {
          if (!childrenOf.has(par)) childrenOf.set(par, []);
          childrenOf.get(par)!.push(p);
        }
      }
      const matchPaths = new Set(rows.filter(matches).map(pathOf));

      // parents: walk UP, cycle-guarded.
      const keepParents = new Set(matchPaths);
      for (const start of matchPaths) {
        const walked = new Set<string>();
        let cur = parentOf.get(start) ?? null;
        while (cur && !walked.has(cur)) {
          walked.add(cur);
          keepParents.add(cur);
          cur = parentOf.get(cur) ?? null;
        }
      }
      const outParents = scopeRowsByFilter({
        rows, matches, parentKey: PARENT, pathKey: PATH, scope: "parents",
      });
      expect(outParents).toEqual(rows.filter((r) => keepParents.has(pathOf(r))));

      // subItems: walk DOWN, cycle-guarded.
      const keepSub = new Set(matchPaths);
      const stack = [...matchPaths];
      const seen = new Set(matchPaths);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const child of childrenOf.get(cur) ?? []) {
          if (!seen.has(child)) {
            seen.add(child);
            keepSub.add(child);
            stack.push(child);
          }
        }
      }
      const outSub = scopeRowsByFilter({
        rows, matches, parentKey: PARENT, pathKey: PATH, scope: "subItems",
      });
      expect(outSub).toEqual(rows.filter((r) => keepSub.has(pathOf(r))));
    }
  });
});

// =========================================================================
// (8) rootDescendantCounts: sums to (#nodes - #roots); each == that root's
//     subtreePathsFromTree window length.
// =========================================================================
describe("rootDescendantCounts — sums to non-roots, == per-root window (property)", () => {
  it("each root's count equals its subtree window and the total equals nodes-minus-roots", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 1597334677 + 13);
      const rows = randomAdversarialRows(rng);
      const tree = buildTree(rows);
      const counts = rootDescendantCounts(tree, PATH);

      const roots = tree.filter((n) => n.depth === 0);
      const nonRoots = tree.length - roots.length;

      // Sum of all counts == number of non-root nodes (every non-root belongs to
      // exactly one root's descendant window).
      let sum = 0;
      for (const v of counts.values()) sum += v;
      expect(sum).toBe(nonRoots);

      // Each root's count == the length of its contiguous deeper window.
      // (Duplicate-path roots collapse in the Map keyed by path; for those the
      //  Map holds the LAST root's window — assert per-root via window length on
      //  the FIRST emission, which is what rootDescendantCounts walks. To be
      //  faithful to the keyed-by-path Map semantics, we verify each emitted
      //  root path's window length matches the stored count for the LAST root
      //  with that path.)
      const lastWindowByPath = new Map<string, number>();
      for (let i = 0; i < tree.length; i++) {
        if (tree[i].depth !== 0) continue;
        const rp = nodePath(tree[i]);
        const d = tree[i].depth;
        let w = 0;
        for (let j = i + 1; j < tree.length; j++) {
          if (tree[j].depth <= d) break;
          w++;
        }
        lastWindowByPath.set(rp, w);
      }
      for (const [rp, w] of lastWindowByPath) {
        expect(counts.get(rp)).toBe(w);
      }
    }
  });
});

// =========================================================================
// (9) subItemAddRowsAfter: keys only on VISIBLE-node paths, only for EXPANDED
//     parents (hasChildren && not collapsed). Keys never leak outside visible.
// =========================================================================
describe("subItemAddRowsAfter — keys only on visible expanded-parent paths (property)", () => {
  it("every key is a visible-node path; every add-row maps to an expanded visible parent", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const rng = makeRng(seed * 3266489917 + 17);
      const rows = randomAdversarialRows(rng);
      const tree = buildTree(rows);

      const collapsible = tree
        .filter((n) => n.hasChildren)
        .map(nodePath)
        .filter((p) => p !== "");
      const collapsed = new Set<string>();
      for (const p of collapsible) if (rng() < 0.5) collapsed.add(p);

      const visible = flattenVisibleTree(tree, collapsed, PATH);
      const result = subItemAddRowsAfter(visible, collapsed, PATH);

      const visiblePaths = new Set(visible.map(nodePath));
      // Set of EXPANDED parent paths (hasChildren && not collapsed) among visible.
      const expandedVisibleParents = new Set(
        visible
          .filter((n) => n.hasChildren && !collapsed.has(nodePath(n)))
          .map(nodePath)
      );

      // (a) every KEY is the path of a visible node (the "after this row" anchor).
      for (const key of result.keys()) {
        expect(visiblePaths.has(key)).toBe(true);
      }

      // (b) every add-row's parentPath is an EXPANDED VISIBLE parent, and its
      //     depth is exactly that parent's depth + 1.
      const visibleDepthByPath = new Map<string, number>();
      for (const n of visible) {
        const p = nodePath(n);
        if (!visibleDepthByPath.has(p)) visibleDepthByPath.set(p, n.depth);
      }
      let totalAddRows = 0;
      for (const arr of result.values()) {
        for (const ar of arr) {
          totalAddRows++;
          expect(expandedVisibleParents.has(ar.parentPath)).toBe(true);
          expect(ar.depth).toBe((visibleDepthByPath.get(ar.parentPath) ?? -99) + 1);
        }
      }
      // (c) EXACTLY one add-row per expanded visible parent (each parent gets a
      //     single "+ New sub-item" affordance after its last visible descendant).
      expect(totalAddRows).toBe(expandedVisibleParents.size);
    }
  });
});

// =========================================================================
// nextCollapsedPaths: toggle is an involution-ish dedupe; drops empties.
// =========================================================================
describe("nextCollapsedPaths — clean toggle + dedupe (property)", () => {
  it("toggling a path twice restores the cleaned set; never stores empties/dupes", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const rng = makeRng(seed * 2090735021 + 19);
      // Random current list with empties + duplicates mixed in.
      const len = randInt(rng, 0, 8);
      const current: string[] = [];
      for (let i = 0; i < len; i++) {
        const r = rng();
        if (r < 0.2) current.push("");
        else current.push(pick(rng, ["A", "B", "C", "D"]) + (rng() < 0.4 ? "" : "x"));
      }
      const cleaned = [...new Set(current.filter((p) => p && p.length > 0))];

      const path = pick(rng, ["A", "B", "Ax", "Bx", "Z", ""]);
      const once = nextCollapsedPaths(current, path);

      // Output never contains empties or duplicates.
      expect(once.filter((p) => !p || p.length === 0)).toEqual([]);
      expect(once.length).toBe(new Set(once).size);

      if (path && path.length > 0) {
        if (cleaned.includes(path)) {
          // present -> removed
          expect(once).not.toContain(path);
          expect(new Set(once)).toEqual(new Set(cleaned.filter((p) => p !== path)));
        } else {
          // absent -> added
          expect(once).toContain(path);
          expect(new Set(once)).toEqual(new Set([...cleaned, path]));
        }
        // Toggling AGAIN restores the cleaned set (as a set).
        const twice = nextCollapsedPaths(once, path);
        expect(new Set(twice)).toEqual(new Set(cleaned));
      } else {
        // Empty path is a no-op on the cleaned set.
        expect(new Set(once)).toEqual(new Set(cleaned));
      }
    }
  });
});
