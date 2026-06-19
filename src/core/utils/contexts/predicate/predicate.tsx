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
    view: prevPredicate.view,
    listItem: prevPredicate.listItem,
    listGroup: prevPredicate.listGroup,
    listView: prevPredicate.listView,
    listViewProps: prevPredicate.listViewProps,
    listItemProps: prevPredicate.listItemProps,
    listGroupProps: prevPredicate.listGroupProps,
    filters: Array.isArray(prevPredicate.filters)
      ? (cleanPredicateType(prevPredicate.filters, filterFnTypes) as Filter[])
      : [],
    sort: Array.isArray(prevPredicate.sort)
      ? cleanPredicateType(prevPredicate.sort, sortFnTypes)
      : [],
    groupBy: Array.isArray(prevPredicate.groupBy) ? prevPredicate.groupBy : [],
    colsOrder: Array.isArray(prevPredicate.colsOrder)
      ? prevPredicate.colsOrder
      : [],
    colsHidden: Array.isArray(prevPredicate.colsHidden)
      ? prevPredicate.colsHidden
      : [],
    colsSize: prevPredicate.colsSize ?? {},
    colsCalc: prevPredicate.colsCalc ?? {},
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
    subItems:
      prevPredicate.subItems &&
      typeof prevPredicate.subItems === "object" &&
      typeof prevPredicate.subItems.field === "string"
        ? prevPredicate.subItems
        : undefined,
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
