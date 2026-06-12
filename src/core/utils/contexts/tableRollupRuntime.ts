import { resolvePath } from "core/superstate/utils/path";
import {
  computeFrontmatterRollup,
  parseRelationLinks,
  RollupConfig,
} from "core/utils/contexts/tableRollup";
import { Superstate } from "makemd-core";

// Runtime bridge for frontmatter-link rollups (Notidian-8pl): given a row's
// relation property value, resolve the linked paths and aggregate the target
// property from each linked note's own frontmatter (read from pathsIndex — the
// in-memory frontmatter cache). Read-only; never writes.
export const computeRowRollup = (
  superstate: Superstate,
  relationValue: unknown,
  config: RollupConfig,
  sourcePath: string
): string => {
  const linkPaths = parseRelationLinks(relationValue);
  const isSpace = (path: string) => superstate.spacesIndex.get(path) != null;
  const resolveFrontmatter = (target: string) => {
    const resolved = resolvePath(target, sourcePath, isSpace);
    return superstate.pathsIndex.get(resolved)?.metadata?.property ?? null;
  };
  return computeFrontmatterRollup({ linkPaths, config, resolveFrontmatter });
};
