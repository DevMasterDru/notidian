import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { detectPropertyType, yamlTypeToMDBType } from "utils/properties";

export type FrontmatterSnapshot = Record<string, unknown>;
export type FrontmatterSnapshotsByPath =
  | Record<string, FrontmatterSnapshot | undefined>
  | Map<string, FrontmatterSnapshot | undefined>;

export type FrontmatterWritePlan = {
  path: string;
  set: Record<string, unknown>;
  removeKeys: string[];
};

export type NotidianSchemaIssue =
  | { reason: "empty-key"; key: string }
  | { reason: "same-key"; key: string }
  | { reason: "missing-source-column"; key: string }
  | { reason: "duplicate-column"; key: string; existingKey: string }
  | {
      reason: "frontmatter-conflict";
      path: string;
      oldKey: string;
      newKey: string;
    };

export type FrontmatterSchemaSummary = {
  key: string;
  type: string;
  presentCount: number;
  missingCount: number;
  observedTypes: string[];
};

export type DiscoverFrontmatterSchemaOptions = {
  paths: string[];
  frontmatterByPath: FrontmatterSnapshotsByPath;
  excludedKeys?: string[];
};

export type CreateFrontmatterPropertyPlan = {
  canApply: boolean;
  issues: NotidianSchemaIssue[];
  tablePreview: SpaceTable;
  frontmatterWrites: FrontmatterWritePlan[];
};

export type RenameFrontmatterPropertyFileState =
  | "old-only"
  | "new-only"
  | "both-same"
  | "both-conflict"
  | "neither";

export type RenameFrontmatterPropertyFilePlan = {
  path: string;
  state: RenameFrontmatterPropertyFileState;
  oldValue?: unknown;
  newValue?: unknown;
};

export type RenameFrontmatterPropertyPlan = {
  canApplyAutomatically: boolean;
  requiresResolution: boolean;
  issues: NotidianSchemaIssue[];
  tablePreview: SpaceTable;
  fileStates: RenameFrontmatterPropertyFilePlan[];
  automaticWrites: FrontmatterWritePlan[];
};

export type DeleteFrontmatterPropertyMode =
  | "hide-from-view"
  | "delete-frontmatter";

export type DeleteFrontmatterPropertyPlan = {
  canApplyAutomatically: boolean;
  destructive: boolean;
  requiresConfirmation: boolean;
  issues: NotidianSchemaIssue[];
  tablePreview: SpaceTable;
  affectedFiles: string[];
  frontmatterWrites: FrontmatterWritePlan[];
};

const hasOwn = (object: FrontmatterSnapshot, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

const frontmatterForPath = (
  frontmatterByPath: FrontmatterSnapshotsByPath,
  path: string
): FrontmatterSnapshot => {
  if (frontmatterByPath instanceof Map) {
    return frontmatterByPath.get(path) ?? {};
  }

  return frontmatterByPath[path] ?? {};
};

const safeFrontmatterType = (types: string[]): string => {
  const knownTypes = types.filter((type) => type != "unknown");
  if (knownTypes.length == 0) return "text";

  return new Set(knownTypes).size == 1 ? knownTypes[0] : "text";
};

const frontmatterValueType = (key: string, value: unknown): string =>
  yamlTypeToMDBType(detectPropertyType(value, key));

const addUnique = (values: string[], value: string): string[] =>
  values.includes(value) ? values : [...values, value];

const trimmedKey = (key: string): string => key.trim();

const schemaIdForTable = (table: SpaceTable): string =>
  table.schema?.id || defaultContextSchemaID;

const caseInsensitiveColumn = (
  table: SpaceTable,
  key: string
): SpaceProperty | undefined =>
  table.cols.find((column) => column.name.toLowerCase() == key.toLowerCase());

const columnForKey = (
  table: SpaceTable,
  key: string
): SpaceProperty | undefined => table.cols.find((column) => column.name == key);

const stableNormalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value == "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = stableNormalize(
          (value as Record<string, unknown>)[key]
        );
        return normalized;
      }, {});
  }

  return value;
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;

  return JSON.stringify(stableNormalize(left)) ==
    JSON.stringify(stableNormalize(right));
};

const frontmatterColumn = (
  key: string,
  type: string,
  schemaId: string
): SpaceProperty => ({
  name: key,
  type,
  value: "",
  schemaId,
  source: frontmatterPropertySource,
});

const hideColumnInPreview = (table: SpaceTable, key: string): SpaceTable => ({
  ...table,
  cols: table.cols.map((column) =>
    column.name == key ? { ...column, hidden: "true" } : column
  ),
});

export const discoverFrontmatterSchema = ({
  paths,
  frontmatterByPath,
  excludedKeys = [],
}: DiscoverFrontmatterSchemaOptions): FrontmatterSchemaSummary[] => {
  const excluded = new Set([PathPropertyName, ...excludedKeys]);
  const summaries = new Map<
    string,
    {
      presentCount: number;
      observedTypes: string[];
    }
  >();

  for (const path of paths) {
    const frontmatter = frontmatterForPath(frontmatterByPath, path);

    for (const key of Object.keys(frontmatter)) {
      if (excluded.has(key)) continue;

      const existing = summaries.get(key) ?? {
        presentCount: 0,
        observedTypes: [],
      };
      const observedType = frontmatterValueType(key, frontmatter[key]);

      summaries.set(key, {
        presentCount: existing.presentCount + 1,
        observedTypes: addUnique(existing.observedTypes, observedType),
      });
    }
  }

  return [...summaries.entries()].map(([key, summary]) => ({
    key,
    type: safeFrontmatterType(summary.observedTypes),
    presentCount: summary.presentCount,
    missingCount: paths.length - summary.presentCount,
    observedTypes: summary.observedTypes,
  }));
};

export const createFrontmatterPropertyPlan = ({
  table,
  key,
  type = "text",
}: {
  table: SpaceTable;
  key: string;
  type?: string;
}): CreateFrontmatterPropertyPlan => {
  const normalizedKey = trimmedKey(key);
  const issues: NotidianSchemaIssue[] = [];

  if (!normalizedKey) {
    issues.push({ reason: "empty-key", key });
  }

  const duplicate = normalizedKey
    ? caseInsensitiveColumn(table, normalizedKey)
    : undefined;
  if (duplicate) {
    issues.push({
      reason: "duplicate-column",
      key,
      existingKey: duplicate.name,
    });
  }

  if (issues.length > 0) {
    return {
      canApply: false,
      issues,
      tablePreview: table,
      frontmatterWrites: [],
    };
  }

  return {
    canApply: true,
    issues,
    tablePreview: {
      ...table,
      cols: [
        ...table.cols,
        frontmatterColumn(normalizedKey, type, schemaIdForTable(table)),
      ],
    },
    frontmatterWrites: [],
  };
};

export const planRenameFrontmatterProperty = ({
  table,
  oldKey,
  newKey,
  paths,
  frontmatterByPath,
}: {
  table: SpaceTable;
  oldKey: string;
  newKey: string;
  paths: string[];
  frontmatterByPath: FrontmatterSnapshotsByPath;
}): RenameFrontmatterPropertyPlan => {
  const normalizedOldKey = trimmedKey(oldKey);
  const normalizedNewKey = trimmedKey(newKey);
  const issues: NotidianSchemaIssue[] = [];
  const sourceColumn = normalizedOldKey
    ? columnForKey(table, normalizedOldKey)
    : undefined;
  const targetColumn = normalizedNewKey
    ? caseInsensitiveColumn(table, normalizedNewKey)
    : undefined;
  const targetIsSource =
    targetColumn?.name.toLowerCase() == normalizedOldKey.toLowerCase();
  const schemaHasBlockingIssue = (): boolean =>
    issues.some((issue) => issue.reason != "frontmatter-conflict");

  if (!normalizedOldKey) {
    issues.push({ reason: "empty-key", key: oldKey });
  }

  if (!normalizedNewKey) {
    issues.push({ reason: "empty-key", key: newKey });
  }

  if (
    normalizedOldKey &&
    normalizedNewKey &&
    normalizedOldKey.toLowerCase() == normalizedNewKey.toLowerCase()
  ) {
    issues.push({ reason: "same-key", key: normalizedOldKey });
  }

  if (normalizedOldKey && !sourceColumn) {
    issues.push({ reason: "missing-source-column", key: normalizedOldKey });
  }

  if (targetColumn && !targetIsSource) {
    issues.push({
      reason: "duplicate-column",
      key: newKey,
      existingKey: targetColumn.name,
    });
  }

  const fileStates: RenameFrontmatterPropertyFilePlan[] = [];
  const automaticWrites: FrontmatterWritePlan[] = [];

  if (
    !schemaHasBlockingIssue() &&
    normalizedOldKey &&
    normalizedNewKey
  ) {
    for (const path of paths) {
      const frontmatter = frontmatterForPath(frontmatterByPath, path);
      const hasOld = hasOwn(frontmatter, normalizedOldKey);
      const hasNew = hasOwn(frontmatter, normalizedNewKey);

      if (hasOld && hasNew) {
        const oldValue = frontmatter[normalizedOldKey];
        const newValue = frontmatter[normalizedNewKey];

        if (valuesEqual(oldValue, newValue)) {
          fileStates.push({
            path,
            state: "both-same",
            oldValue,
            newValue,
          });
          automaticWrites.push({
            path,
            set: {},
            removeKeys: [normalizedOldKey],
          });
        } else {
          fileStates.push({
            path,
            state: "both-conflict",
            oldValue,
            newValue,
          });
          issues.push({
            reason: "frontmatter-conflict",
            path,
            oldKey: normalizedOldKey,
            newKey: normalizedNewKey,
          });
        }
      } else if (hasOld) {
        const oldValue = frontmatter[normalizedOldKey];
        fileStates.push({
          path,
          state: "old-only",
          oldValue,
        });
        automaticWrites.push({
          path,
          set: { [normalizedNewKey]: oldValue },
          removeKeys: [normalizedOldKey],
        });
      } else if (hasNew) {
        fileStates.push({
          path,
          state: "new-only",
          newValue: frontmatter[normalizedNewKey],
        });
      } else {
        fileStates.push({ path, state: "neither" });
      }
    }
  }

  const tablePreview = schemaHasBlockingIssue()
    ? table
    : {
        ...table,
        cols: table.cols.map((column) =>
          column.name == normalizedOldKey
            ? {
                ...column,
                name: normalizedNewKey,
                schemaId: column.schemaId ?? schemaIdForTable(table),
                source: frontmatterPropertySource,
              }
            : column
        ),
      };
  const requiresResolution = issues.some(
    (issue) => issue.reason == "frontmatter-conflict"
  );

  return {
    canApplyAutomatically: issues.length == 0,
    requiresResolution,
    issues,
    tablePreview,
    fileStates,
    automaticWrites,
  };
};

export const planDeleteFrontmatterProperty = ({
  table,
  key,
  mode,
  paths,
  frontmatterByPath,
}: {
  table: SpaceTable;
  key: string;
  mode: DeleteFrontmatterPropertyMode;
  paths: string[];
  frontmatterByPath: FrontmatterSnapshotsByPath;
}): DeleteFrontmatterPropertyPlan => {
  const normalizedKey = trimmedKey(key);
  const issues: NotidianSchemaIssue[] = [];

  if (!normalizedKey) {
    issues.push({ reason: "empty-key", key });
  }

  if (normalizedKey && !columnForKey(table, normalizedKey)) {
    issues.push({ reason: "missing-source-column", key: normalizedKey });
  }

  const tablePreview = normalizedKey
    ? hideColumnInPreview(table, normalizedKey)
    : table;
  const destructive = mode == "delete-frontmatter";
  const affectedFiles: string[] = [];
  const frontmatterWrites: FrontmatterWritePlan[] = [];

  if (destructive && normalizedKey && issues.length == 0) {
    for (const path of paths) {
      const frontmatter = frontmatterForPath(frontmatterByPath, path);
      if (!hasOwn(frontmatter, normalizedKey)) continue;

      affectedFiles.push(path);
      frontmatterWrites.push({
        path,
        set: {},
        removeKeys: [normalizedKey],
      });
    }
  }

  return {
    canApplyAutomatically: issues.length == 0 && !destructive,
    destructive,
    requiresConfirmation: destructive && affectedFiles.length > 0,
    issues,
    tablePreview,
    affectedFiles,
    frontmatterWrites,
  };
};
