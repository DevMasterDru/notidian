import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { PathPropertyName } from "shared/types/context";
import { CellSelection } from "./tableSelection";
import { planTablePaste } from "./tablePastePlan";

const rows = ["0", "1", "2"];
const columns = [
  { id: PathPropertyName, name: PathPropertyName, type: "file" },
  {
    id: "status",
    name: "status",
    type: "text",
    source: frontmatterPropertySource,
  },
  { id: "manual", name: "manual", type: "text" },
  { id: "Created", name: "Created", type: "fileprop" },
];

const singleStatusSelection: CellSelection = {
  anchor: { rowId: "0", columnId: "status" },
  focus: { rowId: "0", columnId: "status" },
  active: { rowId: "0", columnId: "status" },
};

describe("planTablePaste", () => {
  it("expands a multi-cell clipboard grid from the active cell", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: singleStatusSelection,
      clipboardGrid: [
        ["active", "local"],
        ["paused", "remote"],
      ],
    });

    expect(plan.mode).toBe("property-paste");
    expect(plan.writes).toEqual([
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "active",
        authority: "frontmatter",
      },
      {
        rowId: "0",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "local",
        authority: "notidian",
      },
      {
        rowId: "1",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "paused",
        authority: "frontmatter",
      },
      {
        rowId: "1",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "remote",
        authority: "notidian",
      },
    ]);
    expect(plan.rejections).toEqual([]);
  });

  it("fills a selected range from a one-cell clipboard grid", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: "status" },
        focus: { rowId: "1", columnId: "manual" },
        active: { rowId: "0", columnId: "status" },
      },
      clipboardGrid: [["same"]],
    });

    expect(plan.writes.map((write) => write.value)).toEqual([
      "same",
      "same",
      "same",
      "same",
    ]);
  });

  it("repeats a multi-cell grid across an exact multiple selected range", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: "status" },
        focus: { rowId: "1", columnId: "manual" },
        active: { rowId: "0", columnId: "status" },
      },
      clipboardGrid: [["A", "B"]],
    });

    expect(plan.writes.map((write) => write.value)).toEqual([
      "A",
      "B",
      "A",
      "B",
    ]);
  });

  it("rejects read-only computed cells", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: "Created" },
        focus: { rowId: "0", columnId: "Created" },
        active: { rowId: "0", columnId: "Created" },
      },
      clipboardGrid: [["tomorrow"]],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.rejections).toEqual([
      {
        rowId: "0",
        columnId: "Created",
        value: "tomorrow",
        reason: "read-only",
      },
    ]);
  });

  it("marks file title writes as file authority", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "0", columnId: PathPropertyName },
        focus: { rowId: "0", columnId: PathPropertyName },
        active: { rowId: "0", columnId: PathPropertyName },
      },
      clipboardGrid: [["New Name"]],
    });

    expect(plan.mode).toBe("bulk-rename");
    expect(plan.writes).toEqual([
      {
        rowId: "0",
        columnId: PathPropertyName,
        columnName: PathPropertyName,
        table: "",
        value: "New Name",
        authority: "file",
      },
    ]);
  });

  it("reports truncated cells outside the visible table", () => {
    const plan = planTablePaste({
      rowOrder: rows,
      columns,
      selection: {
        anchor: { rowId: "2", columnId: "manual" },
        focus: { rowId: "2", columnId: "manual" },
        active: { rowId: "2", columnId: "manual" },
      },
      clipboardGrid: [
        ["kept", "truncated"],
        ["truncated", "truncated"],
      ],
    });

    expect(plan.writes).toEqual([
      {
        rowId: "2",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "kept",
        authority: "notidian",
      },
    ]);
    expect(plan.rejections).toEqual([
      {
        rowId: "2",
        columnId: "Created",
        value: "truncated",
        reason: "read-only",
      },
      {
        rowId: "",
        columnId: "manual",
        value: "truncated",
        reason: "out-of-bounds",
      },
      {
        rowId: "",
        columnId: "Created",
        value: "truncated",
        reason: "out-of-bounds",
      },
    ]);
  });
});
