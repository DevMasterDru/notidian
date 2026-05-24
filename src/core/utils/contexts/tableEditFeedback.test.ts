import {
  feedbackForTableEditResult,
  feedbackWriteForDirectCellEdit,
  incrementResetTokensForFeedback,
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

  it("creates feedback writes for direct cell edits using the table accessor key", () => {
    expect(
      feedbackWriteForDirectCellEdit({
        rowId: "2",
        columnName: "status",
        table: "devices",
        value: "active",
        path: "Relays & Devices/Relay A.md",
        fieldValue: "active|Active",
      })
    ).toEqual({
      rowId: "2",
      columnId: "statusdevices",
      columnName: "status",
      table: "devices",
      value: "active",
      path: "Relays & Devices/Relay A.md",
      fieldValue: "active|Active",
    });
  });

  it("increments reset tokens only for failed and skipped cell feedback", () => {
    expect(
      incrementResetTokensForFeedback(
        {
          "2::statusdevices": 1,
          "8::owner": 4,
        },
        {
          "2::statusdevices": {
            state: "failed",
            reason: "frontmatter-write-failed",
          },
          "3::phase": { state: "pending" },
          "4::priority": {
            state: "skipped",
            reason: "missing-context-row",
          },
        }
      )
    ).toEqual({
      "2::statusdevices": 2,
      "8::owner": 4,
      "4::priority": 1,
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

  it("uses a readable reason for frontmatter conflict feedback", () => {
    expect(
      feedbackForTableEditResult({
        ok: true,
        applied: 0,
        skipped: [
          {
            reason: "frontmatter-conflict",
            write: {
              rowId: "0",
              columnId: "status",
              columnName: "status",
              table: "",
              value: "active",
            },
          },
        ],
        failed: [],
      })
    ).toEqual({
      "0::status": {
        state: "skipped",
        reason: "Frontmatter changed outside Notidian. Reload before editing.",
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
