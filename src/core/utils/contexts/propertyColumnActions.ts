import type { SpaceTable, SpaceTableColumn } from "shared/types/mdb";
import type { Predicate } from "shared/types/predicate";
import { isFrontmatterBackedProperty } from "../properties/allProperties";
import { tableColumnId } from "./tableFreeze";

export type PropertyColumnDeletePlan =
  | { action: "hide"; table: SpaceTable }
  | { action: "delete"; table: SpaceTable };

export const canDeletePropertyColumn = (
  column?: Partial<Pick<SpaceTableColumn, "source">>
): boolean => !isFrontmatterBackedProperty(column);

export const planPropertyColumnDelete = (
  table: SpaceTable,
  column?: SpaceTableColumn
): PropertyColumnDeletePlan => {
  if (!column || !canDeletePropertyColumn(column)) {
    return { action: "hide", table };
  }

  return {
    action: "delete",
    table: {
      ...table,
      cols: table.cols.filter((field) => field.name != column.name),
      rows: table.rows.map((row) => {
        const { [column.name]: _value, ...rest } = row;
        return rest;
      }),
    },
  };
};

const remapFieldReferences = <T extends { field: string }>(
  items: T[] | undefined,
  oldColumnId: string,
  nextColumnId: string
): T[] =>
  (items ?? []).map((item) =>
    item.field == oldColumnId ? { ...item, field: nextColumnId } : item
  );

const remapColumnIds = (
  items: string[] | undefined,
  oldColumnId: string,
  nextColumnId: string
): string[] =>
  (items ?? []).map((item) =>
    item == oldColumnId ? nextColumnId : item
  );

const remapColumnRecord = <T>(
  record: Record<string, T> | undefined,
  oldColumnId: string,
  nextColumnId: string
): Record<string, T> => {
  const nextRecord = { ...(record ?? {}) };
  if (Object.prototype.hasOwnProperty.call(nextRecord, oldColumnId)) {
    nextRecord[nextColumnId] = nextRecord[oldColumnId];
    delete nextRecord[oldColumnId];
  }
  return nextRecord;
};

const removeColumnRecordEntry = <T>(
  record: Record<string, T> | undefined,
  columnId: string
): Record<string, T> => {
  const nextRecord = { ...(record ?? {}) };
  delete nextRecord[columnId];
  return nextRecord;
};

export const predicateColumnReferenceUpdateForSavedColumn = ({
  predicate,
  oldColumn,
  column,
}: {
  predicate?: Partial<Predicate> | null;
  oldColumn?: SpaceTableColumn;
  column: SpaceTableColumn;
}): Partial<Predicate> | null => {
  if (!oldColumn) return null;

  const oldColumnId = tableColumnId(oldColumn);
  const nextColumnId = tableColumnId(column);
  if (oldColumnId == nextColumnId) return null;

  return {
    filters: remapFieldReferences(
      predicate?.filters,
      oldColumnId,
      nextColumnId
    ),
    sort: remapFieldReferences(predicate?.sort, oldColumnId, nextColumnId),
    groupBy: remapColumnIds(predicate?.groupBy, oldColumnId, nextColumnId),
    colsHidden: remapColumnIds(
      predicate?.colsHidden,
      oldColumnId,
      nextColumnId
    ),
    colsOrder: remapColumnIds(predicate?.colsOrder, oldColumnId, nextColumnId),
    colsSize: remapColumnRecord(
      predicate?.colsSize,
      oldColumnId,
      nextColumnId
    ),
    colsCalc: remapColumnRecord(
      predicate?.colsCalc,
      oldColumnId,
      nextColumnId
    ),
    colsHeaderDisplay: remapColumnRecord(
      predicate?.colsHeaderDisplay,
      oldColumnId,
      nextColumnId
    ),
  };
};

export const predicateColumnReferenceDeleteForColumn = ({
  predicate,
  column,
}: {
  predicate?: Partial<Predicate> | null;
  column: SpaceTableColumn;
}): Partial<Predicate> => {
  const columnId = tableColumnId(column);
  const colsHidden = [
    ...(predicate?.colsHidden ?? []).filter((item) => item != columnId),
    columnId,
  ];

  return {
    filters: (predicate?.filters ?? []).filter(
      (filter) => filter.field != columnId
    ),
    sort: (predicate?.sort ?? []).filter((sort) => sort.field != columnId),
    groupBy: (predicate?.groupBy ?? []).filter((item) => item != columnId),
    colsHidden,
    colsOrder: (predicate?.colsOrder ?? []).filter(
      (item) => item != columnId
    ),
    colsSize: removeColumnRecordEntry(predicate?.colsSize, columnId),
    colsCalc: removeColumnRecordEntry(predicate?.colsCalc, columnId),
    colsHeaderDisplay: removeColumnRecordEntry(
      predicate?.colsHeaderDisplay,
      columnId
    ),
  };
};
