import { DBRow } from "shared/types/mdb";
import { TablePasteWrite } from "./tablePastePlan";
export { resolveTableEditPath } from "./tableEditTransaction";

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
