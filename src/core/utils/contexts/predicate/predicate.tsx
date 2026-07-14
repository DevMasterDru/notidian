import { defaultContextSchemaID } from "shared/schemas/context";
import { SpaceTableSchema } from "shared/types/mdb";
import { Filter, Predicate, Sort } from "shared/types/predicate";
import { defaultPredicate } from "../../../../shared/schemas/predicate";
import { columnDataAnchorModeForValue } from "../propertyDataAnchor";
import { columnWrapModeForValue } from "../propertyColumnWrap";
import { propertyHeaderDisplayModeForValue } from "../propertyHeaderDisplayMode";
import { FilterFunctionType } from "./filter";
import { filterFnTypes } from "./filterFns/filterFnTypes";
import { SortFunctionType, sortFnTypes } from "./sort";

export const defaultPredicateFnForType = (
  type: string,
  types: FilterFunctionType | SortFunctionType
) => {
  const fnType = Object.keys(types).find(
    (f) =>
      !(types[f] as { scopedFields?: string[] }).scopedFields?.length &&
      types[f].type.find((g) => g == type)
  );
  return fnType;
};

export const allPredicateFns = (
  types: FilterFunctionType | SortFunctionType
) => {
  return Object.keys(types).filter(
    (f) => !(types[f] as { scopedFields?: string[] }).scopedFields?.length
  );
};

export const predicateFnsForType = (
  type: string,
  types: FilterFunctionType | SortFunctionType
) => {
  const fnTypes = Object.keys(types).filter(
    (f) =>
      !(types[f] as { scopedFields?: string[] }).scopedFields?.length &&
      types[f].type.find((g) => g == type)
  );
  return fnTypes;
};

// Validate-loud companion to the dispatcher's fail-open contract (ADR 0034,
// "C-lite"). `cleanPredicateType` strips any filter/sort whose `fn` is not a
// known operator (the write/load-time primary guard that keeps unknown fns from
// ever reaching the fail-open `filterReturnForCol` dispatcher). Previously it
// dropped them SILENTLY, so a corrupt/forward-version predicate would lose a
// constraint with no signal. We now surface the dropped operator(s) ONCE here —
// at validation time, off the per-row render hot path — instead of either
// silently dropping them or warning per-row (the latter would spam thousands of
// identical logs and cost work on the hot path; ADR 0034 Option C is ruled out
// for the per-row pass for exactly that reason). The return value is unchanged:
// this only adds an observable, deduplicated dev-console warning; it does not
// alter which filters/sorts survive validation, so visibility is untouched.
export const cleanPredicateType = (
  type: Sort[] | Filter[],
  definedTypes: FilterFunctionType | SortFunctionType
) => {
  const knownFns = Object.keys(definedTypes);
  const kept = type.filter((f) => knownFns.some((g) => g == f.fn));
  if (kept.length !== type.length) {
    // Name the unrecognized operators that were dropped, de-duplicated, once.
    const droppedFns = Array.from(
      new Set(
        type
          .filter((f) => !knownFns.some((g) => g == f.fn))
          .map((f) => (f.fn == null ? "(missing)" : String(f.fn)))
      )
    );
    console.warn(
      `[Notidian] validatePredicate dropped ${
        droppedFns.length
      } unrecognized predicate operator(s): ${droppedFns.join(
        ", "
      )}. The filter/sort is ignored (no-op) rather than applied. ` +
        `If a constraint disappeared, this is why. (ADR 0034)`
    );
  }
  return kept;
};

// A plain object (not an array, not null, not a boxed primitive) is the only
// shape the Record<string, *> predicate fields (colsSize/colsCalc/listViewProps…)
// are allowed to take. A corrupt or forward-version predicate can parse one of
// them as an array/string/number; consumers then spread (`...predicate.colsSize`)
// or `Object.entries(...)` it and produce garbage column state. Reject anything
// that is not a plain record so the field falls back to its default {}.
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Validate a Record<string, *> predicate field: keep only entries whose VALUE
// passes the element guard (mirrors the colsHeaderDisplay/colsDataAnchor reduce),
// and coerce a non-record container to {} entirely. Never mutates blindly.
const validateRecordField = <V,>(
  value: unknown,
  isValidValue: (v: unknown) => v is V
): Record<string, V> => {
  if (!isPlainRecord(value)) return {};
  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (!isValidValue(entryValue)) return result;
    result[key] = entryValue;
    return result;
  }, {} as Record<string, V>);
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === "string";

// A string-scalar predicate field (view/listView/listItem/listGroup) is a frame
// id or view kind that consumers compare or pass to `initiateString`; a
// non-string corrupt value must fall back to the schema default, never flow on.
const validateStringScalar = (value: unknown, fallback: string): string =>
  isString(value) ? value : fallback;

// colsOrder/colsHidden/groupBy hold column-id keys; keep only string elements so
// a stray non-string can never be used as (or against) a record key downstream.
const validateStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(isString) : [];

// Grouped-table state is keyed by the grouped column id, then holds option/group
// values in user-selected order. It is optional view state: omit an absent or
// wholly-invalid record so legacy predicates remain byte-identical. Empty keys,
// blank values, duplicates, and non-string entries are never useful selectors,
// so drop them while preserving the user's first declared order.
const validateGroupedIslandRecord = (
  value: unknown
): Record<string, string[]> | undefined => {
  if (!isPlainRecord(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [columnId, rawValues] of Object.entries(value)) {
    if (columnId.length == 0 || !Array.isArray(rawValues)) continue;
    const values = rawValues.reduce((out, rawValue) => {
      if (
        typeof rawValue === "string" &&
        rawValue.length > 0 &&
        !out.includes(rawValue)
      ) {
        out.push(rawValue);
      }
      return out;
    }, [] as string[]);
    if (values.length > 0) result[columnId] = values;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const SUB_ITEMS_DISPLAYS = ["nested", "flattened", "parents-only"];
const SUB_ITEMS_FILTER_SCOPES = ["parents", "parentsAndSubItems", "subItems"];

// Sub-items config (ADR 0050). Field-invalid => the WHOLE subItems drops to
// undefined (the inert state the adversarial corpus pins). When the field is
// valid, rebuild explicitly and DROP each default value (display "nested",
// filterScope "parentsAndSubItems", empty collapsed) so a legacy `{ field }`
// predicate round-trips byte-identically and stays diff-free.
//
// AUTO-HEAL off-primary (bd Notidian-sas8): when a real schema id is supplied
// and it is NOT the primary files schema, DROP the whole subItems config. A
// child's parent link only materializes into its row on the primary files
// schema (filesystemAdapter syncContextRow runs solely for schema ==
// defaultContextSchemaID), so an off-primary subItems.field is an ORPHANED
// config that can never round-trip into a tree — a state reachable only via the
// pre-Notidian-8k9b ungated designate path. The Notidian-8k9b consumption gate
// (resolveSubItemsCol) already keeps that orphan inert at render/write time, but
// the FilterBar "Sub-items → None" clear option is now hidden off-primary
// (gated to the primary schema since 65d32aa), leaving the stale field
// UNCLEARABLE from the menu. Dropping it here lets validation self-heal the
// orphan on the next predicate save/load — no column delete, no manual edit.
//
// This does NOT weaken ADR 0050's byte-identical round-trip contract: that
// contract is about dropping DEFAULT-valued optional keys on a legitimate
// config; an off-primary field is not a legitimate state at all. When no schema
// id is supplied (pure validation / legacy callers) behaviour is unchanged.
const validateSubItems = (
  raw: unknown,
  schemaId?: string | null
): import("shared/types/predicate").SubItemsPredicate | undefined => {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as any).field !== "string"
  )
    return undefined;
  // Off the primary files schema the orphaned config can never round-trip into a
  // tree — heal it away. Only acts when a real schema id is provided, so the
  // default (undefined) path stays byte-identical for every existing caller.
  if (schemaId != null && schemaId !== defaultContextSchemaID) return undefined;
  const value = raw as any;
  const out: import("shared/types/predicate").SubItemsPredicate = {
    field: value.field,
  };
  if (
    SUB_ITEMS_DISPLAYS.includes(value.display) &&
    value.display !== "nested"
  )
    out.display = value.display;
  if (
    SUB_ITEMS_FILTER_SCOPES.includes(value.filterScope) &&
    value.filterScope !== "parentsAndSubItems"
  )
    out.filterScope = value.filterScope;
  if (Array.isArray(value.collapsed)) {
    const collapsed = value.collapsed.filter(
      (p: unknown) => typeof p === "string" && p.length > 0
    );
    if (collapsed.length > 0) out.collapsed = collapsed;
  }
  return out;
};

export const validatePredicate = (
  prevPredicate: Predicate,
  defaultPredicate: Predicate,
  // Optional owning-schema id (bd Notidian-sas8). When supplied and non-primary,
  // an orphaned off-primary subItems config is auto-healed (dropped). Omitting it
  // preserves byte-identical behaviour for pure/legacy callers.
  schemaId?: string | null
): Predicate => {
  if (!prevPredicate) {
    return defaultPredicate;
  }
  const colsHeaderDisplay = Object.entries(
    prevPredicate.colsHeaderDisplay ?? {}
  ).reduce((result, [columnId, mode]) => {
    const displayMode = propertyHeaderDisplayModeForValue(mode);
    if (displayMode != mode) return result;
    return {
      ...result,
      [columnId]: displayMode,
    };
  }, {} as Predicate["colsHeaderDisplay"]);
  const colsDataAnchor = Object.entries(
    prevPredicate.colsDataAnchor ?? {}
  ).reduce((result, [columnId, mode]) => {
    const dataAnchorMode = columnDataAnchorModeForValue(mode);
    if (dataAnchorMode == "auto" || dataAnchorMode != mode) return result;
    return {
      ...result,
      [columnId]: dataAnchorMode,
    };
  }, {} as Predicate["colsDataAnchor"]);
  // Carry per-column wrap modes through validation, dropping the default
  // ("clip") so only opted-in "wrap" columns persist.
  const colsWrap = Object.entries(prevPredicate.colsWrap ?? {}).reduce(
    (result, [columnId, mode]) => {
      const wrapMode = columnWrapModeForValue(mode);
      if (wrapMode == "clip" || wrapMode != mode) return result;
      return {
        ...result,
        [columnId]: wrapMode,
      };
    },
    {} as NonNullable<Predicate["colsWrap"]>
  );
  const tableDirection =
    prevPredicate.tableDirection == "rtl"
      ? "rtl"
      : defaultPredicate.tableDirection;

  return {
    ...defaultPredicate,
    view: validateStringScalar(prevPredicate.view, defaultPredicate.view),
    listItem: validateStringScalar(
      prevPredicate.listItem,
      defaultPredicate.listItem
    ),
    listGroup: validateStringScalar(
      prevPredicate.listGroup,
      defaultPredicate.listGroup
    ),
    listView: validateStringScalar(
      prevPredicate.listView,
      defaultPredicate.listView
    ),
    listViewProps: isPlainRecord(prevPredicate.listViewProps)
      ? prevPredicate.listViewProps
      : defaultPredicate.listViewProps,
    listItemProps: isPlainRecord(prevPredicate.listItemProps)
      ? prevPredicate.listItemProps
      : defaultPredicate.listItemProps,
    listGroupProps: isPlainRecord(prevPredicate.listGroupProps)
      ? prevPredicate.listGroupProps
      : defaultPredicate.listGroupProps,
    filters: Array.isArray(prevPredicate.filters)
      ? (cleanPredicateType(prevPredicate.filters, filterFnTypes) as Filter[])
      : [],
    sort: Array.isArray(prevPredicate.sort)
      ? cleanPredicateType(prevPredicate.sort, sortFnTypes)
      : [],
    groupBy: validateStringArray(prevPredicate.groupBy),
    groupOrder: validateGroupedIslandRecord(prevPredicate.groupOrder),
    collapsedGroups: validateGroupedIslandRecord(prevPredicate.collapsedGroups),
    colsOrder: validateStringArray(prevPredicate.colsOrder),
    colsHidden: validateStringArray(prevPredicate.colsHidden),
    colsSize: validateRecordField(prevPredicate.colsSize, isFiniteNumber),
    colsCalc: validateRecordField(prevPredicate.colsCalc, isString),
    colsHeaderDisplay,
    colsDataAnchor,
    colsWrap,
    tableDirection,
    frozenColumnCount:
      typeof prevPredicate.frozenColumnCount === "number" &&
      prevPredicate.frozenColumnCount >= 0
        ? Math.floor(prevPredicate.frozenColumnCount)
        : defaultPredicate.frozenColumnCount,
    limit:
      typeof prevPredicate.limit === "number" && prevPredicate.limit >= 0
        ? prevPredicate.limit
        : 0,
    // Optional view configs must be carried through validation or every
    // savePredicate strips them (Notidian-4j7 chart never persisted before this;
    // Notidian-pv4 sub-items rides the same path).
    chart:
      prevPredicate.chart && typeof prevPredicate.chart === "object"
        ? prevPredicate.chart
        : undefined,
    subItems: validateSubItems(prevPredicate.subItems, schemaId),
  };
};

export const defaultPredicateForSchema = (schema: SpaceTableSchema) => {
  return schema?.primary == "true"
    ? defaultPredicate
    : {
        ...defaultPredicate,
        view: "table",
        limit: 0,
      };
};
