import {
  isKeyMatchConfig,
  KeyMatchRelationConfig,
  resolveKeyMatch,
} from "core/utils/contexts/keyMatchResolver";
import { makeRelationLinkResolver } from "core/utils/contexts/relationResolver";
import {
  computeFrontmatterRollup,
  computeFrontmatterRollupDetailed,
  parseRelationLinks,
  RollupConfig,
} from "core/utils/contexts/tableRollup";
import { Superstate } from "makemd-core";

// Resolve link paths: either via key-match (Notidian-mx0k.1) or via wikilink
// parsing (Notidian-8pl). Key-match uses a plain frontmatter value to look up
// rows in a target folder; wikilinks parse [[links]] from the relation property.
const resolveLinkPaths = (
  superstate: Superstate,
  relationValue: unknown,
  sourcePath: string,
  keyMatchConfig?: KeyMatchRelationConfig
): string[] => {
  if (keyMatchConfig) {
    return resolveKeyMatch(superstate, relationValue, keyMatchConfig);
  }
  return parseRelationLinks(relationValue);
};

// Runtime bridge for frontmatter-link rollups (Notidian-8pl): given a row's
// relation property value, resolve the linked paths and aggregate the target
// property from each linked note's own frontmatter (read from pathsIndex — the
// in-memory frontmatter cache). Read-only; never writes.
//
// When keyMatchConfig is provided (Notidian-mx0k.1), the relation value is
// resolved via key-match against a target folder instead of wikilink parsing.
export const computeRowRollup = (
  superstate: Superstate,
  relationValue: unknown,
  config: RollupConfig,
  sourcePath: string,
  keyMatchConfig?: KeyMatchRelationConfig,
  now?: Date
): string => {
  const linkPaths = resolveLinkPaths(
    superstate,
    relationValue,
    sourcePath,
    keyMatchConfig
  );
  const resolveLink = makeRelationLinkResolver(superstate);
  const resolveFrontmatter = (target: string) => {
    // For key-match, paths are already fully resolved (from contextsIndex).
    const resolved = keyMatchConfig ? target : resolveLink(target, sourcePath);
    return superstate.pathsIndex.get(resolved)?.metadata?.property ?? null;
  };
  return computeFrontmatterRollup({ linkPaths, config, resolveFrontmatter, now });
};

// Detailed variant (ADR 0029 D2): same resolution as computeRowRollup but also
// returns the relation/resolved counts so the rollup cell can show a passive
// partial-honesty marker. computeRowRollup is kept above (string, "never
// throws" contract) for the property tests and the back-relations caller.
export const computeRowRollupDetailed = (
  superstate: Superstate,
  relationValue: unknown,
  config: RollupConfig,
  sourcePath: string,
  keyMatchConfig?: KeyMatchRelationConfig,
  now?: Date
): { value: string; relationCount: number; resolvedCount: number } => {
  const linkPaths = resolveLinkPaths(
    superstate,
    relationValue,
    sourcePath,
    keyMatchConfig
  );
  const resolveLink = makeRelationLinkResolver(superstate);
  const resolveFrontmatter = (target: string) => {
    const resolved = keyMatchConfig ? target : resolveLink(target, sourcePath);
    return superstate.pathsIndex.get(resolved)?.metadata?.property ?? null;
  };
  return computeFrontmatterRollupDetailed({
    linkPaths,
    config,
    resolveFrontmatter,
    now,
  });
};

// Re-export types for callers that need them alongside the runtime functions.
export type { KeyMatchRelationConfig } from "core/utils/contexts/keyMatchResolver";
