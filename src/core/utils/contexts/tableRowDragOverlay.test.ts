import { PathPropertyName } from "shared/types/context";
import {
  rowDragOverlayColumns,
  rowDragOverlayLabel,
} from "./tableRowDragOverlay";

describe("tableRowDragOverlay", () => {
  it("uses only the file/name column when building the row drag overlay", () => {
    const columns = [
      { name: PathPropertyName, table: "", type: "file" },
      { name: "Created", table: "", type: "date" },
      { name: "status", table: "", type: "option" },
    ] as any;

    expect(rowDragOverlayColumns(columns).map((column) => column.name)).toEqual([
      PathPropertyName,
    ]);
  });

  it("renders the file/name column as the page title instead of the full path", () => {
    expect(
      rowDragOverlayLabel(
        { [PathPropertyName]: "Relays & Devices/Bloom Pump.md" },
        { name: PathPropertyName, table: "", type: "file" } as any
      )
    ).toBe("Bloom Pump");
  });
});
