import { parseRelationLinks } from "core/utils/contexts/tableRollup";

// Back-relations / "linked from" (Notidian-ahk). The reverse side of a
// frontmatter-link relation: for a target row, which rows link TO it through a
// given relation property. The candidate set is the target's precomputed
// inlinks (Obsidian's reverse-link index — perf-bounded, no full-vault scan);
// this layer keeps only the candidates whose *designated relation property*
// actually resolves back to the target, so incidental body links don't count.
//
// Pure: the caller supplies each candidate's relation-property value + the link
// resolver (the same resolvePath the rollup/sub-items runtime uses). Aggregation
// reuses computeFrontmatterRollup over the resulting source set.

export const filterBackRelations = (params: {
  targetPath: string;
  candidates: { path: string; relationValue: unknown }[];
  resolveLink?: (link: string, sourcePath: string) => string;
}): string[] => {
  const { targetPath, candidates, resolveLink } = params;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.path || candidate.path === targetPath) continue; // ignore self
    if (seen.has(candidate.path)) continue; // dedupe repeated inlinks
    for (const link of parseRelationLinks(candidate.relationValue)) {
      const resolved = resolveLink ? resolveLink(link, candidate.path) : link;
      if (resolved === targetPath) {
        out.push(candidate.path);
        seen.add(candidate.path);
        break;
      }
    }
  }
  return out;
};
