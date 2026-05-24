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
  "rowId" | "columnName" | "table" | "value" | "path" | "fieldValue"
> & {
  columnId?: string;
  [key: string]: unknown;
};

export type TableCellResetTokens = Record<string, number>;

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

export const feedbackWriteForDirectCellEdit = (
  write: TableEditFeedbackWrite
): TableEditFeedbackWrite => ({
  ...write,
  columnId: write.columnId ?? write.columnName + write.table,
});

const reasonTextForTableEditIssue = (reason: string): string => {
  if (reason == "frontmatter-conflict") {
    return "Frontmatter changed outside Notidian. Reload before editing.";
  }
  return reason;
};

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
        reason: reasonTextForTableEditIssue(issue.reason),
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
        reason: reasonTextForTableEditIssue(issue.reason),
      },
    }),
    skipped
  );
};

export const incrementResetTokensForFeedback = (
  resetTokens: TableCellResetTokens,
  feedback: TableEditFeedback
): TableCellResetTokens =>
  Object.entries(feedback).reduce<TableCellResetTokens>(
    (tokens, [key, cellFeedback]) => {
      if (cellFeedback.state == "pending") return tokens;
      return {
        ...tokens,
        [key]: (tokens[key] ?? 0) + 1,
      };
    },
    resetTokens
  );

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
