import { isKeyMatchConfig } from "core/utils/contexts/keyMatchResolver";
import { computeRowBackRelation } from "core/utils/contexts/tableBackRelationRuntime";
import { computeRowRollup } from "core/utils/contexts/tableRollupRuntime";
import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { DBRows, SpaceProperty } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";

export const materializeComputedRelationColumns = (args: {
  rows: DBRows;
  columns: SpaceProperty[];
  superstate: Superstate;
  contextPath: string;
  now?: Date;
}): DBRows => {
  const computedColumns = (args.columns ?? []).filter(
    (column) => column?.type == "rollup" || column?.type == "backlink"
  );
  if (computedColumns.length == 0) return args.rows;

  return (args.rows ?? []).map((row) => {
    const computed = computedColumns.reduce<Record<string, string>>(
      (result, column) => {
        try {
          const config = safelyParseJSON(column.value) ?? {};
          const fn = typeof config.fn == "string" && config.fn ? config.fn : "count";
          const needsField = fn != "count" && fn != "list";
          if (needsField && !config.field) return { ...result, [column.name]: "" };
          const sourcePath = row?.[PathPropertyName] ?? args.contextPath;

          if (column.type == "backlink") {
            if (!config.ref || !sourcePath)
              return { ...result, [column.name]: "" };
            return {
              ...result,
              [column.name]: computeRowBackRelation(
                args.superstate,
                sourcePath,
                {
                  relationProperty: config.ref,
                  fn,
                  field: config.field,
                  period: config.period,
                },
                args.now
              ),
            };
          }

          const useKeyMatch = isKeyMatchConfig(config);
          if (!useKeyMatch && !config.ref)
            return { ...result, [column.name]: "" };
          const relationValue = useKeyMatch
            ? row?.[config.keyMatch.sourceField]
            : row?.[config.ref];
          return {
            ...result,
            [column.name]: computeRowRollup(
              args.superstate,
              relationValue,
              {
                relationProperty: useKeyMatch
                  ? config.keyMatch.sourceField
                  : config.ref,
                targetProperty: config.field ?? "",
                fn,
                period: config.period,
              },
              sourcePath,
              useKeyMatch ? config.keyMatch : undefined,
              args.now
            ),
          };
        } catch {
          return { ...result, [column.name]: "" };
        }
      },
      {}
    );
    return { ...row, ...computed };
  });
};
