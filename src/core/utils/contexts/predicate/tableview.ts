import { FilterFn, SortingFn } from "@tanstack/react-table";
import { parseFlexValue } from "core/schemas/parseFieldValue";
import { SpaceTableColumn } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";
import { filterFnTypes } from "./filterFns/filterFnTypes";
import { flexSortKey, SortFunction, sortFnTypes } from "./sort";

// FLEX-CELL PARITY (Notidian-xy0s). These @tanstack/react-table adapters are the
// PARALLEL integration path to the live render path's filterReturnForCol /
// sortReturnForCol (filter.ts:242, sort.ts:355). The live path UNWRAPS a flex
// cell before it reaches a comparator/predicate; this adapter historically fed
// `row.getValue(columnId)` — the RAW stored flex string (a JSON wrapper like
// '{"value":5,"type":"number"}' or a non-string) — straight through. That is the
// SAME flex-throw / wrong-sort class Notidian-av6s (sort) and Notidian-9i9i
// (filter) fixed on the live path: at best a semantically wrong sort by the JSON
// wrapper text, at worst a comparator TypeError that, because Array.prototype.sort
// has no try/catch around its comparator, aborts the WHOLE sort pass. We mirror
// the live unwrap here so the bug cannot resurface if a view routes through the
// adapter.

// SORT side (mirrors sortReturnForCol, sort.ts:368-373): the count-family
// (multi:true — count/optionMultiCount, which measure parseMultiString(...).length)
// wants the RAW multi-string; every other family wants the SCALAR flexSortKey so
// stringSort/numSort never receive an array (or a raw JSON wrapper / non-string)
// and throw. Non-flex columns pass the cell through unchanged.
const sortCellForCol = (
  cell: any,
  col?: SpaceTableColumn,
  multi?: boolean
): any => {
  if (col?.type != "flex") return cell;
  return multi ? cell : flexSortKey(cell);
};

// FILTER side (mirrors filterReturnForCol, filter.ts:242): the live path extracts
// parseFlexValue(cell)?.value for EVERY flex filter family (the text matchers'
// asText guard and the list family's parseMultiString both tolerate the unwrapped
// value), so we do the same here. A non-flex column passes the cell through.
const filterCellForCol = (cell: any, col?: SpaceTableColumn): any =>
  col?.type == "flex" ? parseFlexValue(cell)?.value : cell;

export const tableViewFilterFn = (
    filterFn: (cellValue: any, filterValue: any) => boolean,
    col?: SpaceTableColumn
  ): FilterFn<any> => {
    return (row, columnId, filterValue, addmeta) => {
      return filterFn(filterCellForCol(row.getValue(columnId), col), filterValue);
    };
  };

  export const filterFnForCol = (
    predicate: Predicate,
    col: SpaceTableColumn
  ): FilterFn<any> => {
    const { filters } = predicate;
    const filterField = filters.find((f) => f.field == col.name + col.table);
    if (!filterField) {
      return () => true;
    }
    const filterType = filterFnTypes[filterField.fn];
    if (filterType) {
      return tableViewFilterFn(filterType.fn, col);
    }
    return () => true;
  };

  export const tableViewSortFn = (
    sortFn: SortFunction,
    col?: SpaceTableColumn,
    multi?: boolean
  ): SortingFn<any> => {
    return (row, row2, columnId) => {
      return sortFn(
        sortCellForCol(row.getValue(columnId), col, multi),
        sortCellForCol(row2.getValue(columnId), col, multi),
        col
      );
    };
  };

  export const sortFnForCol = (
    predicate: Predicate,
    col: SpaceTableColumn
  ): SortingFn<any> => {
    const { sort } = predicate;
    const sortField = sort.find((f) => f.field == col.name + col.table);
    if (!sortField || !sortField.fn) {
      return null;
    }
    const sortType = sortFnTypes[sortField.fn];
    if (sortType) {
      return tableViewSortFn(sortType.fn, col, sortType.multi);
    }
    return null;
  };
