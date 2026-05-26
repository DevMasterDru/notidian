import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import {
  notidianTableToBaseDocument,
  serializeBaseDocumentToYaml,
} from "./notidianBaseAdapter";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";

const table = (): SpaceTable => ({
  schema: {
    id: "files",
    name: "Relays & Devices",
    type: "db",
  },
  cols: [
    {
      name: PathPropertyName,
      schemaId: "files",
      type: "file",
      primary: "true",
    },
    {
      name: "Created",
      schemaId: "files",
      type: "fileprop",
      value: "File.ctime",
      attrs: JSON.stringify({ alias: "Created" }),
    },
    {
      name: "status",
      schemaId: "files",
      type: "option",
      source: frontmatterPropertySource,
      attrs: JSON.stringify({ alias: "Status" }),
    },
    {
      name: "voltage",
      schemaId: "files",
      type: "number",
      source: frontmatterPropertySource,
    },
    {
      name: "scratch",
      schemaId: "files",
      type: "text",
    },
    {
      name: "rollup",
      schemaId: "files",
      type: "aggregate",
    },
  ],
  rows: [],
});

const predicate = (): Predicate => ({
  view: "table",
  listView: "",
  listItem: "",
  listGroup: "",
  listViewProps: {},
  listItemProps: {},
  listGroupProps: {},
  filters: [
    {
      field: "status",
      fn: "is",
      value: "active",
      fType: "value",
    },
  ],
  sort: [
    {
      field: "voltage",
      fn: "reverseNumber",
    },
  ],
  groupBy: ["status"],
  colsOrder: [
    "status",
    PathPropertyName,
    "Created",
    "voltage",
    "scratch",
    "rollup",
  ],
  colsHidden: ["Created"],
  colsSize: {},
  colsCalc: {
    voltage: "Average",
  },
  limit: 25,
});

describe("notidianTableToBaseDocument", () => {
  it("exports a simple folder table to a Bases-compatible document", () => {
    const result = notidianTableToBaseDocument(table(), {
      folder: "Relays & Devices",
      predicate: predicate(),
      viewName: "Devices",
    });

    expect(result.document).toEqual({
      filters: {
        and: ['file.inFolder("Relays & Devices")'],
      },
      properties: {
        status: {
          displayName: "Status",
        },
        "file.name": {
          displayName: "File",
        },
      },
      views: [
        {
          type: "table",
          name: "Devices",
          limit: 25,
          groupBy: {
            property: "status",
            direction: "ASC",
          },
          filters: {
            and: ['status == "active"'],
          },
          order: ["status", "file.name", "voltage"],
          summaries: {
            voltage: "Average",
          },
        },
      ],
    });
    expect(result.unsupported).toEqual([
      {
        column: "scratch",
        reason:
          "Notidian-owned column has no Bases representation unless it is migrated to frontmatter or kept as explicit Notidian state.",
      },
      {
        column: "rollup",
        reason: "Computed column has no durable Bases property mapping in this adapter.",
      },
      {
        column: "voltage",
        reason:
          "Sort function reverseNumber has no stable Bases syntax mapping in this adapter.",
      },
    ]);
  });

  it("reports unsupported filters and omits them from the base view", () => {
    const basePredicate = predicate();
    basePredicate.filters = [
      {
        field: "status",
        fn: "include",
        value: "active",
        fType: "value",
      },
    ];

    const result = notidianTableToBaseDocument(table(), {
      predicate: basePredicate,
    });

    expect(result.document.views[0].filters).toBeUndefined();
    expect(result.unsupported).toContainEqual({
      column: "status",
      reason:
        "Filter function include has no stable Bases syntax mapping in this adapter.",
    });
  });
});

describe("serializeBaseDocumentToYaml", () => {
  it("serializes the exported document as deterministic .base YAML", () => {
    const result = notidianTableToBaseDocument(table(), {
      folder: "Relays & Devices",
      predicate: predicate(),
      viewName: "Devices",
    });

    expect(serializeBaseDocumentToYaml(result.document)).toBe(
      [
        "filters:",
        "  and:",
        '    - "file.inFolder(\\"Relays & Devices\\")"',
        "properties:",
        "  status:",
        '    displayName: "Status"',
        "  file.name:",
        '    displayName: "File"',
        "views:",
        "  - type: \"table\"",
        '    name: "Devices"',
        "    limit: 25",
        "    groupBy:",
        '      property: "status"',
        '      direction: "ASC"',
        "    filters:",
        "      and:",
        '        - "status == \\"active\\""',
        "    order:",
        '      - "status"',
        '      - "file.name"',
        '      - "voltage"',
        "    summaries:",
        '      voltage: "Average"',
        "",
      ].join("\n")
    );
  });
});
