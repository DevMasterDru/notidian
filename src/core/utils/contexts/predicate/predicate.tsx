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
  const fnType = Object.keys(types).find((f) =>
    types[f].type.find((g) => g == type)
  );
  return fnType;
};

export const allPredicateFns = (
  types: FilterFunctionType | SortFunctionType
) => {
  return Object.keys(types);
};

export const predicateFnsForType = (
  type: string,
  types: FilterFunctionType | SortFunctionType
) => {
  const fnTypes = Object.keys(types).filter((f) =>
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

const SUB_ITEMS_DISPLAYS = ["nested", "flattened", "parents-only"];
const SUB_ITEMS_FILTER_SCOPES = ["parents", "parentsAndSubItems", "subItems"];

// Sub-items config (ADR 0050). Field-invalid => the WHOLE subItems drops to
// undefined (the inert state the adversarial corpus pins). When the field is
// valid, rebuild explicitly and DROP each default value (display "nested",
// filterScope "parentsAndSubItems", empty collapsed) so a legacy `{ field }`
// predicate round-trips byte-identically and stays diff-free.
const validateSubItems = (
  raw: unknown
): import("shared/types/predicate").SubItemsPredicate | undefined => {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as any).field !== "string"
  )
    return undefined;
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
  defaultPredicate: Predicate
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
    subItems: validateSubItems(prevPredicate.subItems),
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
