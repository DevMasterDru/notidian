import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { MakeMDSettings } from "shared/types/settings";
import {
  contextHasOnlyDefaultColumns,
  discoverFrontmatterPropertiesFromPathStates,
} from "./allProperties";

const settings = {
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const pathState = (property: Record<string, unknown>) =>
  ({
    metadata: { property },
  } as any);

describe("discoverFrontmatterPropertiesFromPathStates", () => {
  it("returns frontmatter properties as context columns in first-seen order", () => {
    const pathsIndex = new Map<string, any>([
      [
        "Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md",
        pathState({
          record: "entity",
          status: "active",
          sort_order: 2,
          updated: "2026-03-27",
          ups: true,
        }),
      ],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["Relays & Devices/Veg - Mix Pump - B3 - Ch 2.md"],
      settings,
      [],
      defaultContextSchemaID
    );

    expect(result).toEqual([
      { name: "record", type: "text", value: "", schemaId: "files" },
      { name: "status", type: "text", value: "", schemaId: "files" },
      { name: "sort_order", type: "number", value: "", schemaId: "files" },
      { name: "updated", type: "date", value: "", schemaId: "files" },
      { name: "ups", type: "boolean", value: "", schemaId: "files" },
    ]);
  });

  it("excludes make metadata, aliases, tags, and existing columns", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          status: "active",
          aliases: ["Pump"],
          tags: ["hardware"],
          sticker: "emoji//1f331",
          banner: "cover.png",
        }),
      ],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["a.md"],
      settings,
      [{ name: "status", type: "text" } as any],
      defaultContextSchemaID
    );

    expect(result).toEqual([]);
  });
});

describe("contextHasOnlyDefaultColumns", () => {
  it("returns true for empty or default-only context columns", () => {
    expect(contextHasOnlyDefaultColumns([])).toBe(true);
    expect(contextHasOnlyDefaultColumns(defaultContextFields.rows as any)).toBe(
      true
    );
  });

  it("returns false once a user property column exists", () => {
    expect(
      contextHasOnlyDefaultColumns([
        ...(defaultContextFields.rows as any),
        { name: "status", type: "text", value: "", schemaId: "files" },
      ])
    ).toBe(false);
  });
});
