import { PathPropertyName } from "shared/types/context";
import { planGroupedRowCreate } from "./groupedRowCreate";

const deviceRegistryColumns = [
  { name: PathPropertyName, type: "fileprop", table: "" },
  { name: "device", type: "text", table: "" },
  { name: "connected", type: "boolean", table: "" },
  { name: "sort_order", type: "number", table: "" },
  { name: "voltage", type: "text", table: "" },
  { name: "address", type: "number", table: "" },
  { name: "ups", type: "boolean", table: "" },
  { name: "board", type: "text", table: "" },
  { name: "board_id", type: "text", table: "" },
  { name: "board_address", type: "text", table: "" },
  { name: "scope", type: "text", table: "" },
  { name: "registry_status", type: "option", table: "" },
] as any[];

describe("planGroupedRowCreate", () => {
  it("inherits the group and continues Device Registry channel fields", () => {
    const rows = [
      {
        _index: "0",
        [PathPropertyName]: "Gidi/Hardware/Device Registry/b07-ch01-phec-monitor.md",
        device: "🥦 PHEC Monitor",
        connected: false,
        sort_order: 1,
        voltage: "5V",
        address: 1,
        ups: true,
        board: "{7} 🌎 5V + 10V (DC+) EMR 8CH",
        board_id: "b07",
        board_address: "b07:1",
        scope: "wash",
        registry_status: "active",
      },
      {
        _index: "1",
        [PathPropertyName]: "Gidi/Hardware/Device Registry/b07-ch02-phec-monitor.md",
        device: "🌸 PHEC Monitor",
        connected: false,
        sort_order: 2,
        voltage: "5V",
        address: 2,
        ups: true,
        board: "{7} 🌎 5V + 10V (DC+) EMR 8CH",
        board_id: "b07",
        board_address: "b07:2",
        scope: "veg",
        registry_status: "active",
      },
      {
        _index: "2",
        [PathPropertyName]: "Gidi/Hardware/Device Registry/b07-ch03-phec-monitor.md",
        device: "🧽 PHEC Monitor",
        connected: false,
        sort_order: 3,
        voltage: "5V",
        address: 3,
        ups: true,
        board: "{7} 🌎 5V + 10V (DC+) EMR 8CH",
        board_id: "b07",
        board_address: "b07:3",
        scope: "bloom",
        registry_status: "active",
      },
    ] as any[];

    expect(
      planGroupedRowCreate({
        rows,
        columns: deviceRegistryColumns,
        groupColumnId: "board",
        groupValue: "{7} 🌎 5V + 10V (DC+) EMR 8CH",
      })
    ).toEqual({
      name: "b07-ch04-phec-monitor",
      values: {
        board: "{7} 🌎 5V + 10V (DC+) EMR 8CH",
        connected: "false",
        sort_order: "4",
        voltage: "5V",
        address: "4",
        ups: "true",
        board_id: "b07",
        board_address: "b07:4",
        registry_status: "active",
      },
    });
  });

  it("does not inherit conflicting free-text values from sibling rows", () => {
    const plan = planGroupedRowCreate({
      rows: [
        { _index: "0", [PathPropertyName]: "A 1.md", Status: "Open", Owner: "A" },
        { _index: "1", [PathPropertyName]: "A 2.md", Status: "Open", Owner: "B" },
      ],
      columns: [
        { name: PathPropertyName, type: "fileprop", table: "" },
        { name: "Status", type: "text", table: "" },
        { name: "Owner", type: "text", table: "" },
      ] as any[],
      groupColumnId: "Status",
      groupValue: "Open",
    });

    expect(plan.values).toEqual({ Status: "Open" });
    expect(plan.name).toBe("A 3");
  });
});
