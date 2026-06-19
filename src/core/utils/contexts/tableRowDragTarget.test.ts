import {
  resolveDragOverId,
  resolveRowDropTargetId,
  rowDndId,
} from "./tableRowDragTarget";

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

describe("resolveDragOverId", () => {
  it("drops a row droppable when a column drag is over a body row", () => {
    expect(
      resolveDragOverId({
        overId: rowDndId("5"),
        activeDragType: "column",
      })
    ).toBeNull();
  });

  it("drops a row droppable when no drag type is active", () => {
    expect(
      resolveDragOverId({
        overId: rowDndId("5"),
        activeDragType: null,
      })
    ).toBeNull();
  });

  it("passes a row droppable through when a row drag is over a body row", () => {
    expect(
      resolveDragOverId({
        overId: rowDndId("5"),
        activeDragType: "row",
      })
    ).toBe(rowDndId("5"));
  });

  it("passes a column-header droppable through during a column drag", () => {
    expect(
      resolveDragOverId({
        overId: "Status" + "spaceTable",
        activeDragType: "column",
      })
    ).toBe("StatusspaceTable");
  });

  it("passes a null over through unchanged for any drag type", () => {
    expect(
      resolveDragOverId({ overId: null, activeDragType: "column" })
    ).toBeNull();
    expect(
      resolveDragOverId({ overId: null, activeDragType: "row" })
    ).toBeNull();
  });
});
