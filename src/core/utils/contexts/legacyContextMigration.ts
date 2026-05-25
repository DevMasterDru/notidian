import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { propertyAuthorityForColumn } from "core/utils/properties/propertyAuthority";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceProperty, SpaceTable } from "shared/types/mdb";
import { detectPropertyType, yamlTypeToMDBType } from "utils/properties";

export type LegacyContextColumnCategory =
  | "file"
  | "computed"
  | "already-frontmatter"
  | "frontmatter-candidate"
  | "context-only";

export type LegacyContextValueState =
  | "matching"
  | "context-only-value"
  | "frontmatter-only-value"
  | "conflict"
  | "empty";

export type LegacyContextValueIssue = {
  columnName: string;
  rowIndex: number;
  path: string;
  state: LegacyContextValueState;
  contextValue?: string;
  frontmatterValue?: string;
};

export type LegacyContextColumnClassification = {
  columnName: string;
  column: SpaceProperty;
  category: LegacyContextColumnCategory;
  observedFrontmatterCount: number;
  valueIssues: LegacyContextValueIssue[];
};

export type LegacyContextAudit = {
  tableSchemaId: string;
  columns: LegacyContextColumnClassification[];
  valueIssues: LegacyContextValueIssue[];
  blockingIssues: LegacyContextValueIssue[];
  discoveredFrontmatterColumns: SpaceProperty[];
};

export type LegacyContextMigrationPlan = {
  canApplyAutomatically: boolean;
  columnsToMarkFrontmatter: string[];
  columnsToStripFromRows: string[];
  columnsToAdd: SpaceProperty[];
  preservedContextColumns: string[];
  blockingIssues: LegacyContextValueIssue[];
  valueIssues: LegacyContextValueIssue[];
};

export type LegacyContextAuditParams = {
  table: SpaceTable;
  frontmatterByPath:
    | Record<string, Record<string, unknown>>
    | Map<string, Record<string, unknown>>;
  schemaId?: string;
  excludedFrontmatterKeys?: Iterable<string>;
};

const blockingValueStates = new Set<LegacyContextValueState>([
  "conflict",
  "context-only-value",
]);

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const frontmatterForPath = (
  frontmatterByPath: LegacyContextAuditParams["frontmatterByPath"],
  path: string
): Record<string, unknown> =>
  frontmatterByPath instanceof Map
    ? frontmatterByPath.get(path) ?? {}
    : frontmatterByPath[path] ?? {};

const isEmptyValue = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

const normalizeValue = (value: unknown): string => {
  if (isEmptyValue(value)) return "";
  if (typeof value == "string") return value;
  if (typeof value == "number" || typeof value == "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
};

const classifyValue = (
  columnName: string,
  row: DBRow,
  rowIndex: number,
  frontmatter: Record<string, unknown>
): LegacyContextValueIssue => {
  const path = row[PathPropertyName] ?? "";
  const contextValue = normalizeValue(row[columnName]);
  const frontmatterValue = normalizeValue(frontmatter[columnName]);
  const contextEmpty = contextValue.length == 0;
  const frontmatterEmpty = frontmatterValue.length == 0;
  let state: LegacyContextValueState = "empty";

  if (contextEmpty && !frontmatterEmpty) {
    state = "frontmatter-only-value";
  } else if (!contextEmpty && frontmatterEmpty) {
    state = "context-only-value";
  } else if (!contextEmpty && !frontmatterEmpty) {
    state = contextValue == frontmatterValue ? "matching" : "conflict";
  }

  return {
    columnName,
    rowIndex,
    path,
    state,
    ...(contextEmpty ? {} : { contextValue }),
    ...(frontmatterEmpty ? {} : { frontmatterValue }),
  };
};

const safeFrontmatterType = (types: Set<string>): string => {
  const knownTypes = [...types].filter((type) => type != "unknown");
  if (knownTypes.length == 0) return "text";
  const uniqueTypes = new Set(knownTypes);
  return uniqueTypes.size == 1 ? knownTypes[0] : "text";
};

const classifyColumn = (
  column: SpaceProperty,
  observedFrontmatterCount: number
): LegacyContextColumnCategory => {
  const authority = propertyAuthorityForColumn(column);
  if (authority == "file") return "file";
  if (authority == "computed") return "computed";
  if (authority == "frontmatter") return "already-frontmatter";
  return observedFrontmatterCount > 0
    ? "frontmatter-candidate"
    : "context-only";
};

export const auditLegacyContextTable = ({
  table,
  frontmatterByPath,
  schemaId = table?.schema?.id ?? "",
  excludedFrontmatterKeys = [],
}: LegacyContextAuditParams): LegacyContextAudit => {
  const rows = table?.rows ?? [];
  const cols = table?.cols ?? [];
  const existingColumnNames = new Set(cols.map((column) => column.name));
  const excluded = new Set(excludedFrontmatterKeys);
  const discoveredNames = new Set<string>();
  const discoveredTypes = new Map<string, Set<string>>();
  const discoveredFrontmatterColumns: SpaceProperty[] = [];

  for (const row of rows) {
    const path = row[PathPropertyName] ?? "";
    const frontmatter = frontmatterForPath(frontmatterByPath, path);

    for (const [key, value] of Object.entries(frontmatter)) {
      if (excluded.has(key) || existingColumnNames.has(key)) continue;
      if (!discoveredNames.has(key)) {
        discoveredNames.add(key);
        discoveredFrontmatterColumns.push({
          name: key,
          schemaId,
          type: "text",
          value: "",
          source: frontmatterPropertySource,
        });
      }
      const mappedType = yamlTypeToMDBType(detectPropertyType(value, key));
      discoveredTypes.set(
        key,
        new Set([...(discoveredTypes.get(key) ?? []), mappedType])
      );
    }
  }

  const typedDiscoveredColumns = discoveredFrontmatterColumns.map((column) => ({
    ...column,
    type: safeFrontmatterType(discoveredTypes.get(column.name) ?? new Set()),
  }));

  const columns = cols.map((column) => {
    const frontmatterRows = rows.filter((row) => {
      const path = row[PathPropertyName] ?? "";
      return hasOwn(frontmatterForPath(frontmatterByPath, path), column.name);
    });
    const observedFrontmatterCount = frontmatterRows.length;
    const category = classifyColumn(column, observedFrontmatterCount);
    const shouldInspectValues =
      category == "already-frontmatter" ||
      category == "frontmatter-candidate";
    const valueIssues = shouldInspectValues
      ? rows.map((row, rowIndex) =>
          classifyValue(
            column.name,
            row,
            rowIndex,
            frontmatterForPath(frontmatterByPath, row[PathPropertyName] ?? "")
          )
        )
      : [];

    return {
      columnName: column.name,
      column,
      category,
      observedFrontmatterCount,
      valueIssues,
    };
  });

  const valueIssues = columns.flatMap((column) => column.valueIssues);
  const blockingIssues = valueIssues.filter((issue) =>
    blockingValueStates.has(issue.state)
  );

  return {
    tableSchemaId: schemaId,
    columns,
    valueIssues,
    blockingIssues,
    discoveredFrontmatterColumns: typedDiscoveredColumns,
  };
};

const columnHasBlockingIssues = (
  column: LegacyContextColumnClassification
): boolean =>
  column.valueIssues.some((issue) => blockingValueStates.has(issue.state));

export const createLegacyContextMigrationPlan = (
  audit: LegacyContextAudit
): LegacyContextMigrationPlan => {
  const safeFrontmatterColumns = audit.columns.filter(
    (column) =>
      (column.category == "already-frontmatter" ||
        column.category == "frontmatter-candidate") &&
      !columnHasBlockingIssues(column)
  );
  const columnsToMarkFrontmatter = safeFrontmatterColumns
    .filter((column) => column.category == "frontmatter-candidate")
    .map((column) => column.columnName);
  const computedColumns = audit.columns
    .filter((column) => column.category == "computed")
    .map((column) => column.columnName);

  return {
    canApplyAutomatically: audit.blockingIssues.length == 0,
    columnsToMarkFrontmatter,
    columnsToStripFromRows: [
      ...computedColumns,
      ...safeFrontmatterColumns.map((column) => column.columnName),
    ],
    columnsToAdd: audit.discoveredFrontmatterColumns.map((column) => ({
      ...column,
    })),
    preservedContextColumns: audit.columns
      .filter((column) => column.category == "context-only")
      .map((column) => column.columnName),
    blockingIssues: audit.blockingIssues,
    valueIssues: audit.valueIssues,
  };
};

export const applyLegacyContextMigrationPlan = (
  table: SpaceTable,
  plan: LegacyContextMigrationPlan
): SpaceTable => {
  const columnsToMark = new Set(plan.columnsToMarkFrontmatter);
  const columnsToStrip = new Set(plan.columnsToStripFromRows);
  const nextCols = (table.cols ?? []).map((column) =>
    columnsToMark.has(column.name)
      ? { ...column, source: frontmatterPropertySource }
      : { ...column }
  );
  const existingColumnNames = new Set(nextCols.map((column) => column.name));

  for (const column of plan.columnsToAdd) {
    if (existingColumnNames.has(column.name)) continue;
    nextCols.push({ ...column });
    existingColumnNames.add(column.name);
  }

  return {
    ...table,
    schema: { ...table.schema },
    cols: nextCols,
    rows: (table.rows ?? []).map((row) =>
      Object.keys(row).reduce<DBRow>((nextRow, key) => {
        if (columnsToStrip.has(key)) return nextRow;
        return { ...nextRow, [key]: row[key] };
      }, {})
    ),
  };
};
