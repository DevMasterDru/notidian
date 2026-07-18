import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import {
  CrossDatabaseSourceDefinition,
  FrameSchema,
} from "shared/types/mframe";
import { Filter } from "shared/types/predicate";
import { fieldTypeForField } from "schemas/mdb";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import {
  makeRowMatchesFilters,
  RowMatchesSpaceManager,
} from "core/utils/contexts/predicate/rowMatchesFilters";

export const crossDatabasePropertySource = "cross-database";
export const crossDatabaseSourceColumn = "Source";
export const crossDatabaseSourceContextKey = "_notidianSourceContext";
export const crossDatabaseSourceDbKey = "_notidianSourceDb";

export const isCrossDatabaseViewReadOnly = (
  crossDatabase: boolean
): boolean => crossDatabase;

export type CrossDatabaseLoadedSource = {
  source: CrossDatabaseSourceDefinition;
  table: SpaceTable;
};

export type CrossDatabaseSourceIssue = {
  code: "invalid-source-filter";
  sourceContext: string;
  sourceDb: string;
  message: string;
};

const cleanString = (value: unknown): string =>
  typeof value == "string" ? value.trim() : "";

const defaultLabel = (context: string): string =>
  context.split("/").filter(Boolean).at(-1) ?? context;

const normalizeFilter = (value: unknown): unknown => {
  if (!value || typeof value != "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  return {
    ...raw,
    ...(typeof raw.field == "string" ? { field: raw.field.trim() } : {}),
    ...(typeof raw.fn == "string" ? { fn: raw.fn.trim() } : {}),
    ...(typeof raw.fType == "string" ? { fType: raw.fType.trim() } : {}),
  };
};

export const normalizeCrossDatabaseSources = (
  value: unknown
): CrossDatabaseSourceDefinition[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: CrossDatabaseSourceDefinition[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate != "object") continue;
    const raw = candidate as Record<string, unknown>;
    const context = cleanString(raw.context);
    if (!context) continue;
    const db = cleanString(raw.db) || defaultContextSchemaID;
    const identity = `${context}\0${db}`;
    if (seen.has(identity)) continue;

    const fields = Object.entries(
      raw.fields && typeof raw.fields == "object" && !Array.isArray(raw.fields)
        ? (raw.fields as Record<string, unknown>)
        : {}
    ).reduce<Record<string, string>>((result, [canonical, sourceField]) => {
      const canonicalName = cleanString(canonical);
      const sourceName = cleanString(sourceField);
      if (canonicalName && sourceName) result[canonicalName] = sourceName;
      return result;
    }, {});

    const source: CrossDatabaseSourceDefinition = {
      context,
      db,
      label: cleanString(raw.label) || defaultLabel(context),
      fields,
    };
    if (raw.filters !== undefined) {
      const filters = Array.isArray(raw.filters)
        ? raw.filters.map(normalizeFilter)
        : raw.filters;
      if (!Array.isArray(filters) || filters.length > 0) {
        (source as unknown as Record<string, unknown>).filters = filters;
      }
    }
    normalized.push(source);
    seen.add(identity);
  }
  return normalized;
};

const invalidSourceFilterIssue = (
  source: CrossDatabaseSourceDefinition
): CrossDatabaseSourceIssue => ({
  code: "invalid-source-filter",
  sourceContext: source.context,
  sourceDb: source.db,
  message: `Source ${source.label || source.context} has an invalid filter configuration and was excluded.`,
});

const isNativeSourceFilter = (
  value: unknown,
  table: SpaceTable
): value is Filter => {
  if (!value || typeof value != "object" || Array.isArray(value)) return false;
  const filter = value as Record<string, unknown>;
  if (
    typeof filter.field != "string" ||
    !filter.field ||
    typeof filter.fn != "string" ||
    typeof filter.value != "string" ||
    typeof filter.fType != "string"
  ) {
    return false;
  }
  const operator = filterFnTypes[filter.fn];
  if (!operator) return false;
  if (filter.fType != operator.valueType) return false;
  const column = table.cols.find(
    (candidate) => candidate.name + ((candidate as any).table ?? "") == filter.field
  );
  if (!column) return false;
  const fieldType = fieldTypeForField(column);
  if (!operator.type.includes(fieldType)) return false;
  return (
    !operator.scopedFields?.length ||
    operator.scopedFields.includes(column.name.toLowerCase())
  );
};

export const crossDatabaseSourceFilterIssue = (
  source: CrossDatabaseSourceDefinition,
  table: Pick<SpaceTable, "cols">
): CrossDatabaseSourceIssue | undefined => {
  const configured = (source as unknown as Record<string, unknown>).filters;
  if (configured === undefined) return undefined;
  return !Array.isArray(configured) ||
    configured.some((filter) => !isNativeSourceFilter(filter, table as SpaceTable))
    ? invalidSourceFilterIssue(source)
    : undefined;
};

export const filterCrossDatabaseLoadedSource = (
  loaded: CrossDatabaseLoadedSource,
  spaceManager: RowMatchesSpaceManager,
  properties: Record<string, any> | undefined | null = undefined,
  enableRecurrenceFilters = true
): { loaded: CrossDatabaseLoadedSource; issue?: CrossDatabaseSourceIssue } => {
  const configured = (loaded.source as unknown as Record<string, unknown>)
    .filters;
  if (configured === undefined) return { loaded };
  const issue = crossDatabaseSourceFilterIssue(loaded.source, loaded.table);
  if (issue) {
    return {
      loaded: {
        source: loaded.source,
        table: { ...loaded.table, rows: [] },
      },
      issue,
    };
  }
  const matches = makeRowMatchesFilters({
    filters: configured as Filter[],
    cols: loaded.table.cols.map((column) => ({ ...column, table: "" })),
    spaceManager,
    properties,
    enableRecurrenceFilters,
  });
  return {
    loaded: {
      source: loaded.source,
      table: { ...loaded.table, rows: loaded.table.rows.filter(matches) },
    },
  };
};

export const persistCrossDatabaseSources = async ({
  frameSchema,
  sources,
  saveSchema,
  setFrameSchema,
}: {
  frameSchema: FrameSchema;
  sources: CrossDatabaseSourceDefinition[];
  saveSchema: (schema: FrameSchema) => Promise<unknown>;
  setFrameSchema: (schema: FrameSchema) => void;
}): Promise<void> => {
  const nextSchema: FrameSchema = {
    ...frameSchema,
    def: {
      ...frameSchema.def,
      db: defaultContextSchemaID,
      sources,
    },
    type: "view",
  };
  await saveSchema(nextSchema);
  setFrameSchema(nextSchema);
};

const sourceColumnFor = (
  loaded: CrossDatabaseLoadedSource,
  sourceField: string
): SpaceProperty | undefined =>
  loaded.table.cols.find((column) => column.name == sourceField);

const reconciledType = (
  loadedSources: CrossDatabaseLoadedSource[],
  canonicalField: string
): string => {
  const types = new Set(
    loadedSources.flatMap((loaded) => {
      const sourceField = loaded.source.fields[canonicalField];
      const sourceColumn = sourceField
        ? sourceColumnFor(loaded, sourceField)
        : undefined;
      return sourceColumn?.type ? [sourceColumn.type] : [];
    })
  );
  return types.size == 1 ? [...types][0] : "text";
};

export const assembleCrossDatabaseView = (
  loadedSources: CrossDatabaseLoadedSource[]
): SpaceTable => {
  const canonicalFields = Array.from(
    new Set(
      loadedSources.flatMap((loaded) => Object.keys(loaded.source.fields))
    )
  );
  const fileColumn: SpaceProperty = {
    name: PathPropertyName,
    type: "fileprop",
    schemaId: defaultContextSchemaID,
    primary: "true",
  };
  const mappedColumns: SpaceProperty[] = canonicalFields.map((name) => ({
    name,
    type: reconciledType(loadedSources, name),
    schemaId: defaultContextSchemaID,
    source: crossDatabasePropertySource,
  }));
  const sourceColumn: SpaceProperty = {
    name: crossDatabaseSourceColumn,
    type: "text",
    schemaId: defaultContextSchemaID,
    source: crossDatabasePropertySource,
  };

  const seenPaths = new Set<string>();
  const rows = loadedSources.flatMap((loaded) =>
    loaded.table.rows.flatMap((sourceRow) => {
      const path = sourceRow[PathPropertyName];
      if (!path || seenPaths.has(path)) return [];
      seenPaths.add(path);
      const mapped = canonicalFields.reduce<Record<string, string>>(
        (result, canonicalField) => {
          const sourceField = loaded.source.fields[canonicalField];
          if (sourceField && sourceRow[sourceField] !== undefined) {
            result[canonicalField] = sourceRow[sourceField];
          }
          return result;
        },
        {}
      );
      return [
        {
          [PathPropertyName]: path,
          ...mapped,
          [crossDatabaseSourceColumn]:
            loaded.source.label || defaultLabel(loaded.source.context),
          [crossDatabaseSourceContextKey]: loaded.source.context,
          [crossDatabaseSourceDbKey]: loaded.source.db,
        },
      ];
    })
  );

  return {
    schema: {
      id: defaultContextSchemaID,
      name: "Cross Database View",
      type: "db",
      primary: "true",
    },
    cols: [fileColumn, ...mappedColumns, sourceColumn],
    rows,
  };
};
