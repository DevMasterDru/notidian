/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for ADR 0029 D2 (Notidian-f0pj.2): the rollup cell's
// passive partial/unresolved marker.
//
// WHY THIS TEST EXISTS
// --------------------
// The engine's resolved/relation counts are unit/property tested in
// tableRollup.test.ts. This test pins the CELL's rendering contract on top of
// those counts: the ".mk-cell-rollup-partial" marker appears EXACTLY when
// `fn != "count" && resolvedCount < relationCount`, never alters the displayed
// number, and is text/CSS only (no innerHTML). We mock the runtime so the cell's
// conditional is exercised in isolation from link resolution.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core / TableView are heavy barrels; RollupCell pulls only erased TYPES
// from them, so empty stubs are faithful (mirrors ColorCell.anchor.dom.test).
jest.mock("makemd-core", () => ({}));
jest.mock("../TableView/TableView", () => ({}));

// Control the resolved/relation counts the cell renders from.
const detailed = { value: "", relationCount: 0, resolvedCount: 0 };
jest.mock("core/utils/contexts/tableRollupRuntime", () => ({
  computeRowRollupDetailed: () => detailed,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RollupCell } = require("./RollupCell");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderCell = (
  fn: string,
  counts: { value: string; relationCount: number; resolvedCount: number }
): { container: HTMLElement; root: Root } => {
  detailed.value = counts.value;
  detailed.relationCount = counts.relationCount;
  detailed.resolvedCount = counts.resolvedCount;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props: any = {
    superstate: {},
    propertyValue: JSON.stringify({ ref: "rel", field: "v", fn }),
    row: { File: "Some/Row.md", rel: "[[A]], [[B]], [[C]]" },
    source: "Some/Space",
    contextPath: "Some/Space",
    columns: [],
    initialValue: "",
    saveValue: () => {},
    setEditMode: () => {},
  };
  act(() => {
    root.render(<RollupCell {...props} />);
  });
  return { container, root };
};

describe("RollupCell partial marker (ADR 0029 D2)", () => {
  it("shows the marker when fn != count and resolvedCount < relationCount", () => {
    const { container, root } = renderCell("sum", {
      value: "8",
      relationCount: 3,
      resolvedCount: 2,
    });
    const cell = container.querySelector(".mk-cell-rollup") as HTMLElement;
    const marker = container.querySelector(
      ".mk-cell-rollup-partial"
    ) as HTMLElement;
    expect(cell).toBeTruthy();
    // Displayed number is unchanged (the value "8" is still present).
    expect(cell.textContent).toContain("8");
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe("·2/3");
    expect(marker.getAttribute("title")).toBe(
      "2 of 3 counted — 1 unresolved/non-numeric"
    );
    // Text/CSS only — no innerHTML sink injected by the marker.
    expect(marker.querySelector("svg")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("never shows the marker for fn == count, even when resolvedCount < relationCount", () => {
    const { container, root } = renderCell("count", {
      value: "3",
      relationCount: 3,
      resolvedCount: 1,
    });
    expect(container.querySelector(".mk-cell-rollup-partial")).toBeNull();
    expect(
      (container.querySelector(".mk-cell-rollup") as HTMLElement).textContent
    ).toBe("3");
    act(() => root.unmount());
    container.remove();
  });

  it("does not show the marker when every link resolved (resolvedCount == relationCount)", () => {
    const { container, root } = renderCell("sum", {
      value: "8",
      relationCount: 2,
      resolvedCount: 2,
    });
    expect(container.querySelector(".mk-cell-rollup-partial")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});

describe("RollupCell progress bar (Notidian-5ond.7)", () => {
  it("renders a bar + 'NN%' for a percent rollup, CSS-only (no SVG/innerHTML)", () => {
    const { container, root } = renderCell("percent_checked", {
      value: "60",
      relationCount: 5,
      resolvedCount: 5,
    });
    const cell = container.querySelector(".mk-cell-rollup-progress") as HTMLElement;
    expect(cell).toBeTruthy();
    const fill = container.querySelector(".mk-rollup-bar-fill") as HTMLElement;
    expect(fill.style.width).toBe("60%");
    expect(
      (container.querySelector(".mk-rollup-bar-label") as HTMLElement).textContent
    ).toBe("60%");
    const bar = container.querySelector(".mk-rollup-bar") as HTMLElement;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    expect(cell.querySelector("svg")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("clamps out-of-range values and falls back to plain render when empty", () => {
    const over = renderCell("percent", { value: "150", relationCount: 1, resolvedCount: 1 });
    expect(
      (over.container.querySelector(".mk-rollup-bar-fill") as HTMLElement).style.width
    ).toBe("100%");
    act(() => over.root.unmount());
    over.container.remove();

    // Empty value (nothing resolved) -> no bar, plain empty rollup cell.
    const empty = renderCell("percent", { value: "", relationCount: 0, resolvedCount: 0 });
    expect(empty.container.querySelector(".mk-rollup-bar")).toBeNull();
    expect(empty.container.querySelector(".mk-cell-rollup")).toBeTruthy();
    act(() => empty.root.unmount());
    empty.container.remove();
  });

  it("shows the partial marker alongside the bar when links are unresolved", () => {
    const { container, root } = renderCell("percent_checked", {
      value: "100",
      relationCount: 3,
      resolvedCount: 2,
    });
    expect(container.querySelector(".mk-rollup-bar")).toBeTruthy();
    expect(
      (container.querySelector(".mk-cell-rollup-partial") as HTMLElement).textContent
    ).toBe("·2/3");
    act(() => root.unmount());
    container.remove();
  });
});
