import { FMMetadataKeys } from "core/types/space";
import { Superstate } from "makemd-core";
import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable, SpaceTableSchema } from "shared/types/mdb";
import { PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { detectPropertyType, yamlTypeToMDBType } from "utils/properties";
import {
  propertyAuthorityForColumn,
  shouldPersistAuthorityValueToContext,
  shouldWriteAuthorityValueToFrontmatter,
} from "./propertyAuthority";

export type PropertyType = {
  name: string;
  type: string;
};

export const frontmatterPropertySource = "frontmatter";

export const isFrontmatterBackedProperty = (
  property?: Partial<Pick<SpaceProperty, "name" | "source" | "type" | "value">>
): boolean => property?.source === frontmatterPropertySource;

export const shouldWriteContextPropertyToFrontmatter = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => shouldWriteAuthorityValueToFrontmatter(property);

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

export const shouldImportFrontmatterColumns = (
  dbSchema: Pick<SpaceTableSchema, "primary"> | null | undefined,
  persistedCols: Pick<SpaceProperty, "name" | "type" | "value">[] = [],
  discoveredCount: number
): boolean =>
  dbSchema?.primary == "true" &&
  contextHasOnlyDefaultColumns(persistedCols) &&
  discoveredCount > 0;

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

const contextHasOnlyDefaultOrObservedFrontmatterColumns = (
  cols: Pick<SpaceProperty, "name" | "type" | "value">[] = [],
  frontmatterProperties: Set<string>
): boolean => {
  return cols.every(
    (col) =>
      contextHasOnlyDefaultColumns([col]) ||
      isFrontmatterBackedProperty(col) ||
      frontmatterProperties.has(col.name)
  );
};

const safeFrontmatterType = (types: Set<string>): string => {
  const knownTypes = [...types].filter((type) => type !== "unknown");
  if (knownTypes.length === 0) return "text";

  const uniqueTypes = new Set(knownTypes);
  return uniqueTypes.size === 1 ? knownTypes[0] : "text";
};

type ObservedFrontmatterProperties = {
  propertyNames: Set<string>;
  propertyTypes: Map<string, string>;
};

const observeFrontmatterProperties = (
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings
): ObservedFrontmatterProperties => {
  const excluded = excludedFrontmatterPropertyNames(settings);
  const propertyNames = new Set<string>();
  const observedTypes = new Map<string, Set<string>>();

  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;

    for (const key of Object.keys(properties)) {
      if (excluded.has(key)) continue;
      propertyNames.add(key);
      const mappedType = yamlTypeToMDBType(
        detectPropertyType(properties[key], key)
      );
      observedTypes.set(
        key,
        new Set([...(observedTypes.get(key) ?? []), mappedType])
      );
    }
  }

  return {
    propertyNames,
    propertyTypes: new Map(
      [...observedTypes.entries()].map(([key, types]) => [
        key,
        safeFrontmatterType(types),
      ])
    ),
  };
};

const discoverFrontmatterPropertiesFromObserved = (
  observed: ObservedFrontmatterProperties,
  existingCols: Pick<SpaceProperty, "name">[] = [],
  schemaId = defaultContextSchemaID
): SpaceProperty[] => {
  const seen = new Set(existingCols.map((col) => col.name));
  const discovered: SpaceProperty[] = [];

  for (const key of observed.propertyNames) {
    if (seen.has(key)) continue;
    discovered.push({
      name: key,
      type: observed.propertyTypes.get(key) ?? "text",
      value: "",
      schemaId,
      source: frontmatterPropertySource,
    });
    seen.add(key);
  }

  return discovered;
};

export const discoverFrontmatterPropertiesFromPathStates = (
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings,
  existingCols: Pick<SpaceProperty, "name">[] = [],
  schemaId = defaultContextSchemaID
): SpaceProperty[] => {
  return discoverFrontmatterPropertiesFromObserved(
    observeFrontmatterProperties(pathsIndex, paths, settings),
    existingCols,
    schemaId
  );
};

export const propertyMenuDiscoveryScope = (
  fieldSource: string,
  contextPath?: string
): string | undefined => {
  // "$fm" targets a single file's own frontmatter (or an object subfield /
  // action parameter); there is no space row set to discover keys from.
  const scope = fieldSource === "" ? contextPath : fieldSource;
  if (!scope || scope === "$fm") return undefined;
  return scope;
};

export const filterPropertiesForNameQuery = <
  T extends Pick<SpaceProperty, "name">
>(
  properties: T[],
  query: string
): T[] => {
  const trimmed = (query ?? "").trim().toLowerCase();
  if (!trimmed) return properties;
  return properties.filter((property) =>
    property.name.toLowerCase().includes(trimmed)
  );
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
  let observedFrontmatter: ObservedFrontmatterProperties | null = null;
  const getObservedFrontmatter = () => {
    if (!observedFrontmatter) {
      observedFrontmatter = observeFrontmatterProperties(
        pathsIndex,
        paths,
        settings
      );
    }
    return observedFrontmatter;
  };

  if (
    !enabled ||
    (!contextHasOnlyDefaultColumns(sourceCols) &&
      !contextHasOnlyDefaultOrObservedFrontmatterColumns(
        sourceCols,
        getObservedFrontmatter().propertyNames
      ))
  ) {
    return {
      table: { ...table, cols: sourceCols, rows: table.rows ?? [] },
      changed: false,
    };
  }

  const { propertyNames, propertyTypes } = getObservedFrontmatter();

  const normalizedCols = sourceCols.map((col) => {
    if (
      contextHasOnlyDefaultColumns([col]) ||
      !propertyNames.has(col.name) ||
      isFrontmatterBackedProperty(col) ||
      // Respect explicit Notidian ownership (and context-only types whose only
      // durable home is the MDB): never auto-convert them to frontmatter just
      // because a file happens to expose a same-named frontmatter key (ADR 0017).
      propertyAuthorityForColumn(col) === "notidian" ||
      // Respect COMPUTED/read-only columns (fileprop/aggregate/rollup/backlink):
      // their value is derived at render time, so a same-named frontmatter key
      // must NEVER re-type them or stamp source:"frontmatter". Re-typing here
      // would silently destroy the computed classification and break the
      // derived-value-skip promise at its source — apiValueWriteTarget only
      // defends "skip" while the type is STILL computed (ADR 0001/0017; bd
      // memory any-new-computed-read-only-column-type; Notidian-0jq).
      propertyAuthorityForColumn(col) === "computed"
    ) {
      return col;
    }

    return {
      ...col,
      type: propertyTypes.get(col.name) ?? col.type,
      source: frontmatterPropertySource,
    };
  });
  const discoveredCols = discoverFrontmatterPropertiesFromObserved(
    getObservedFrontmatter(),
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

  const colsByName = new Map(
    (table.cols ?? []).map((col) => [col.name, col] as const)
  );
  const nonPersistentColumns = new Set(
    (table.cols ?? [])
      .filter((col) => !shouldPersistAuthorityValueToContext(col))
      .map((col) => col.name)
  );

  if (nonPersistentColumns.size === 0) return table;

  return {
    ...table,
    rows: table.rows.map((row) =>
      Object.keys(row).reduce(
        (next, key) => {
          const column = colsByName.get(key);
          if (column && nonPersistentColumns.has(key)) return next;
          return { ...next, [key]: row[key] };
        },
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
