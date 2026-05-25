const PathPropertyName = "File";
const frontmatterPropertySource = "frontmatter";

const blockingValueStates = new Set(["conflict", "context-only-value"]);

const hasOwn = (record, key) =>
  Object.prototype.hasOwnProperty.call(record, key);

const frontmatterForPath = (frontmatterByPath, path) =>
  frontmatterByPath instanceof Map
    ? frontmatterByPath.get(path) ?? {}
    : frontmatterByPath[path] ?? {};

const isEmptyValue = (value) =>
  value === undefined || value === null || value === "";

const normalizeValue = (value) => {
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

const parseMultiDisplayString = (value) =>
  String(value ?? "")
    .replace("\\,", ",")
    ?.match(/(\\.|[^,])+/g)
    ?.map((item) => item.trim()) ?? [];

const detectPropertyType = (value, key) => {
  if (value instanceof Date) return "date";
  if (typeof value == "string") {
    if (
      /\/\/(\S+?(?:jpe?g|png|gif|svg))/gi.test(value) ||
      value.includes("unsplash")
    ) {
      return "image";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    if (key == "tag" || key == "tags") return "tags-multi";
    if (/\[\[.*?\]\]/.test(value)) return "link";
  } else if (typeof value == "number") {
    return "number";
  } else if (typeof value == "boolean") {
    return "boolean";
  } else if (!value) {
    return "unknown";
  } else if (
    Array.isArray(value) ||
    (typeof value == "string" && value.indexOf(",") > -1)
  ) {
    let arrayValue = Array.isArray(value) ? value : [];
    if (typeof value == "string" && value.indexOf(",") > -1) {
      arrayValue = parseMultiDisplayString(value);
    }
    if (key == "tag" || key == "tags") return "tags-multi";
    if (
      arrayValue.length == 1 &&
      Array.isArray(arrayValue[0]) &&
      arrayValue[0].length == 1 &&
      typeof arrayValue[0][0] == "string"
    ) {
      return "link";
    }
    const types = [...new Set(arrayValue.map((item) =>
      detectPropertyType(item, key)
    ))];
    if (types.length == 1 && types[0] == "link") return "link-multi";
    if (types.some((type) => type == "object")) return "object-multi";
    return "option-multi";
  } else if (value.isLuxonDateTime) {
    return "date";
  } else if (value.isLuxonDuration) {
    return "duration";
  } else if (value.type == "file") {
    return "link";
  } else if (
    typeof value == "object" &&
    !Array.isArray(value) &&
    value !== null
  ) {
    return "object";
  }
  return "text";
};

const yamlTypeToMDBType = (yamlType) => {
  switch (yamlType) {
    case "duration":
    case "unknown":
      return "text";
    default:
      return yamlType;
  }
};

const safeFrontmatterType = (types) => {
  const knownTypes = [...types].filter((type) => type != "unknown");
  if (knownTypes.length == 0) return "text";
  const uniqueTypes = new Set(knownTypes);
  return uniqueTypes.size == 1 ? knownTypes[0] : "text";
};

const propertyAuthorityForColumn = (property) => {
  if (property?.name == PathPropertyName) return "file";
  if (property?.source == frontmatterPropertySource) return "frontmatter";
  if (property?.type == "fileprop" || property?.type == "aggregate") {
    return "computed";
  }
  return "notidian";
};

const classifyValue = (columnName, row, rowIndex, frontmatter) => {
  const path = row[PathPropertyName] ?? "";
  const contextValue = normalizeValue(row[columnName]);
  const frontmatterValue = normalizeValue(frontmatter[columnName]);
  const contextEmpty = contextValue.length == 0;
  const frontmatterEmpty = frontmatterValue.length == 0;
  let state = "empty";

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

const classifyColumn = (column, observedFrontmatterCount) => {
  const authority = propertyAuthorityForColumn(column);
  if (authority == "file") return "file";
  if (authority == "computed") return "computed";
  if (authority == "frontmatter") return "already-frontmatter";
  return observedFrontmatterCount > 0
    ? "frontmatter-candidate"
    : "context-only";
};

const auditLegacyContextTable = ({
  table,
  frontmatterByPath,
  schemaId = table?.schema?.id ?? "",
  excludedFrontmatterKeys = [],
}) => {
  const rows = table?.rows ?? [];
  const cols = table?.cols ?? [];
  const existingColumnNames = new Set(cols.map((column) => column.name));
  const excluded = new Set(excludedFrontmatterKeys);
  const discoveredNames = new Set();
  const discoveredTypes = new Map();
  const discoveredFrontmatterColumns = [];

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

  const columns = cols.map((column) => {
    const observedFrontmatterCount = rows.filter((row) => {
      const path = row[PathPropertyName] ?? "";
      return hasOwn(frontmatterForPath(frontmatterByPath, path), column.name);
    }).length;
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
    discoveredFrontmatterColumns: discoveredFrontmatterColumns.map((column) => ({
      ...column,
      type: safeFrontmatterType(discoveredTypes.get(column.name) ?? new Set()),
    })),
  };
};

const columnHasBlockingIssues = (column) =>
  column.valueIssues.some((issue) => blockingValueStates.has(issue.state));

const createLegacyContextMigrationPlan = (audit) => {
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

const applyLegacyContextMigrationPlan = (table, plan) => {
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
      Object.keys(row).reduce((nextRow, key) => {
        if (columnsToStrip.has(key)) return nextRow;
        return { ...nextRow, [key]: row[key] };
      }, {})
    ),
  };
};

module.exports = {
  PathPropertyName,
  frontmatterPropertySource,
  auditLegacyContextTable,
  createLegacyContextMigrationPlan,
  applyLegacyContextMigrationPlan,
};
