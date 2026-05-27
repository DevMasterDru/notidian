import type { SpaceTable, SpaceTableColumn } from "shared/types/mdb";
import { isFrontmatterBackedProperty } from "../properties/allProperties";

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
