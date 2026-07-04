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

// ADR-0056 D10: renaming an `enum: {strict: true}` value is a bulk data
// migration — every row currently holding the old value must move to the new
// one or become invalid. This planner extension classifies live rows before
// any write, the same preview-before-apply discipline as the property
// rename above. Preview-only this session (no apply path yet).
export type EnumValueRenameIssue =
  | { reason: "empty-value"; which: "old" | "new" }
  | { reason: "same-value"; value: string }
  | { reason: "empty-field"; field: string }
  | { reason: "missing-field"; field: string };

// A row's classification relative to the {oldValue, newValue} pair. Unlike a
// KEY rename (two candidate storage locations that can each hold a
// value, compared for equality) a VALUE rename has one storage location
// (the field) holding either a scalar or, for a list-valued/multi-select
// field, a set of values — so "old-only"/"new-only"/"neither" carry over
// directly, but there is no "both-same" analogue (there is no second value to
// compare for equality against — presence is a boolean, and oldValue !=
// newValue is already guaranteed by the "same-value" issue above). A
// multi-select row that already holds BOTH values is "both-conflict": after
// the rename it would hold a duplicate, so it is flagged for review rather
// than silently deduped.
export type EnumValueRenameRowState =
  | "old-only"
  | "new-only"
  | "both-conflict"
  | "neither";

export type EnumValueRenameFilePlan = {
  path: string;
  state: EnumValueRenameRowState;
  currentValue: unknown;
};

export type EnumValueRenameCascadePlan = {
  canApplyAutomatically: boolean;
  requiresResolution: boolean;
  issues: EnumValueRenameIssue[];
  // Whether the field's column is list-valued (multi_select/option-multi) —
  // only a list-valued field can ever land in "both-conflict".
  isListValued: boolean;
  fileStates: EnumValueRenameFilePlan[];
  // Paths a write would need to touch: old-only (rename in place) plus
  // both-conflict (dedupe old out, keep new) — new-only and neither are no-ops.
  affectedPaths: string[];
};

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

// A list-valued (multi_select/option-multi) frontmatter value can be a native
// YAML array already, or (less commonly) a comma/JSON-string form the same
// way other multi-value cells are authored. Reuses no new parsing rule —
// falls back to a bare array pass-through, matching how `option-multi`
// values are already stored in frontmatter (a YAML list) the overwhelming
// common case; a raw string is treated as a single-element list rather than
// pulled through display-string escaping rules that belong to the MDB layer,
// not frontmatter YAML.
const toValueList = (raw: unknown): string[] => {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  return [String(raw)];
};

const isListValuedColumn = (table: SpaceTable, field: string): boolean => {
  const column = columnForKey(table, field);
  return column ? column.type.startsWith("option-multi") : false;
};

// ADR-0056 D10: preview an enum value rename's row-level cascade before any
// write. Pure and read-only — classifies every row by whether it currently
// holds `oldValue`, `newValue`, both (list-valued fields only), or neither.
// No apply path in this session (S1); a future session wires the write.
export const planEnumValueRenameCascade = ({
  table,
  field,
  oldValue,
  newValue,
  paths,
  frontmatterByPath,
}: {
  table: SpaceTable;
  field: string;
  oldValue: string;
  newValue: string;
  paths: string[];
  frontmatterByPath: FrontmatterSnapshotsByPath;
}): EnumValueRenameCascadePlan => {
  const normalizedField = trimmedKey(field);
  const issues: EnumValueRenameIssue[] = [];

  if (!oldValue) issues.push({ reason: "empty-value", which: "old" });
  if (!newValue) issues.push({ reason: "empty-value", which: "new" });
  if (oldValue && newValue && oldValue == newValue) {
    issues.push({ reason: "same-value", value: oldValue });
  }
  if (!normalizedField) {
    issues.push({ reason: "empty-field", field });
  } else if (!columnForKey(table, normalizedField)) {
    issues.push({ reason: "missing-field", field: normalizedField });
  }

  const isListValued = normalizedField
    ? isListValuedColumn(table, normalizedField)
    : false;

  const fileStates: EnumValueRenameFilePlan[] = [];
  if (issues.length == 0) {
    for (const path of paths) {
      const frontmatter = frontmatterForPath(frontmatterByPath, path);
      const currentValue = frontmatter[normalizedField];
      const values = isListValued
        ? toValueList(currentValue)
        : currentValue != null
        ? [String(currentValue)]
        : [];
      const hasOld = values.includes(oldValue);
      const hasNew = values.includes(newValue);
      const state: EnumValueRenameRowState =
        hasOld && hasNew
          ? "both-conflict"
          : hasOld
          ? "old-only"
          : hasNew
          ? "new-only"
          : "neither";
      fileStates.push({ path, state, currentValue });
    }
  }

  const affectedPaths = fileStates
    .filter((f) => f.state == "old-only" || f.state == "both-conflict")
    .map((f) => f.path);
  const requiresResolution = fileStates.some(
    (f) => f.state == "both-conflict"
  );

  return {
    canApplyAutomatically: issues.length == 0 && !requiresResolution,
    requiresResolution,
    issues,
    isListValued,
    fileStates,
    affectedPaths,
  };
};
