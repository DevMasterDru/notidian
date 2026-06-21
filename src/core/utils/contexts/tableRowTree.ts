import { parseRelationLinks } from "core/utils/contexts/tableRollup";

// Sub-items (Notidian-gg9): build a parent/child tree from a canonical
// frontmatter parent-link property. Pure — the caller supplies the rows and the
// property keys; rendering (indentation, expansion) is a separate layer.
//
// A row's parent is the first link in its parent property that resolves to
// another row in the set. Rows with no parent, an out-of-set parent, or a
// self-parent are roots. Cycles are broken (each row is emitted exactly once).

export type RowTreeNode = {
  row: Record<string, any>;
  depth: number;
  hasChildren: boolean;
  // Number of DIRECT children of this node within the view's row set
  // (Notidian-5ond.6) — view-scoped, for the count badge beside the chevron.
  childCount: number;
  // ADR 0024 C2 (passive cycle/orphan indicator): true when this node was
  // surfaced at the top level (depth 0) even though the user named a parent —
  // either the parent link points outside this view (orphan) or it was only
  // reachable through a cycle (leftover loop below). Genuine roots (no parent
  // value) and normal nested nodes are false. Render layers show a passive
  // marker; the engine never blocks or rewrites.
  surfacedAsRoot: boolean;
};

// Shared parent-relation resolution (Notidian-5ond.5): the EXACT byPath +
// parentPathOf logic buildRowTree nests by, factored out so scopeRowsByFilter
// reasons over the SAME ancestry / orphan / cycle resolution — the two can never
// diverge. A row's parent is the first parsed link that resolveLink-canonicalizes
// to an in-set, non-self path (else null = root/orphan).
const resolveParentMap = (
  rows: Record<string, any>[],
  parentKey: string,
  pathKey: string,
  resolveLink?: (link: string, sourcePath: string) => string
) => {
  const pathOf = (row: Record<string, any>) => String(row[pathKey] ?? "");
  const byPath = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const path = pathOf(row);
    if (path && !byPath.has(path)) byPath.set(path, row);
  }
  const parentPathOf = (row: Record<string, any>): string | null => {
    const self = pathOf(row);
    for (const link of parseRelationLinks(row[parentKey])) {
      const parent = resolveLink ? resolveLink(link, self) : link;
      if (parent != self && byPath.has(parent)) return parent;
    }
    return null;
  };
  return { pathOf, byPath, parentPathOf };
};

export const buildRowTree = (params: {
  rows: Record<string, any>[];
  parentKey: string;
  pathKey: string;
  // Optional: map a parsed parent link to a canonical path so it can match the
  // children's pathKey values. Live callers pass the same resolver the rollup
  // runtime uses (resolvePath against the row's own path); defaults to identity
  // so pure tests can supply pre-resolved paths. Receives the row's own path as
  // the source so relative links resolve correctly.
  resolveLink?: (link: string, sourcePath: string) => string;
}): RowTreeNode[] => {
  const { rows, parentKey, pathKey, resolveLink } = params;
  // Shared resolution so the tree and scopeRowsByFilter never diverge.
  const { pathOf, parentPathOf } = resolveParentMap(
    rows,
    parentKey,
    pathKey,
    resolveLink
  );

  const childrenOf = new Map<string, Record<string, any>[]>();
  const roots: Record<string, any>[] = [];
  for (const row of rows) {
    const parent = parentPathOf(row);
    if (parent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(row);
    } else {
      roots.push(row);
    }
  }

  const result: RowTreeNode[] = [];
  const visited = new Set<string>();
  const emit = (row: Record<string, any>, depth: number) => {
    const path = pathOf(row);
    if (visited.has(path)) return; // cycle / re-entry guard
    visited.add(path);
    const children = childrenOf.get(path) ?? [];
    // ADR 0024 C2: a depth-0 node that still carries a parent value reached the
    // top level only because its parent is out of view (orphan) or unreachable
    // through a cycle (the leftover loop below) — surface it honestly. Genuine
    // roots have no parent value, so length 0 => false; nested nodes are depth>0.
    const surfacedAsRoot =
      depth === 0 && parseRelationLinks(row[parentKey]).length > 0;
    result.push({
      row,
      depth,
      hasChildren: children.length > 0,
      childCount: children.length,
      surfacedAsRoot,
    });
    for (const child of children) emit(child, depth + 1);
  };

  for (const root of roots) emit(root, 0);
  // Rows only reachable through a cycle (no real root) surface as roots.
  for (const row of rows) if (!visited.has(pathOf(row))) emit(row, 0);
  return result;
};

// Non-destructive parent-delete (Notidian-5ond.8, hardened in 5ond.8 review). Given
// the EXACT depth-first node list buildRowTree produced (the FULL, collapse- and
// limit-independent tree — see subtreePathsFromTree's callers) and a parent row's
// path, return EVERY descendant path beneath it (children, grandchildren, …) — NOT
// including the parent itself — in depth-first order.
//
// Why derive from the tree's OWN output rather than re-walking the parent map:
// buildRowTree resolves cycles and multi-parent links by emitting each row exactly
// once and picking, for an in-set parent cycle, whichever member it reaches first as
// the visual root (its partner then renders as a nested leaf with nothing beneath
// it). A second, independent childrenOf walk (the previous collectSubtreePaths) had
// NO notion of that choice, so for the non-root cycle member it walked back into the
// loop and reported the row's RENDERED ANCESTOR / SIBLING as "descendants" — the
// recursive delete could then destroy a row's visible parent (5ond.8 review). By
// slicing the descendant window straight out of buildRowTree's depth-first order
// (every following node deeper than the root's depth, until depth returns to <= it),
// the count, the rendered nesting, and the deletion set are PROVABLY the same object.
//
// Used to decide whether a delete needs the 3-way prompt (a row with descendants)
// and, for the recursive branch, exactly which paths to remove. A leaf (or a path
// not in the tree) returns [] (silent delete stays a no-prompt path — never a
// regression for childless rows). A cycle's non-root member is rendered as a leaf,
// so it too returns [] — it can no longer escalate into its partner's subtree.
export const subtreePathsFromTree = (
  treeNodes: RowTreeNode[],
  pathKey: string,
  rootPath: string
): string[] => {
  if (!rootPath) return [];
  const pathOf = (node: RowTreeNode) => String(node.row[pathKey] ?? "");
  // buildRowTree emits each path at most once, so the first match is THE node.
  const startIndex = treeNodes.findIndex((n) => pathOf(n) === rootPath);
  if (startIndex === -1) return [];
  const rootDepth = treeNodes[startIndex].depth;
  const result: string[] = [];
  for (let i = startIndex + 1; i < treeNodes.length; i++) {
    const node = treeNodes[i];
    // Descendants are the contiguous run of deeper nodes; the first node back at
    // (or above) the root's depth ends the subtree window.
    if (node.depth <= rootDepth) break;
    result.push(pathOf(node));
  }
  return result;
};

// Back-compat shim (Notidian-5ond.8). The original signature took the raw VISIBLE
// row set and re-resolved ancestry. It is retained ONLY for the pure unit suite's
// row-based fixtures; the live delete path uses subtreePathsFromTree over the full
// buildRowTree output (see the comment above for why). This wrapper builds the tree
// from the given rows first, so it now inherits the same tree-derived,
// cycle-correct semantics — but callers that already hold the full tree MUST pass it
// to subtreePathsFromTree directly (do not re-derive from a collapsed/limited set).
export const collectSubtreePaths = (
  rows: Record<string, any>[],
  parentKey: string,
  pathKey: string,
  resolveLink: ((link: string, sourcePath: string) => string) | undefined,
  rootPath: string
): string[] => {
  const tree = buildRowTree({ rows, parentKey, pathKey, resolveLink });
  return subtreePathsFromTree(tree, pathKey, rootPath);
};

// Filter a depth-first tree (from buildRowTree) down to the rows that are
// visible given a set of collapsed parent paths: a collapsed node keeps its own
// row but hides every descendant beneath it. Pure — the collapse state and the
// render live in the caller. Relies on buildRowTree's depth-first order: once a
// node at depth d is collapsed, every following node deeper than d is its
// descendant until depth returns to <= d.
export const flattenVisibleTree = (
  nodes: RowTreeNode[],
  collapsedPaths: Set<string>,
  pathKey: string
): RowTreeNode[] => {
  const visible: RowTreeNode[] = [];
  let hideBelowDepth: number | null = null;
  for (const node of nodes) {
    if (hideBelowDepth !== null) {
      if (node.depth > hideBelowDepth) continue; // descendant of a collapsed node
      hideBelowDepth = null; // returned to/above the collapsed level
    }
    visible.push(node);
    if (node.hasChildren && collapsedPaths.has(String(node.row[pathKey] ?? ""))) {
      hideBelowDepth = node.depth;
    }
  }
  return visible;
};

// Sub-item filter-visibility scope (Notidian-5ond.5): given the per-row filter
// `matches` predicate + the hierarchy, return the SUBSET of `rows` (input order
// preserved) that survives into buildRowTree, per the scope:
//   - "parentsAndSubItems" (default == today): keep rows that match — each judged
//     on its own (no hierarchy awareness).
//   - "parents": keep matches PLUS their ANCESTORS (a matching row keeps its
//     parent chain visible — e.g. filter status=done on sub-tasks, still see the
//     parent task). Grows UPWARD from the match set.
//   - "subItems": keep matches PLUS their DESCENDANTS (a matching parent reveals
//     its whole subtree — e.g. filter project=Atlas on parents, see all sub-items).
//     Grows DOWNWARD. The mirror of "parents".
// Default == parents ∩ subItems. Empty filter (matches all) => everything visible
// for every scope. Uses the SAME parent resolution as buildRowTree (shared map),
// with visited guards so cycles terminate.
export const scopeRowsByFilter = (params: {
  rows: Record<string, any>[];
  matches: (row: Record<string, any>) => boolean;
  parentKey: string;
  pathKey: string;
  resolveLink?: (link: string, sourcePath: string) => string;
  scope: import("shared/types/predicate").SubItemsFilterScope;
}): Record<string, any>[] => {
  const { rows, matches, parentKey, pathKey, resolveLink, scope } = params;
  // Fast path: default is today's per-row filter (NOT unfiltered).
  if (scope === "parentsAndSubItems") return rows.filter(matches);

  const { pathOf, parentPathOf } = resolveParentMap(
    rows,
    parentKey,
    pathKey,
    resolveLink
  );
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    const p = pathOf(row);
    const par = parentPathOf(row);
    parentOf.set(p, par);
    if (par) {
      if (!childrenOf.has(par)) childrenOf.set(par, []);
      childrenOf.get(par).push(p);
    }
  }
  const matchSet = new Set<string>();
  for (const row of rows) if (matches(row)) matchSet.add(pathOf(row));

  const keep = new Set<string>(matchSet);
  if (scope === "parents") {
    // Each match pulls in its ancestor spine (walk UP, cycle-guarded).
    for (const start of matchSet) {
      const walked = new Set<string>();
      let cur = parentOf.get(start) ?? null;
      while (cur && !walked.has(cur)) {
        walked.add(cur);
        keep.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
  } else {
    // "subItems": each match pulls in its whole descendant subtree (walk DOWN).
    const stack = [...matchSet];
    const seen = new Set<string>(matchSet);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of childrenOf.get(cur) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          keep.add(child);
          stack.push(child);
        }
      }
    }
  }
  return rows.filter((r) => keep.has(pathOf(r)));
};

// Total descendant count per root, for the "parents-only" display mode
// (Notidian-5ond.4). Given the full depth-first tree, each depth-0 node (root)
// maps to the number of nodes beneath it (every following node at depth > 0 until
// depth returns to 0). Pure.
export const rootDescendantCounts = (
  nodes: RowTreeNode[],
  pathKey: string
): Map<string, number> => {
  const counts = new Map<string, number>();
  let currentRoot: string | null = null;
  let count = 0;
  for (const node of nodes) {
    if (node.depth === 0) {
      if (currentRoot !== null) counts.set(currentRoot, count);
      currentRoot = String(node.row[pathKey] ?? "");
      count = 0;
    } else {
      count++;
    }
  }
  if (currentRoot !== null) counts.set(currentRoot, count);
  return counts;
};

// Notion-style "+ New sub-item" rows (Notidian-gr8t). Given the ALREADY-collapsed
// visible tree (flattenVisibleTree output), return where each "+ New sub-item"
// affordance is drawn: keyed by the path of the row AFTER which it appears (an
// expanded parent's LAST visible descendant), valued by the ordered add-rows to
// render there. An expanded parent = a node with hasChildren that is NOT in
// collapsedPaths (so its children are visible). The add-row indents to the
// child depth (parent.depth + 1). Pure — rendering lives in the caller.
//
// Nested expanded parents whose subtrees end at the SAME last descendant (A>B>C,
// all expanded, C the deepest leaf) each get their own add-row after C, ordered
// DEEPEST-FIRST (child of C-parent, then of B-parent, then of A-parent) — the
// descending staircase Notion shows.
// Per-view collapse persistence (Notidian-5ond.3): toggle one parent path in the
// persisted collapsed list (predicate.subItems.collapsed). Pure — add when absent,
// remove when present; dedupes and drops empties so the stored list stays clean.
export const nextCollapsedPaths = (
  current: string[] | undefined,
  path: string
): string[] => {
  const set = new Set((current ?? []).filter((p) => p && p.length > 0));
  if (set.has(path)) set.delete(path);
  else if (path && path.length > 0) set.add(path);
  return [...set];
};

export type SubItemAddRow = { parentPath: string; depth: number };

export const subItemAddRowsAfter = (
  visibleNodes: RowTreeNode[],
  collapsedPaths: Set<string>,
  pathKey: string
): Map<string, SubItemAddRow[]> => {
  const result = new Map<string, SubItemAddRow[]>();
  // Open expanded parents, innermost on top.
  const stack: { parentPath: string; parentDepth: number }[] = [];
  // The previous visible node's path. When a parent is popped (its subtree just
  // ended), this is its last visible descendant — the row to draw the add-row
  // after. (Tracking it globally, not per-frame, correctly handles ancestors
  // whose last descendant is deeper than their direct child.)
  let prevPath: string | null = null;
  const recordAt = (key: string, parentPath: string, depth: number) => {
    const arr = result.get(key) ?? [];
    arr.push({ parentPath, depth });
    result.set(key, arr);
  };
  for (const node of visibleNodes) {
    const p = String(node.row[pathKey] ?? "");
    // Pop every open parent whose subtree ended before this node (depth returned
    // to/above the parent). Each ended at prevPath.
    while (
      stack.length > 0 &&
      stack[stack.length - 1].parentDepth >= node.depth &&
      prevPath != null
    ) {
      const frame = stack.pop();
      recordAt(prevPath, frame.parentPath, frame.parentDepth + 1);
    }
    if (node.hasChildren && !collapsedPaths.has(p)) {
      stack.push({ parentPath: p, parentDepth: node.depth });
    }
    prevPath = p;
  }
  // Drain: remaining open parents end at the final visible node.
  while (stack.length > 0 && prevPath != null) {
    const frame = stack.pop();
    recordAt(prevPath, frame.parentPath, frame.parentDepth + 1);
  }
  return result;
};
