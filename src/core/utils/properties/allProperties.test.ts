import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { MakeMDSettings } from "shared/types/settings";
import {
  contextHasOnlyDefaultColumns,
  contextHasOnlyDefaultOrFrontmatterColumns,
  discoverFrontmatterPropertiesFromPathStates,
  frontmatterPropertySource,
  materializeFrontmatterBackedContextTable,
  shouldWriteContextPropertyToFrontmatter,
  stripFrontmatterBackedRowValues,
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
      {
        name: "record",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "status",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "sort_order",
        type: "number",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "updated",
        type: "date",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "ups",
        type: "boolean",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
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

describe("materializeFrontmatterBackedContextTable", () => {
  it("marks existing frontmatter columns and appends newly discovered columns", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          status: "active",
          area: "Veg",
        }),
      ],
    ]);

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...(defaultContextFields.rows as any),
          { name: "status", type: "text", value: "", schemaId: "files" },
        ],
        rows: [{ [PathPropertyName]: "a.md", status: "active" }],
      },
      pathsIndex,
      ["a.md"],
      settings,
      true
    );

    expect(result.changed).toBe(true);
    expect(result.table.cols).toEqual([
      ...(defaultContextFields.rows as any),
      {
        name: "status",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "area",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
    ]);
  });

  it("does not convert contexts that contain non-frontmatter user columns", () => {
    const pathsIndex = new Map<string, any>([
      ["a.md", pathState({ status: "active" })],
    ]);

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...(defaultContextFields.rows as any),
          { name: "manual", type: "text", value: "", schemaId: "files" },
        ],
        rows: [{ [PathPropertyName]: "a.md", manual: "local" }],
      },
      pathsIndex,
      ["a.md"],
      settings,
      true
    );

    expect(result.changed).toBe(false);
    expect(result.table.cols.map((col) => col.name)).toEqual([
      "File",
      "Created",
      "manual",
    ]);
  });
});

describe("stripFrontmatterBackedRowValues", () => {
  it("removes projected frontmatter values but keeps file and context-only values", () => {
    const result = stripFrontmatterBackedRowValues({
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: [
        ...(defaultContextFields.rows as any),
        {
          name: "status",
          type: "text",
          value: "",
          schemaId: "files",
          source: frontmatterPropertySource,
        },
        { name: "manual", type: "text", value: "", schemaId: "files" },
      ],
      rows: [
        {
          [PathPropertyName]: "a.md",
          Created: "2026-05-24",
          status: "active",
          manual: "local",
        },
      ],
    });

    expect(result.rows).toEqual([
      {
        [PathPropertyName]: "a.md",
        Created: "2026-05-24",
        manual: "local",
      },
    ]);
  });
});

describe("shouldWriteContextPropertyToFrontmatter", () => {
  it("always writes explicit frontmatter-backed columns", () => {
    expect(
      shouldWriteContextPropertyToFrontmatter(
        {
          name: "status",
          type: "text",
          source: frontmatterPropertySource,
        },
        false
      )
    ).toBe(true);
  });

  it("uses the legacy bulk setting for context-only columns", () => {
    expect(
      shouldWriteContextPropertyToFrontmatter(
        { name: "manual", type: "text" },
        false
      )
    ).toBe(false);
    expect(
      shouldWriteContextPropertyToFrontmatter(
        { name: "manual", type: "text" },
        true
      )
    ).toBe(true);
  });

  it("never writes the file identity column as frontmatter", () => {
    expect(
      shouldWriteContextPropertyToFrontmatter(
        {
          name: PathPropertyName,
          type: "file",
          source: frontmatterPropertySource,
        },
        true
      )
    ).toBe(false);
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

describe("contextHasOnlyDefaultOrFrontmatterColumns", () => {
  it("returns true for contexts already backed by discovered frontmatter properties", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          status: "active",
          area: "Veg",
        }),
      ],
    ]);

    expect(
      contextHasOnlyDefaultOrFrontmatterColumns(
        [
          ...(defaultContextFields.rows as any),
          { name: "status", type: "text", value: "", schemaId: "files" },
        ],
        pathsIndex,
        ["a.md"],
        settings
      )
    ).toBe(true);
  });

  it("returns false when a context has a non-frontmatter user column", () => {
    const pathsIndex = new Map<string, any>([
      ["a.md", pathState({ status: "active" })],
    ]);

    expect(
      contextHasOnlyDefaultOrFrontmatterColumns(
        [
          ...(defaultContextFields.rows as any),
          { name: "manual", type: "text", value: "", schemaId: "files" },
        ],
        pathsIndex,
        ["a.md"],
        settings
      )
    ).toBe(false);
  });
});
