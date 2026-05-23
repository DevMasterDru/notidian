import { parseContextTableToCache } from "./cacheParsers";
import { defaultContextDBSchema } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { IndexMap } from "shared/types/indexMap";
import { MakeMDSettings } from "shared/types/settings";

const settings = {
  autoImportObsidianPropertiesToContexts: true,
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const space = {
  name: "Relays & Devices",
  path: "Relays & Devices",
  isRemote: false,
  readOnly: false,
  defPath: "Relays & Devices/.space/def.json",
  notePath: "Relays & Devices/Relays & Devices.md",
};

describe("parseContextTableToCache property materialization", () => {
  it("adds discovered frontmatter properties when folder context has only default columns", () => {
    const result = parseContextTableToCache(
      space,
      {
        files: {
          schema: defaultContextDBSchema,
          cols: defaultContextFields.rows as any,
          rows: [{ File: "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md" }],
        },
      },
      ["Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md"],
      true,
      new Map<string, any>([
        ["Relays & Devices", { path: "Relays & Devices", type: "space" }],
        [
          "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
          {
            path: "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
            metadata: {
              property: {
                status: "active",
                area: "Veg",
                address: 2,
                ups: true,
              },
            },
          },
        ],
      ]),
      new IndexMap(),
      null as any,
      settings,
      new Map(),
      { calculate: false }
    );

    expect(result.changed).toBe(true);
    expect(result.cache.contextTable.cols.map((col) => col.name)).toEqual([
      "File",
      "Created",
      "status",
      "area",
      "address",
      "ups",
    ]);
    expect(result.cache.contextTable.rows[0]).toMatchObject({
      File: "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
      status: "active",
      area: "Veg",
      address: "2",
      ups: "true",
    });
  });

  it("does not add discovered properties when context already has a user column", () => {
    const result = parseContextTableToCache(
      space,
      {
        files: {
          schema: defaultContextDBSchema,
          cols: [
            ...(defaultContextFields.rows as any),
            { name: "manual", type: "text", value: "", schemaId: "files" },
          ],
          rows: [{ File: "a.md" }],
        },
      },
      ["a.md"],
      true,
      new Map<string, any>([
        ["Relays & Devices", { path: "Relays & Devices", type: "space" }],
        [
          "a.md",
          {
            path: "a.md",
            metadata: { property: { status: "active" } },
          },
        ],
      ]),
      new IndexMap(),
      null as any,
      settings,
      new Map(),
      { calculate: false }
    );

    expect(result.cache.contextTable.cols.map((col) => col.name)).toEqual([
      "File",
      "Created",
      "manual",
    ]);
  });

  it("keeps adding new frontmatter properties to property-backed contexts", () => {
    const result = parseContextTableToCache(
      space,
      {
        files: {
          schema: defaultContextDBSchema,
          cols: [
            ...(defaultContextFields.rows as any),
            { name: "status", type: "text", value: "", schemaId: "files" },
          ],
          rows: [{ File: "a.md", status: "active" }],
        },
      },
      ["a.md"],
      true,
      new Map<string, any>([
        ["Relays & Devices", { path: "Relays & Devices", type: "space" }],
        [
          "a.md",
          {
            path: "a.md",
            metadata: {
              property: {
                status: "active",
                area: "Veg",
              },
            },
          },
        ],
      ]),
      new IndexMap(),
      null as any,
      settings,
      new Map(),
      { calculate: false }
    );

    expect(result.cache.contextTable.cols.map((col) => col.name)).toEqual([
      "File",
      "Created",
      "status",
      "area",
    ]);
    expect(result.cache.contextTable.rows[0]).toMatchObject({
      File: "a.md",
      status: "active",
      area: "Veg",
    });
  });
});
