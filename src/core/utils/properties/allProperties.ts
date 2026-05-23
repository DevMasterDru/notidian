import { FMMetadataKeys } from "core/types/space";
import { Superstate } from "makemd-core";
import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { SpaceProperty } from "shared/types/mdb";
import { PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { detectPropertyType, yamlTypeToMDBType } from "utils/properties";

export type PropertyType = {
  name: string;
  type: string;
};

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
      contextHasOnlyDefaultColumns([col]) || frontmatterProperties.has(col.name)
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
      });
      seen.add(key);
    }
  }

  return discovered;
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
