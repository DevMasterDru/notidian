import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";
import { frontmatterPropertySource } from "../properties/allProperties";
import {
  canDeletePropertyColumn,
  planPropertyColumnDelete,
  predicateColumnReferenceDeleteForColumn,
  predicateColumnReferenceUpdateForSavedColumn,
} from "./propertyColumnActions";

const table = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [
    { name: PathPropertyName, type: "file", schemaId: defaultContextSchemaID },
    {
      name: "status",
      type: "option",
      schemaId: defaultContextSchemaID,
      source: frontmatterPropertySource,
      value: JSON.stringify({
        options: [{ name: "active", value: "active" }],
      }),
    },
    {
      name: "manual",
      type: "text",
      schemaId: defaultContextSchemaID,
      value: "",
    },
  ],
  rows: [
    {
      [PathPropertyName]: "Relays & Devices/A.md",
      status: "active",
      manual: "local",
    },
  ],
});

describe("property column actions", () => {
  it("treats frontmatter-backed delete as hide-only", () => {
    const source = table();
    const column = source.cols.find((col) => col.name == "status");

    expect(canDeletePropertyColumn(column)).toBe(false);
    expect(planPropertyColumnDelete(source, column)).toEqual({
      action: "hide",
      table: source,
    });
  });

  it("deletes Notidian-owned columns from schema and context rows", () => {
    const source = table();
    const column = source.cols.find((col) => col.name == "manual");

    expect(canDeletePropertyColumn(column)).toBe(true);
    expect(planPropertyColumnDelete(source, column)).toEqual({
      action: "delete",
      table: {
        ...source,
        cols: source.cols.filter((col) => col.name != "manual"),
        rows: [
          {
            [PathPropertyName]: "Relays & Devices/A.md",
            status: "active",
          },
        ],
      },
    });
  });

  it("does not remap predicate references when a saved column keeps the same id", () => {
    const predicate = {
      filters: [{ field: "sensor_id", fn: "is", value: "a", fType: "text" }],
      sort: [{ field: "sensor_id", fn: "asc" }],
      groupBy: ["sensor_id"],
      colsHidden: ["sensor_id"],
      colsOrder: ["sensor_id"],
      colsSize: { sensor_id: 34 },
      colsCalc: { sensor_id: "count" },
      colsHeaderDisplay: { sensor_id: "icon" },
    } as Partial<Predicate> as Predicate;

    expect(
      predicateColumnReferenceUpdateForSavedColumn({
        predicate,
        oldColumn: { name: "sensor_id", table: "", type: "text" },
        column: {
          name: "sensor_id",
          table: "",
          type: "text",
          attrs: JSON.stringify({ icon: "😀" }),
        },
      })
    ).toBeNull();
  });

  it("remaps predicate references when a saved column id changes", () => {
    const predicate = {
      filters: [{ field: "sensor_id", fn: "is", value: "a", fType: "text" }],
      sort: [{ field: "sensor_id", fn: "asc" }],
      groupBy: ["sensor_id"],
      colsHidden: ["sensor_id"],
      colsOrder: ["sensor_id"],
      colsSize: { sensor_id: 34, status: 120 },
      colsCalc: { sensor_id: "count" },
      colsHeaderDisplay: { sensor_id: "icon", status: "text" },
    } as Partial<Predicate> as Predicate;

    expect(
      predicateColumnReferenceUpdateForSavedColumn({
        predicate,
        oldColumn: { name: "sensor_id", table: "", type: "text" },
        column: { name: "sensor", table: "", type: "text" },
      })
    ).toEqual({
      filters: [{ field: "sensor", fn: "is", value: "a", fType: "text" }],
      sort: [{ field: "sensor", fn: "asc" }],
      groupBy: ["sensor"],
      colsHidden: ["sensor"],
      colsOrder: ["sensor"],
      colsSize: { status: 120, sensor: 34 },
      colsCalc: { sensor: "count" },
      colsHeaderDisplay: { status: "text", sensor: "icon" },
    });
  });

  it("removes active predicate references when a column is destructively deleted", () => {
    const predicate = {
      filters: [
        { field: "status", fn: "is", value: "active", fType: "option" },
        { field: "manual", fn: "is", value: "local", fType: "text" },
      ],
      sort: [
        { field: "status", fn: "asc" },
        { field: "manual", fn: "desc" },
      ],
      groupBy: ["status", "manual"],
      colsHidden: ["manual"],
      colsOrder: ["status", "manual"],
      colsSize: { status: 120, manual: 80 },
      colsCalc: { status: "count", manual: "count" },
      colsHeaderDisplay: { status: "icon", manual: "text" },
    } as Partial<Predicate> as Predicate;

    expect(
      predicateColumnReferenceDeleteForColumn({
        predicate,
        column: { name: "status", table: "", type: "option" },
      })
    ).toEqual({
      filters: [{ field: "manual", fn: "is", value: "local", fType: "text" }],
      sort: [{ field: "manual", fn: "desc" }],
      groupBy: ["manual"],
      colsHidden: ["manual", "status"],
      colsOrder: ["manual"],
      colsSize: { manual: 80 },
      colsCalc: { manual: "count" },
      colsHeaderDisplay: { manual: "text" },
    });
  });
});
