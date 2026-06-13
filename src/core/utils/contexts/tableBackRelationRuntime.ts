import { resolvePath } from "core/superstate/utils/path";
import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
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
  const isSpace = (path: string) => superstate.spacesIndex.get(path) != null;

  const inlinks = superstate.pathsIndex.get(targetPath)?.inlinks ?? [];
  const candidates = inlinks.map((path) => ({
    path,
    relationValue:
      superstate.pathsIndex.get(path)?.metadata?.property?.[
        config.relationProperty
      ],
  }));

  const sources = filterBackRelations({
    targetPath,
    candidates,
    resolveLink: (link, sourcePath) => resolvePath(link, sourcePath, isSpace),
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
