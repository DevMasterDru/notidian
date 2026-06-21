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
  const pathOf = (row: Record<string, any>) => String(row[pathKey] ?? "");

  const byPath = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const path = pathOf(row);
    if (path && !byPath.has(path)) byPath.set(path, row);
  }

  const parentPathOf = (row: Record<string, any>): string | null => {
    const self = pathOf(row);
    // First link that resolves to another row in the set (so a stale/missing
    // first link does not orphan a row that also links a valid parent).
    for (const link of parseRelationLinks(row[parentKey])) {
      const parent = resolveLink ? resolveLink(link, self) : link;
      if (parent != self && byPath.has(parent)) return parent;
    }
    return null;
  };

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
