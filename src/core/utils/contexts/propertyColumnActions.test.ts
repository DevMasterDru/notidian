import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { frontmatterPropertySource } from "../properties/allProperties";
import {
  canDeletePropertyColumn,
  planPropertyColumnDelete,
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
});
