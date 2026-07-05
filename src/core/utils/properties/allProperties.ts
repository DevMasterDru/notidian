import { FMMetadataKeys } from "core/types/space";
import { typeProfileReservedFrontmatterKeys } from "core/utils/contexts/hubRowCascade";
import { typeProfileSchemaType } from "core/utils/contexts/typeProfile";
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

// Vault-wide structural exclusions: these apply to every row regardless of
// that row's own frontmatter content (metadata keys, alias key, tags).
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

// Notidian-z21a (gated, ADR-0042 D1): a row that is itself a nested
// child-hub declares Type Profile structural keys (schema_type/fields/
// kind_fields/invariants) on ITS OWN frontmatter for its own child database.
// Those keys are never the PARENT database's row data, so parent-table
// column discovery must not surface them as noisy columns FOR THAT ROW.
//
// This must be scoped to the specific row that actually declares the
// schema (`schema_type === typeProfileSchemaType` on ITS OWN frontmatter) —
// never a blanket, vault-wide exclusion by bare key name. An unrelated row
// elsewhere in the vault that happens to use a field literally named
// "fields"/"invariants"/"kind_fields"/"schema_type" for its own reasons must
// keep that column discoverable; only a genuine hub-row declaration hides
// these four keys from its parent table.
export const isTypeProfileDeclaringRowFrontmatter = (
  properties: Record<string, unknown> | null | undefined,
  settings: MakeMDSettings
): boolean =>
  !!settings.enableNestedHubRows &&
  !!properties &&
  properties["schema_type"] === typeProfileSchemaType;

// Per-row exclusion set: the static (always-on) exclusions, plus the four
// Type Profile structural keys ONLY when this specific row's own
// frontmatter declares itself a Type Profile (see
// isTypeProfileDeclaringRowFrontmatter above). Reuses `staticExcluded`
// as-is in the common (non-declaring) case to avoid allocating a new Set
// per row.
const excludedKeysForRow = (
  properties: Record<string, unknown> | null | undefined,
  settings: MakeMDSettings,
  staticExcluded: Set<string>
): Set<string> =>
  isTypeProfileDeclaringRowFrontmatter(properties, settings)
    ? new Set([...staticExcluded, ...typeProfileReservedFrontmatterKeys])
    : staticExcluded;

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

  const staticExcluded = excludedFrontmatterPropertyNames(settings);
  const frontmatterProperties = new Set<string>();

  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;
    const excluded = excludedKeysForRow(properties, settings, staticExcluded);

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
  const staticExcluded = excludedFrontmatterPropertyNames(settings);
  const propertyNames = new Set<string>();
  const observedTypes = new Map<string, Set<string>>();

  for (const path of paths) {
    const properties = pathsIndex.get(path)?.metadata?.property;
    if (!properties) continue;
    const excluded = excludedKeysForRow(properties, settings, staticExcluded);

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
  // Notidian-1q8y: SQLite treats column identifiers case-INSENSITIVELY, so two
  // keys differing only by case ("Status"/"status") would produce a
  // `CREATE TABLE ... ("Status" char,"status" char)` that throws
  // `duplicate column name` — and every save of that folder's context then
  // silently fails. Dedupe the seen-set with toLowerCase() (existing columns
  // AND newly observed keys) so case-variant frontmatter keys map to ONE
  // column; the first-observed casing stays canonical.
  const seen = new Set(
    existingCols.map((col) => (col.name ?? "").toLowerCase())
  );
  const discovered: SpaceProperty[] = [];

  for (const key of observed.propertyNames) {
    const normalizedKey = key.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    discovered.push({
      name: key,
      type: observed.propertyTypes.get(key) ?? "text",
      value: "",
      schemaId,
      source: frontmatterPropertySource,
    });
    seen.add(normalizedKey);
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
