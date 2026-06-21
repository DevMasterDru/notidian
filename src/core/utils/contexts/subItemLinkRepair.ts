import { makeRelationLinkResolver } from "core/utils/contexts/relationResolver";
import { parseRelationLinks } from "core/utils/contexts/tableRollup";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";

// Heal sub-item parent links written before the path-qualification fix
// (Notidian-4xza / kg81). A child created by the old "+ Add sub-item" carried a
// BARE basename link `[[Parent]]`, which Obsidian resolves to the FIRST same-named
// file ANYWHERE in the vault — so in a collision-prone vault it points at the
// wrong file and the child never nests. This re-qualifies such a link to the
// in-table parent it clearly meant: a child "needs repair" when its parent link
// does NOT resolve to any in-table row (orphaned) but its bare basename matches
// EXACTLY ONE in-table row. We never guess on an ambiguous basename, and never
// touch a link that already resolves in-table.

export type SubItemLinkRepair = {
  // The child row whose frontmatter parent link is rewritten.
  childPath: string;
  // The path-qualified target (parent path minus .md) the link is re-pointed at.
  newTarget: string;
  // The clean basename kept as the wikilink display alias.
  basename: string;
};

const basenameOf = (p: string): string =>
  p.replace(/\.md$/, "").split("/").pop() ?? p;

// PURE (resolver injected): decide which rows need re-qualifying.
export const planSubItemLinkRepairs = (params: {
  rows: Record<string, any>[];
  // The read key for the parent-link column (name+table).
  parentKey: string;
  pathKey: string;
  resolveLink: (link: string, sourcePath: string) => string;
}): SubItemLinkRepair[] => {
  const { rows, parentKey, pathKey, resolveLink } = params;
  const pathOf = (r: Record<string, any>) => String(r[pathKey] ?? "");

  const byPath = new Set<string>();
  const byBasename = new Map<string, string[]>();
  for (const r of rows) {
    const p = pathOf(r);
    if (!p) continue;
    byPath.add(p);
    const b = basenameOf(p).toLowerCase();
    const list = byBasename.get(b) ?? [];
    list.push(p);
    byBasename.set(b, list);
  }

  const repairs: SubItemLinkRepair[] = [];
  for (const r of rows) {
    const self = pathOf(r);
    const links = parseRelationLinks(r[parentKey]);
    if (links.length === 0) continue;
    // Already pointing at an in-table parent? Then it works — leave it alone.
    const resolvesInTable = links.some((l) => {
      const resolved = resolveLink(l, self);
      return resolved !== self && byPath.has(resolved);
    });
    if (resolvesInTable) continue;
    // Re-qualify the first link whose bare basename uniquely matches an in-table
    // row (excluding self). Ambiguous or unmatched links are left untouched.
    for (const l of links) {
      const matches = (byBasename.get(basenameOf(l).toLowerCase()) ?? []).filter(
        (p) => p !== self
      );
      if (matches.length === 1) {
        repairs.push({
          childPath: self,
          newTarget: matches[0].replace(/\.md$/, ""),
          basename: basenameOf(matches[0]),
        });
        break;
      }
    }
  }
  return repairs;
};

// LIVE executor: plan over the given materialized rows, then write each repair as
// a path-qualified link into the CHILD's frontmatter under the parent-link column
// name (subItemsField) — one-way (the parent's file is never touched), mirroring
// subItemCreate's write form. Returns how many links were repaired.
export const repairSubItemLinks = async (args: {
  superstate: Superstate;
  rows: Record<string, any>[];
  // The frontmatter WRITE key (column name).
  subItemsField: string;
  // The READ key (name+table); equals subItemsField for a primary-table column.
  parentKey: string;
}): Promise<{ repaired: number }> => {
  const { superstate, rows, subItemsField, parentKey } = args;
  const plan = planSubItemLinkRepairs({
    rows,
    parentKey,
    pathKey: PathPropertyName,
    resolveLink: makeRelationLinkResolver(superstate),
  });
  for (const repair of plan) {
    await saveFrontmatterProperties({
      superstate,
      path: repair.childPath,
      properties: {
        [subItemsField]: `[[${repair.newTarget}|${repair.basename}]]`,
      },
    });
  }
  return { repaired: plan.length };
};
