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
};

export const buildRowTree = (params: {
  rows: Record<string, any>[];
  parentKey: string;
  pathKey: string;
}): RowTreeNode[] => {
  const { rows, parentKey, pathKey } = params;
  const pathOf = (row: Record<string, any>) => String(row[pathKey] ?? "");

  const byPath = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const path = pathOf(row);
    if (path && !byPath.has(path)) byPath.set(path, row);
  }

  const parentPathOf = (row: Record<string, any>): string | null => {
    const parent = parseRelationLinks(row[parentKey])[0];
    return parent && byPath.has(parent) && parent != pathOf(row) ? parent : null;
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
    result.push({ row, depth, hasChildren: children.length > 0 });
    for (const child of children) emit(child, depth + 1);
  };

  for (const root of roots) emit(root, 0);
  // Rows only reachable through a cycle (no real root) surface as roots.
  for (const row of rows) if (!visited.has(pathOf(row))) emit(row, 0);
  return result;
};
