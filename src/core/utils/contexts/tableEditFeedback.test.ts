import {
  feedbackForTableEditResult,
  pendingFeedbackForWrites,
  summaryForTableEditResult,
  tableCellFeedbackKey,
} from "./tableEditFeedback";

describe("tableEditFeedback", () => {
  it("creates stable keys from row and column ids", () => {
    expect(tableCellFeedbackKey("3", "status")).toBe("3::status");
  });

  it("marks planned writes as pending", () => {
    expect(
      pendingFeedbackForWrites([
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
          authority: "frontmatter",
        },
      ])
    ).toEqual({
      "0::status": { state: "pending" },
    });
  });

  it("maps failed and skipped transaction issues to cell feedback", () => {
    expect(
      feedbackForTableEditResult({
        ok: false,
        applied: 1,
        skipped: [
          {
            reason: "missing-context-table",
            write: {
              rowId: "1",
              columnName: "phase",
              table: "projects",
              value: "build",
            },
          },
        ],
        failed: [
          {
            reason: "frontmatter-write-failed",
            write: {
              rowId: "0",
              columnId: "status",
              columnName: "status",
              table: "",
              value: "active",
            },
          },
        ],
      })
    ).toEqual({
      "0::status": {
        state: "failed",
        reason: "frontmatter-write-failed",
      },
      "1::phaseprojects": {
        state: "skipped",
        reason: "missing-context-table",
      },
    });
  });

  it("summarizes failed and skipped edit results", () => {
    expect(
      summaryForTableEditResult({
        ok: false,
        applied: 4,
        skipped: [
          {
            reason: "missing-row",
            write: {
              rowId: "4",
              columnName: "status",
              table: "",
              value: "active",
            },
          },
        ],
        failed: [
          {
            reason: "frontmatter-write-failed",
            write: {
              rowId: "0",
              columnName: "status",
              table: "",
              value: "active",
            },
          },
          {
            reason: "frontmatter-write-failed",
            write: {
              rowId: "1",
              columnName: "status",
              table: "",
              value: "paused",
            },
          },
        ],
      })
    ).toBe("2 table edits failed and 1 was skipped.");
  });

  it("does not summarize fully accepted edits", () => {
    expect(
      summaryForTableEditResult({
        ok: true,
        applied: 2,
        skipped: [],
        failed: [],
      })
    ).toBeNull();
  });
});
