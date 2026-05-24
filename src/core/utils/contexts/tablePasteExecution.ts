import { DBRow } from "shared/types/mdb";
import { TablePasteWrite } from "./tablePastePlan";

export const resolveTableEditPath = (
  explicitPath: string | null | undefined,
  rowPath: string | undefined
): string | undefined =>
  explicitPath && explicitPath.trim().length > 0 ? explicitPath : rowPath;

export const applyTableWritesToRows = (
  rows: DBRow[],
  writes: TablePasteWrite[]
): DBRow[] =>
  rows.map((row, index) => {
    const rowWrites = writes.filter(
      (write) =>
        write.table == "" &&
        write.authority != "file" &&
        parseInt(write.rowId) == index
    );
    if (rowWrites.length == 0) return row;

    return rowWrites.reduce(
      (nextRow, write) => ({
        ...nextRow,
        [write.columnName]: write.value,
      }),
      row
    );
  });
