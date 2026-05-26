import { propertyAuthorityForColumn } from "core/utils/properties/propertyAuthority";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { Filter, Predicate, Sort } from "shared/types/predicate";
import { safelyParseJSON } from "shared/utils/json";

export type BaseFilter =
  | string
  | {
      and?: BaseFilter[];
      or?: BaseFilter[];
      not?: BaseFilter[];
    };

export type BasePropertyConfig = {
  displayName?: string;
};

export type BaseTableView = {
  type: "table";
  name: string;
  limit?: number;
  groupBy?: {
    property: string;
    direction: "ASC" | "DESC";
  };
  filters?: BaseFilter;
  order: string[];
  summaries?: Record<string, string>;
};

export type BaseDocument = {
  filters?: BaseFilter;
  formulas?: Record<string, string>;
  properties?: Record<string, BasePropertyConfig>;
  summaries?: Record<string, string>;
  views: BaseTableView[];
};

export type BaseUnsupportedFeature = {
  column?: string;
  reason: string;
};

export type NotidianTableToBaseOptions = {
  folder?: string;
  predicate?: Predicate;
  viewName?: string;
};

export type NotidianTableToBaseResult = {
  document: BaseDocument;
  unsupported: BaseUnsupportedFeature[];
};

type ColumnMapping = {
  column: SpaceProperty;
  baseProperty: string;
  displayName?: string;
};

const unsupportedColumnReason =
  "Notidian-owned column has no Bases representation unless it is migrated to frontmatter or kept as explicit Notidian state.";

const computedColumnReason =
  "Computed column has no durable Bases property mapping in this adapter.";

const parsePredicate = (table: SpaceTable): Predicate | undefined => {
  if (!table?.schema?.predicate) return undefined;
  const parsed = safelyParseJSON(table.schema.predicate);
  return parsed && typeof parsed === "object" ? (parsed as Predicate) : undefined;
};

const columnKey = (column: SpaceProperty): string => column.name;

const isHiddenColumn = (
  column: SpaceProperty,
  predicate?: Predicate
): boolean =>
  column.hidden === "true" ||
  (predicate?.colsHidden ?? []).includes(columnKey(column));

const orderedColumns = (
  columns: SpaceProperty[],
  predicate?: Predicate
): SpaceProperty[] => {
  const order = predicate?.colsOrder ?? [];
  if (order.length === 0) return columns;

  const orderIndex = new Map(order.map((key, index) => [key, index]));
  return [...columns].sort((a, b) => {
    const aIndex = orderIndex.get(columnKey(a));
    const bIndex = orderIndex.get(columnKey(b));
    if (aIndex == null && bIndex == null) return 0;
    if (aIndex == null) return 1;
    if (bIndex == null) return -1;
    return aIndex - bIndex;
  });
};

const aliasForColumn = (column: SpaceProperty): string | undefined => {
  const attrsAlias = safelyParseJSON(column.attrs ?? "")?.alias;
  if (typeof attrsAlias === "string" && attrsAlias.length > 0) return attrsAlias;

  const valueAlias = safelyParseJSON(column.value ?? "")?.alias;
  if (typeof valueAlias === "string" && valueAlias.length > 0) return valueAlias;

  return undefined;
};

const mapFileProperty = (column: SpaceProperty): string | undefined => {
  const value = column.value ?? "";
  if (value.startsWith(`${PathPropertyName}.`)) {
    return `file.${value.slice(PathPropertyName.length + 1)}`;
  }
  if (value.startsWith("file.")) return value;

  const parsed = safelyParseJSON(value);
  if (parsed?.field === PathPropertyName && typeof parsed.value === "string") {
    return `file.${parsed.value}`;
  }
  if (parsed?.field === "file" && typeof parsed.value === "string") {
    return `file.${parsed.value}`;
  }

  return undefined;
};

export const basePropertyForNotidianColumn = (
  column: SpaceProperty
): ColumnMapping | BaseUnsupportedFeature => {
  if (column.name === PathPropertyName) {
    return {
      column,
      baseProperty: "file.name",
      displayName: aliasForColumn(column) ?? "File",
    };
  }

  if (column.type === "fileprop") {
    const baseProperty = mapFileProperty(column);
    if (!baseProperty) {
      return {
        column: column.name,
        reason: computedColumnReason,
      };
    }
    return {
      column,
      baseProperty,
      displayName: aliasForColumn(column),
    };
  }

  const authority = propertyAuthorityForColumn(column);
  if (authority === "frontmatter") {
    return {
      column,
      baseProperty: column.name,
      displayName: aliasForColumn(column),
    };
  }
  if (authority === "computed") {
    return {
      column: column.name,
      reason: computedColumnReason,
    };
  }

  return {
    column: column.name,
    reason: unsupportedColumnReason,
  };
};

const mappedColumnsForTable = (
  table: SpaceTable,
  predicate?: Predicate
): { mappings: ColumnMapping[]; unsupported: BaseUnsupportedFeature[] } => {
  const mappings: ColumnMapping[] = [];
  const unsupported: BaseUnsupportedFeature[] = [];

  for (const column of orderedColumns(table.cols ?? [], predicate)) {
    if (isHiddenColumn(column, predicate)) continue;

    const mapping = basePropertyForNotidianColumn(column);
    if ("baseProperty" in mapping) {
      mappings.push(mapping);
    } else {
      unsupported.push(mapping);
    }
  }

  return { mappings, unsupported };
};

const literalForFilterValue = (column: SpaceProperty, value: string): string => {
  if (column.type === "number" && Number.isFinite(Number(value))) {
    return String(Number(value));
  }
  if (column.type === "boolean") {
    return value === "true" ? "true" : "false";
  }
  return JSON.stringify(value);
};

const mapFilter = (
  filter: Filter,
  mappingsByColumn: Map<string, ColumnMapping>
): { filter?: string; unsupported?: BaseUnsupportedFeature } => {
  const mapping = mappingsByColumn.get(filter.field);
  if (!mapping) {
    return {
      unsupported: {
        column: filter.field,
        reason: "Filter target has no Bases property mapping in this adapter.",
      },
    };
  }
  if (filter.fType === "property") {
    return {
      unsupported: {
        column: filter.field,
        reason:
          "Property-to-property filters have no stable Bases syntax mapping in this adapter.",
      },
    };
  }

  const property = mapping.baseProperty;
  const value = literalForFilterValue(mapping.column, filter.value);
  const expressionByFunction: Record<string, string> = {
    is: `${property} == ${value}`,
    isNot: `${property} != ${value}`,
    equal: `${property} == ${value}`,
    isLink: `${property} == ${value}`,
    isNotLink: `${property} != ${value}`,
    isGreatThan: `${property} > ${value}`,
    isLessThan: `${property} < ${value}`,
    isLessThanOrEqual: `${property} <= ${value}`,
    isGreatThanOrEqual: `${property} >= ${value}`,
    isTrue: `${property} == true`,
    isFalse: `${property} == false`,
  };

  const expression = expressionByFunction[filter.fn];
  if (!expression) {
    return {
      unsupported: {
        column: filter.field,
        reason: `Filter function ${filter.fn} has no stable Bases syntax mapping in this adapter.`,
      },
    };
  }

  return { filter: expression };
};

const mapFilters = (
  predicate: Predicate | undefined,
  mappingsByColumn: Map<string, ColumnMapping>
): { filters?: BaseFilter; unsupported: BaseUnsupportedFeature[] } => {
  const unsupported: BaseUnsupportedFeature[] = [];
  const filters: string[] = [];

  for (const filter of predicate?.filters ?? []) {
    const mapped = mapFilter(filter, mappingsByColumn);
    if (mapped.filter) filters.push(mapped.filter);
    if (mapped.unsupported) unsupported.push(mapped.unsupported);
  }

  return {
    filters: filters.length > 0 ? { and: filters } : undefined,
    unsupported,
  };
};

const mapGroupBy = (
  predicate: Predicate | undefined,
  mappingsByColumn: Map<string, ColumnMapping>
): { groupBy?: BaseTableView["groupBy"]; unsupported?: BaseUnsupportedFeature } => {
  const groupField = predicate?.groupBy?.[0];
  if (!groupField) return {};

  const mapping = mappingsByColumn.get(groupField);
  if (!mapping) {
    return {
      unsupported: {
        column: groupField,
        reason: "Group target has no Bases property mapping in this adapter.",
      },
    };
  }

  return {
    groupBy: {
      property: mapping.baseProperty,
      direction: "ASC",
    },
  };
};

const mapSorts = (sorts: Sort[] = []): BaseUnsupportedFeature[] =>
  sorts.map((sort) => ({
    column: sort.field,
    reason: `Sort function ${sort.fn} has no stable Bases syntax mapping in this adapter.`,
  }));

const propertiesForMappings = (
  mappings: ColumnMapping[]
): Record<string, BasePropertyConfig> | undefined => {
  const properties: Record<string, BasePropertyConfig> = {};

  for (const mapping of mappings) {
    if (!mapping.displayName || mapping.displayName === mapping.baseProperty) {
      continue;
    }
    properties[mapping.baseProperty] = {
      displayName: mapping.displayName,
    };
  }

  return Object.keys(properties).length > 0 ? properties : undefined;
};

const summariesForPredicate = (
  predicate: Predicate | undefined,
  mappingsByColumn: Map<string, ColumnMapping>
): Record<string, string> | undefined => {
  const summaries: Record<string, string> = {};

  for (const [column, summary] of Object.entries(predicate?.colsCalc ?? {})) {
    const mapping = mappingsByColumn.get(column);
    if (mapping && summary) summaries[mapping.baseProperty] = summary;
  }

  return Object.keys(summaries).length > 0 ? summaries : undefined;
};

const folderFilter = (folder?: string): BaseFilter | undefined =>
  folder ? { and: [`file.inFolder(${JSON.stringify(folder)})`] } : undefined;

export const notidianTableToBaseDocument = (
  table: SpaceTable,
  options: NotidianTableToBaseOptions = {}
): NotidianTableToBaseResult => {
  const predicate = options.predicate ?? parsePredicate(table);
  const { mappings, unsupported } = mappedColumnsForTable(table, predicate);
  const mappingsByColumn = new Map(
    mappings.map((mapping) => [mapping.column.name, mapping] as const)
  );
  const mappedFilters = mapFilters(predicate, mappingsByColumn);
  const mappedGroupBy = mapGroupBy(predicate, mappingsByColumn);
  const summaries = summariesForPredicate(predicate, mappingsByColumn);
  const filters = folderFilter(options.folder);
  const properties = propertiesForMappings(mappings);

  const view: BaseTableView = {
    type: "table",
    name: options.viewName ?? table?.schema?.name ?? "Table",
    ...(predicate?.limit > 0 ? { limit: predicate.limit } : {}),
    ...(mappedGroupBy.groupBy ? { groupBy: mappedGroupBy.groupBy } : {}),
    ...(mappedFilters.filters ? { filters: mappedFilters.filters } : {}),
    order: mappings.map((mapping) => mapping.baseProperty),
    ...(summaries ? { summaries } : {}),
  };

  return {
    document: {
      ...(filters ? { filters } : {}),
      ...(properties ? { properties } : {}),
      views: [view],
    },
    unsupported: [
      ...unsupported,
      ...mappedFilters.unsupported,
      ...(mappedGroupBy.unsupported ? [mappedGroupBy.unsupported] : []),
      ...mapSorts(predicate?.sort),
    ],
  };
};

const isPlainYamlKey = (value: string): boolean => /^[A-Za-z0-9_.-]+$/.test(value);

const yamlKey = (key: string): string =>
  isPlainYamlKey(key) ? key : JSON.stringify(key);

const yamlScalar = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "null";
  return JSON.stringify(value);
};

const writeYaml = (value: unknown, indent = 0): string[] => {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const lines = writeYaml(item, indent + 2);
        if (lines.length === 0) return [`${pad}- {}`];
        return [`${pad}- ${lines[0].trimStart()}`, ...lines.slice(1)];
      }
      return [`${pad}- ${yamlScalar(item)}`];
    });
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => {
        if (
          child &&
          typeof child === "object" &&
          (Array.isArray(child) || Object.keys(child).length > 0)
        ) {
          return [`${pad}${yamlKey(key)}:`, ...writeYaml(child, indent + 2)];
        }
        return [`${pad}${yamlKey(key)}: ${yamlScalar(child)}`];
      }
    );
  }

  return [`${pad}${yamlScalar(value)}`];
};

export const serializeBaseDocumentToYaml = (document: BaseDocument): string =>
  `${writeYaml(document).join("\n")}\n`;
