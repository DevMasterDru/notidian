import { RollupPeriodConfig } from "core/utils/contexts/rollupPeriod";
import { SpaceProperty } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";

const NUMBER_FUNCTIONS = new Set([
  "count",
  "count_values",
  "sum",
  "avg",
  "min",
  "max",
  "percent",
  "percent_checked",
]);

export const comparisonTypeForComputedRelationColumn = (
  column: SpaceProperty
): "number" | "date" | "text" | null => {
  if (column?.type != "rollup" && column?.type != "backlink") return null;
  const fn = safelyParseJSON(column.value)?.fn ??
    (column.type == "backlink" ? "list" : "count");
  if (NUMBER_FUNCTIONS.has(fn)) return "number";
  if (fn == "earliest" || fn == "latest") return "date";
  return "text";
};

export const updateComputedRelationPeriod = <T extends Record<string, any>>(
  config: T,
  scope: RollupPeriodConfig["scope"] | "",
  field: string
): T & { period?: RollupPeriodConfig } => {
  const { period: _period, ...rest } = config ?? ({} as T);
  if (!scope) return rest as T;
  return {
    ...rest,
    period: { field: String(field ?? "").trim(), scope },
  } as T & { period: RollupPeriodConfig };
};
