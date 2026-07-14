import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { CrossDatabaseSourceDefinition } from "shared/types/mframe";

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

const cleanString = (value: unknown): string =>
  typeof value == "string" ? value.trim() : "";

const defaultLabel = (context: string): string =>
  context.split("/").filter(Boolean).at(-1) ?? context;

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

    normalized.push({
      context,
      db,
      label: cleanString(raw.label) || defaultLabel(context),
      fields,
    });
    seen.add(identity);
  }
  return normalized;
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
