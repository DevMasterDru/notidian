import { TableCellWrite, TableEditTransactionResult } from "./tableEditTransaction";

export type TableEditFeedbackState = "pending" | "failed" | "skipped";

export type TableEditFeedback = Record<
  string,
  {
    state: TableEditFeedbackState;
    reason?: string;
  }
>;

export type TableEditFeedbackWrite = Pick<
  TableCellWrite,
  "rowId" | "columnName" | "table"
> & {
  columnId?: string;
  [key: string]: unknown;
};

export const tableCellFeedbackKey = (
  rowId: string,
  columnId: string
): string => `${rowId}::${columnId}`;

export const columnIdForFeedbackWrite = (
  write: TableEditFeedbackWrite
): string => write.columnId ?? write.columnName + write.table;

export const pendingFeedbackForWrites = (
  writes: TableEditFeedbackWrite[]
): TableEditFeedback =>
  writes.reduce<TableEditFeedback>(
    (feedback, write) => ({
      ...feedback,
      [tableCellFeedbackKey(write.rowId, columnIdForFeedbackWrite(write))]: {
        state: "pending",
      },
    }),
    {}
  );

export const feedbackForTableEditResult = (
  result: TableEditTransactionResult
): TableEditFeedback => {
  const skipped = result.skipped.reduce<TableEditFeedback>(
    (feedback, issue) => ({
      ...feedback,
      [tableCellFeedbackKey(
        issue.write.rowId,
        columnIdForFeedbackWrite(issue.write)
      )]: {
        state: "skipped",
        reason: issue.reason,
      },
    }),
    {}
  );

  return result.failed.reduce<TableEditFeedback>(
    (feedback, issue) => ({
      ...feedback,
      [tableCellFeedbackKey(
        issue.write.rowId,
        columnIdForFeedbackWrite(issue.write)
      )]: {
        state: "failed",
        reason: issue.reason,
      },
    }),
    skipped
  );
};

const editCountText = (
  count: number,
  singular: string,
  plural: string
): string => `${count} ${count == 1 ? singular : plural}`;

export const summaryForTableEditResult = (
  result: TableEditTransactionResult
): string | null => {
  const failed = result.failed.length;
  const skipped = result.skipped.length;
  if (failed == 0 && skipped == 0) return null;

  if (failed > 0 && skipped > 0) {
    return `${editCountText(
      failed,
      "table edit failed",
      "table edits failed"
    )} and ${skipped} ${skipped == 1 ? "was" : "were"} skipped.`;
  }

  if (failed > 0) {
    return `${editCountText(
      failed,
      "table edit failed",
      "table edits failed"
    )}.`;
  }

  return `${editCountText(
    skipped,
    "table edit was skipped",
    "table edits were skipped"
  )}.`;
};
