import { FMMetadataKeys } from "core/types/space";
import { Superstate } from "makemd-core";
import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { detectPropertyType, yamlTypeToMDBType } from "utils/properties";

export type PropertyType = {
  name: string;
  type: string;
};

export const frontmatterPropertySource = "frontmatter";

export const isFrontmatterBackedProperty = (
  property?: Partial<Pick<SpaceProperty, "name" | "source" | "type" | "value">>
): boolean => property?.source === frontmatterPropertySource;

export const shouldWriteContextPropertyToFrontmatter = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>,
  saveAllContextToFrontmatter: boolean
): boolean =>
  property?.name !== PathPropertyName &&
  (isFrontmatterBackedProperty(property) || saveAllContextToFrontmatter);

export const excludedFrontmatterPropertyNames = (
  settings: MakeMDSettings
): Set<string> =>
  new Set(
    [
      ...FMMetadataKeys(settings),
      settings.fmKeyAlias,
      "tags",
    ].filter(Boolean)
  );

export const contextHasOnlyDefaultColumns = (
  cols: Pick<SpaceProperty, "name" | "type" | "value">[] = []
): boolean => {
  if (cols.length === 0) return true;
  return cols.every((col) =>
    (defaultContextFields.rows as SpaceProperty[]).some(
      (defaultCol) =>
        defaultCol.name === col.name &&
        defaultCol.type === col.type &&
        (defaultCol.value ?? "") === (col.value ?? "")
    )
  );
};

export const contextHasOnlyDefaultOrFrontmatterColumns = (
  cols: Pick<SpaceProperty, "name" | "type" | "value">[] = [],
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings
): boolean => {
  if (contextHasOnlyDefaultColumns(cols)) return true;

  const excluded = excludedFrontmatterPropertyNames(settings);
  const frontmatterProperties = new Set<string>();

  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;

    for (const key of Object.keys(properties)) {
      if (!excluded.has(key)) frontmatterProperties.add(key);
    }
  }

  return cols.every(
    (col) =>
      contextHasOnlyDefaultColumns([col]) ||
      isFrontmatterBackedProperty(col) ||
      frontmatterProperties.has(col.name)
  );
};

export const discoverFrontmatterPropertiesFromPathStates = (
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings,
  existingCols: Pick<SpaceProperty, "name">[] = [],
  schemaId = defaultContextSchemaID
): SpaceProperty[] => {
  const excluded = excludedFrontmatterPropertyNames(settings);
  const seen = new Set(existingCols.map((col) => col.name));
  const discovered: SpaceProperty[] = [];

  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;

    for (const key of Object.keys(properties)) {
      if (excluded.has(key) || seen.has(key)) continue;
      discovered.push({
        name: key,
        type: yamlTypeToMDBType(detectPropertyType(properties[key], key)),
        value: "",
        schemaId,
        source: frontmatterPropertySource,
      });
      seen.add(key);
    }
  }

  return discovered;
};

export const materializeFrontmatterBackedContextTable = (
  table: SpaceTable,
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings,
  enabled: boolean
): { table: SpaceTable; changed: boolean } => {
  if (!table) return { table, changed: false };

  const sourceCols = table.cols?.length > 0
    ? table.cols
    : defaultContextFields.rows as SpaceProperty[];

  if (
    !enabled ||
    !contextHasOnlyDefaultOrFrontmatterColumns(
      sourceCols,
      pathsIndex,
      paths,
      settings
    )
  ) {
    return {
      table: { ...table, cols: sourceCols, rows: table.rows ?? [] },
      changed: false,
    };
  }

  const excluded = excludedFrontmatterPropertyNames(settings);
  const frontmatterProperties = new Set<string>();
  const frontmatterPropertyTypes = new Map<string, string>();
  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;

    for (const key of Object.keys(properties)) {
      if (excluded.has(key)) continue;
      frontmatterProperties.add(key);
      if (!frontmatterPropertyTypes.has(key)) {
        frontmatterPropertyTypes.set(
          key,
          yamlTypeToMDBType(detectPropertyType(properties[key], key))
        );
      }
    }
  }

  const normalizedCols = sourceCols.map((col) => {
    if (
      contextHasOnlyDefaultColumns([col]) ||
      !frontmatterProperties.has(col.name)
    ) {
      return col;
    }

    return {
      ...col,
      type: frontmatterPropertyTypes.get(col.name) ?? col.type,
      source: frontmatterPropertySource,
    };
  });
  const discoveredCols = discoverFrontmatterPropertiesFromPathStates(
    pathsIndex,
    paths,
    settings,
    normalizedCols,
    defaultContextSchemaID
  );
  const nextTable = {
    ...table,
    cols: [...normalizedCols, ...discoveredCols],
    rows: table.rows ?? [],
  };

  return {
    table: nextTable,
    changed:
      discoveredCols.length > 0 ||
      normalizedCols.some((col, index) => col !== sourceCols[index]),
  };
};

export const stripFrontmatterBackedRowValues = (
  table: SpaceTable
): SpaceTable => {
  if (!table?.rows?.length) return table;

  const frontmatterColumns = new Set(
    (table.cols ?? [])
      .filter((col) => col.name !== PathPropertyName)
      .filter(isFrontmatterBackedProperty)
      .map((col) => col.name)
  );

  if (frontmatterColumns.size === 0) return table;

  return {
    ...table,
    rows: table.rows.map((row) =>
      Object.keys(row).reduce(
        (next, key) =>
          frontmatterColumns.has(key) ? next : { ...next, [key]: row[key] },
        {}
      )
    ),
  };
};


export const allPropertiesForPaths = (
  superstate: Superstate,
  paths: string[]
): PropertyType[] => {
  return discoverFrontmatterPropertiesFromPathStates(
    superstate.pathsIndex,
    paths,
    superstate.settings
  ).map((property) => ({
    name: property.name,
    type: property.type,
  }));
};
