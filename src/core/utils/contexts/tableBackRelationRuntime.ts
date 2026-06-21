import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
import { makeRelationLinkResolver } from "core/utils/contexts/relationResolver";
import { filterBackRelations } from "core/utils/contexts/tableBackRelations";
import { computeFrontmatterRollup } from "core/utils/contexts/tableRollup";
import { Superstate } from "makemd-core";

// Runtime bridge for back-relations (Notidian-ahk). For a target row, find the
// rows that link to it through `relationProperty`, using the target's precomputed
// inlinks as the candidate set (perf-bounded — no full-vault scan). Default fn
// "list" shows the linking rows' titles (Notion's relation back-side); other fns
// reuse the forward rollup engine over the back-relation set. Read-only.

export type BackRelationConfig = {
  relationProperty: string; // the forward-relation property on the linking rows
  fn?: string; // list (default) | count | count_values | values | unique | sum | avg | min | max
  field?: string; // target property for value/numeric aggregates
};

export const computeRowBackRelation = (
  superstate: Superstate,
  targetPath: string,
  config: BackRelationConfig
): string => {
  if (!config?.relationProperty || !targetPath) return "";

  // The reverse-link index lives on the path's METADATA (path.metadata.inlinks),
  // computed by the markdown adapter; the top-level PathState.inlinks is not
  // populated, so reading it left every back-relation empty (Notidian-bk7e). Fall
  // back to the top-level field defensively.
  const pathState = superstate.pathsIndex.get(targetPath);
  const inlinks: string[] =
    pathState?.metadata?.inlinks ?? pathState?.inlinks ?? [];
  const candidates = inlinks.map((path: string) => ({
    path,
    relationValue:
      superstate.pathsIndex.get(path)?.metadata?.property?.[
        config.relationProperty
      ],
  }));

  const sources = filterBackRelations({
    targetPath,
    candidates,
    resolveLink: makeRelationLinkResolver(superstate),
  });

  const fn = config.fn ?? "list";
  if (fn == "list") {
    return sources.map((path) => pageTitleFromPath(path)).join(", ");
  }
  // Aggregate over the back-relation set via the forward rollup engine.
  return computeFrontmatterRollup({
    linkPaths: sources,
    config: {
      relationProperty: config.relationProperty,
      targetProperty: config.field ?? "",
      fn,
    },
    resolveFrontmatter: (path) =>
      superstate.pathsIndex.get(path)?.metadata?.property ?? null,
  });
};
