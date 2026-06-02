import { resolveRowDropTargetId, rowDndId } from "./tableRowDragTarget";

describe("tableRowDragTarget", () => {
  it("uses the row dnd over id when dnd-kit reports a row target", () => {
    expect(
      resolveRowDropTargetId({
        activeId: rowDndId("2"),
        overId: rowDndId("5"),
        pointer: { x: 10, y: 20 },
        rowIdAtPoint: () => "7",
      })
    ).toBe("5");
  });

  it("falls back to the row under the pointer when dnd-kit reports no row target", () => {
    expect(
      resolveRowDropTargetId({
        activeId: rowDndId("2"),
        overId: "File",
        pointer: { x: 10, y: 20 },
        rowIdAtPoint: (point) =>
          point.x == 10 && point.y == 20 ? "7" : null,
      })
    ).toBe("7");
  });

  it("does not resolve row targets for column drags", () => {
    expect(
      resolveRowDropTargetId({
        activeId: "File",
        overId: rowDndId("5"),
        pointer: { x: 10, y: 20 },
        rowIdAtPoint: () => "7",
      })
    ).toBeNull();
  });
});
