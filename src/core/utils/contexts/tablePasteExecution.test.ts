import { PathPropertyName } from "shared/types/context";
import { TablePasteWrite } from "./tablePastePlan";
import {
  applyTableWritesToRows,
  resolveTableEditPath,
} from "./tablePasteExecution";

describe("tablePasteExecution", () => {
  it("uses the row file path when a pasted write has no explicit path", () => {
    expect(resolveTableEditPath(undefined, "Relays & Devices/A.md")).toBe(
      "Relays & Devices/A.md"
    );
    expect(resolveTableEditPath("", "Relays & Devices/A.md")).toBe(
      "Relays & Devices/A.md"
    );
  });

  it("keeps an explicit non-empty path", () => {
    expect(
      resolveTableEditPath(
        "Relays & Devices/Explicit.md",
        "Relays & Devices/A.md"
      )
    ).toBe("Relays & Devices/Explicit.md");
  });

  it("applies multiple pasted table writes to the same row snapshot", () => {
    const writes: TablePasteWrite[] = [
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "active",
        authority: "frontmatter",
      },
      {
        rowId: "1",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "paused",
        authority: "frontmatter",
      },
    ];

    expect(
      applyTableWritesToRows(
        [
          { [PathPropertyName]: "Relays & Devices/A.md", status: "old" },
          { [PathPropertyName]: "Relays & Devices/B.md", status: "old" },
        ],
        writes
      )
    ).toEqual([
      { [PathPropertyName]: "Relays & Devices/A.md", status: "active" },
      { [PathPropertyName]: "Relays & Devices/B.md", status: "paused" },
    ]);
  });
});
