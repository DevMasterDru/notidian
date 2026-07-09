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
    }
  | {
      // Notidian-lqt4: a file's actual frontmatter key is a case-variant
      // spelling of oldKey/newKey (e.g. column "state", file key "State").
      // The exact-string per-file presence scan cannot see it, so it is
      // surfaced here explicitly instead of silently falling through to
      // "neither" (never renamed, never flagged).
      reason: "case-variant-frontmatter-key";
      path: string;
      requestedKey: string;
      foundKey: string;
    };

// Notidian-1adj: one observed case-variant spelling of a merged logical key.
export type FrontmatterSchemaCaseVariant = {
  // The exact spelling as it appeared in a file's frontmatter (e.g. "State").
  spelling: string;
  // Number of scanned paths that carried this exact spelling. A single path
  // that carries two spellings of the same logical key (a corrupt row with both
  // "state:" and "State:") increments BOTH spelling counts, so the sum of the
  // variant counts can exceed the merged entry's presentCount — that is
  // intended, and lets the adoption UI show which rows hold duplicate keys.
  count: number;
};

export type FrontmatterSchemaSummary = {
  key: string;
  type: string;
  presentCount: number;
  missingCount: number;
  observedTypes: string[];
  // Notidian-1adj: present (length >= 2) ONLY when 2+ case-variant spellings of
  // the same logical key were observed and MERGED into this single canonical
  // summary entry (e.g. "state" + "State"), rather than emitted as separate
  // rows. Mirrors the case-variant-collision conventions of the rename
  // (Notidian-lqt4), delete (Notidian-1e93), and mdb-collapse (Notidian-1q8y)
  // siblings: the collision is surfaced DISTINCTLY so the schema-adoption UI can
  // show it, instead of being silently unioned away. `key` above is the
  // canonical casing = most-frequent spelling (ties broken by first-seen
  // order). Spellings are listed in first-seen order. Absent for a key observed
  // under a single spelling (not a collision).
  caseVariants?: FrontmatterSchemaCaseVariant[];
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
  // Notidian-lqt4: at least one of oldKey/newKey is NOT present under its
  // exact spelling (covers the "neither" case as well as "old-only"/
  // "new-only" -- an exact match on one side never rules out a stray
  // case-variant of the other), and a case-variant spelling of the missing
  // side IS present in this file's real frontmatter keys — ambiguous, so it
  // is never folded into "old-only"/"new-only"/"neither" and never
  // auto-written.
  | "case-variant"
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

// Notidian-1e93: a file matched by the destructive delete only because it
// carries a case-variant spelling of the deleted column (column "state", file
// key "State"). Surfaced on a DEDICATED plan field — not folded into the
// undifferentiated "N of M files do not contain this key" tally, and NOT pushed
// onto `issues` (the delete consumer treats any issue as a hard abort, but here
// we WANT the delete to proceed and strip the orphaned variant).
export type FrontmatterDeleteCaseVariant = {
  path: string;
  requestedKey: string;
  // The actual case-variant spellings present in this file's frontmatter that
  // the delete will remove (their real casing, so the write actually strips
  // them). A file with both "state" and "State" surfaces "State" here while
  // both are removed.
  foundKeys: string[];
};

export type DeleteFrontmatterPropertyPlan = {
  canApplyAutomatically: boolean;
  destructive: boolean;
  requiresConfirmation: boolean;
  issues: NotidianSchemaIssue[];
  tablePreview: SpaceTable;
  affectedFiles: string[];
  frontmatterWrites: FrontmatterWritePlan[];
  // Subset of affectedFiles that matched only via a case-variant key spelling.
  caseVariantFiles: FrontmatterDeleteCaseVariant[];
};

// Exported (Notidian-loan.3, ADR-0056 D9): the schema-adoption planner
// (typeProfileAdopt.ts) reuses these two primitives to walk the same
// paths/frontmatterByPath shape this module already accepts, rather than
// re-deriving its own frontmatter-lookup helper. Pure re-export of existing
// behavior — no change to either function.
export const hasOwn = (object: FrontmatterSnapshot, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export const frontmatterForPath = (
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

// Notidian-lqt4: mirrors caseInsensitiveColumn's case-folding, but scans a
// single file's real frontmatter keys instead of the table's schema columns.
// Called only for a key that did NOT already match exactly (the caller skips
// the probe on whichever side has an exact hit), so it never overrides an
// exact match; it is used for the old-only and new-only cases as well as
// neither, since an exact match on one key never rules out a stray
// case-variant of the other.
const caseVariantFrontmatterKey = (
  frontmatter: FrontmatterSnapshot,
  key: string
): string | undefined => {
  const lowerKey = key.toLowerCase();
  return Object.keys(frontmatter).find(
    (candidate) => candidate != key && candidate.toLowerCase() == lowerKey
  );
};

// Notidian-hz8f: a stable, JSON-serializable canonical form for equality
// comparison. Two guards make this safety-critical (it gates
// planRenameFrontmatterProperty's "both-same" auto-drop of the old key):
//   * a WeakSet visited-guard tracks the *ancestor* chain of the current
//     recursion so a self-referential value yields a stable "[Circular]"
//     sentinel instead of overflowing the stack. Each container is removed
//     from the set after its subtree is normalized, so a value merely shared
//     across siblings (a DAG, not a cycle) still normalizes fully every time.
//   * explicit Map/Set branches run BEFORE the plain-object branch. Map/Set
//     entries are not own enumerable string keys, so the object branch's
//     Object.keys() returns [] for them -- two DIFFERENT Maps/Sets would both
//     collapse to "{}" and false-compare EQUAL, silently auto-dropping a
//     differing value. Each is normalized via its (recursively normalized)
//     entries, sorted for order-independence, under a distinct tag so a Map,
//     a Set, and a plain object never collide.
const CIRCULAR_SENTINEL = "[Circular]";

const byJson = (a: unknown, b: unknown): number => {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  return ja < jb ? -1 : ja > jb ? 1 : 0;
};

const stableNormalize = (
  value: unknown,
  visited: WeakSet<object> = new WeakSet()
): unknown => {
  if (Array.isArray(value)) {
    if (visited.has(value)) return CIRCULAR_SENTINEL;
    visited.add(value);
    const normalized = value.map((item) => stableNormalize(item, visited));
    visited.delete(value);
    return normalized;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map) {
    if (visited.has(value)) return CIRCULAR_SENTINEL;
    visited.add(value);
    const entries = [...value.entries()]
      .map(([entryKey, entryValue]) => [
        stableNormalize(entryKey, visited),
        stableNormalize(entryValue, visited),
      ])
      .sort(byJson);
    visited.delete(value);
    return { "[Map]": entries };
  }

  if (value instanceof Set) {
    if (visited.has(value)) return CIRCULAR_SENTINEL;
    visited.add(value);
    const values = [...value.values()]
      .map((item) => stableNormalize(item, visited))
      .sort(byJson);
    visited.delete(value);
    return { "[Set]": values };
  }

  if (value && typeof value == "object") {
    if (visited.has(value)) return CIRCULAR_SENTINEL;
    visited.add(value);
    const normalized = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableNormalize(
          (value as Record<string, unknown>)[key],
          visited
        );
        return acc;
      }, {});
    visited.delete(value);
    return normalized;
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
  // Notidian-1adj: aggregate by case-folded key so case-variant spellings of
  // one logical field ("state" vs "State") collapse into ONE summary entry,
  // mirroring the mdb-collapse (Notidian-1q8y) / rename (Notidian-lqt4) /
  // delete (Notidian-1e93) siblings. The Map is keyed by key.toLowerCase() and
  // its insertion order (first-seen group order) drives the deterministic
  // output order, matching the original first-seen emission contract.
  const groups = new Map<
    string,
    {
      // Distinct paths carrying ANY spelling of this logical key. A path is
      // counted once even if it holds two spellings at once, so presentCount
      // never exceeds paths.length and missingCount never goes negative.
      presentCount: number;
      observedTypes: string[];
      // Exact spelling -> number of paths carrying it, in first-seen order
      // (Map insertion order). Drives both the canonical-casing choice and the
      // surfaced caseVariants breakdown.
      spellings: Map<string, number>;
    }
  >();

  for (const path of paths) {
    const frontmatter = frontmatterForPath(frontmatterByPath, path);
    // Track which logical (case-folded) keys this single path touched, so a
    // path holding both "state" and "State" adds only ONE to presentCount.
    const touched = new Set<string>();

    for (const key of Object.keys(frontmatter)) {
      if (excluded.has(key)) continue;

      const canonical = key.toLowerCase();
      const group = groups.get(canonical) ?? {
        presentCount: 0,
        observedTypes: [],
        spellings: new Map<string, number>(),
      };
      const observedType = frontmatterValueType(key, frontmatter[key]);

      group.observedTypes = addUnique(group.observedTypes, observedType);
      group.spellings.set(key, (group.spellings.get(key) ?? 0) + 1);
      if (!touched.has(canonical)) {
        touched.add(canonical);
        group.presentCount += 1;
      }
      groups.set(canonical, group);
    }
  }

  return [...groups.values()].map((group) => {
    // Canonical casing = most-frequent spelling; ties resolve to first-seen.
    // spellings iterates in first-seen (insertion) order, so a strict `>`
    // keeps the earliest-seen spelling among equal counts.
    let canonicalKey = "";
    let bestCount = -1;
    for (const [spelling, count] of group.spellings) {
      if (count > bestCount) {
        canonicalKey = spelling;
        bestCount = count;
      }
    }

    const caseVariants =
      group.spellings.size >= 2
        ? [...group.spellings.entries()].map(([spelling, count]) => ({
            spelling,
            count,
          }))
        : undefined;

    return {
      key: canonicalKey,
      type: safeFrontmatterType(group.observedTypes),
      presentCount: group.presentCount,
      missingCount: paths.length - group.presentCount,
      observedTypes: group.observedTypes,
      ...(caseVariants ? { caseVariants } : {}),
    };
  });
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
      } else {
        // Notidian-lqt4: whenever the exact-string scan does not find BOTH
        // keys, a stray case-variant spelling of whichever key is missing
        // can still be sitting in this file's real frontmatter -- e.g. old
        // key "State" is present exactly, but the file already carries a
        // hand-edited "STATUS" (a case-variant of the new key "Status").
        // This fallback must run for the old-only and new-only cases too,
        // not just when the scan finds neither key -- otherwise a blind
        // automaticWrite for the old-only case would add a *second*,
        // differently-cased spelling of the new key instead of surfacing
        // the collision, leaving the file with two live keys for one
        // logical column. Skip probing the side that already has an exact
        // match (hasOld/hasNew), since that side cannot also be a
        // case-variant miss.
        const oldCaseVariantKey = hasOld
          ? undefined
          : caseVariantFrontmatterKey(frontmatter, normalizedOldKey);
        const newCaseVariantKey = hasNew
          ? undefined
          : caseVariantFrontmatterKey(frontmatter, normalizedNewKey);

        if (oldCaseVariantKey || newCaseVariantKey) {
          fileStates.push({
            path,
            state: "case-variant",
            oldValue: hasOld
              ? frontmatter[normalizedOldKey]
              : oldCaseVariantKey
                ? frontmatter[oldCaseVariantKey]
                : undefined,
            newValue: hasNew
              ? frontmatter[normalizedNewKey]
              : newCaseVariantKey
                ? frontmatter[newCaseVariantKey]
                : undefined,
          });
          if (oldCaseVariantKey) {
            issues.push({
              reason: "case-variant-frontmatter-key",
              path,
              requestedKey: normalizedOldKey,
              foundKey: oldCaseVariantKey,
            });
          }
          if (newCaseVariantKey) {
            issues.push({
              reason: "case-variant-frontmatter-key",
              path,
              requestedKey: normalizedNewKey,
              foundKey: newCaseVariantKey,
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
    (issue) =>
      issue.reason == "frontmatter-conflict" ||
      issue.reason == "case-variant-frontmatter-key"
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
  const caseVariantFiles: FrontmatterDeleteCaseVariant[] = [];

  if (destructive && normalizedKey && issues.length == 0) {
    // Notidian-1e93 (mirrors the Notidian-lqt4 rename fix): the per-file scan
    // was exact-string (`hasOwn(frontmatter, normalizedKey)`), so a file whose
    // real key is a case-variant of the deleted column (column "state", file
    // key "State") was silently skipped — the orphaned variant survived the
    // "delete this column" op, and the file was mis-counted as one that never
    // held the key. Match case-insensitively (as the schema-level column check
    // already does), remove EVERY spelling that folds onto this column keyed by
    // its ACTUAL casing, and surface variant-only matches distinctly.
    const lowerKey = normalizedKey.toLowerCase();
    for (const path of paths) {
      const frontmatter = frontmatterForPath(frontmatterByPath, path);
      const matchingKeys = Object.keys(frontmatter).filter(
        (candidate) => candidate.toLowerCase() == lowerKey
      );
      if (matchingKeys.length == 0) continue;

      affectedFiles.push(path);
      frontmatterWrites.push({
        path,
        set: {},
        removeKeys: matchingKeys,
      });

      const variantKeys = matchingKeys.filter((key) => key != normalizedKey);
      if (variantKeys.length > 0) {
        caseVariantFiles.push({
          path,
          requestedKey: normalizedKey,
          foundKeys: variantKeys,
        });
      }
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
    caseVariantFiles,
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
export const toValueList = (raw: unknown): string[] => {
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
