import { defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { MakeMDSettings } from "shared/types/settings";
import {
  contextHasOnlyDefaultColumns,
  contextHasOnlyDefaultOrFrontmatterColumns,
  discoverFrontmatterPropertiesFromPathStates,
  filterPropertiesForNameQuery,
  frontmatterPropertySource,
  materializeFrontmatterBackedContextTable,
  propertyMenuDiscoveryScope,
  shouldImportFrontmatterColumns,
  shouldWriteContextPropertyToFrontmatter,
  stripFrontmatterBackedRowValues,
} from "./allProperties";
import { notidianPropertySource } from "./propertyAuthority";

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

  it("collapses case-variant frontmatter keys to ONE column, first-observed casing wins (Notidian-1q8y)", () => {
    // SQLite treats column identifiers case-insensitively: discovering BOTH
    // "Status" and "status" as columns makes the emitted CREATE TABLE throw
    // `duplicate column name`, after which every save of the folder's context
    // silently fails. Discovery must dedupe case-insensitively.
    const pathsIndex = new Map<string, any>([
      ["a.md", pathState({ Status: "Open" })],
      ["b.md", pathState({ status: "Done" })],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["a.md", "b.md"],
      settings,
      [],
      defaultContextSchemaID
    );

    expect(result).toEqual([
      {
        name: "Status",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
    ]);
  });

  it("treats an existing column as covering case-variant frontmatter keys (Notidian-1q8y)", () => {
    // A persisted "Status" column already owns the SQLite identifier — a file
    // carrying "status" must NOT re-discover it as a second column.
    const pathsIndex = new Map<string, any>([
      ["b.md", pathState({ status: "Done" })],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["b.md"],
      settings,
      [{ name: "Status", type: "text" } as any],
      defaultContextSchemaID
    );

    expect(result).toEqual([]);
  });

  it("discovers title as a first-class suggestion with its inferred type", () => {
    const pathsIndex = new Map<string, any>([
      [
        "Beads Portfolio/Notidian-9pn.md",
        pathState({
          title: "Views: display properties (ADR 0016)",
          repo: "Notidian",
          status: "open",
        }),
      ],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["Beads Portfolio/Notidian-9pn.md"],
      settings,
      [],
      defaultContextSchemaID
    );

    expect(result).toEqual([
      {
        name: "title",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
      {
        name: "repo",
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
    ]);
  });

  it("stops suggesting keys that are already table columns", () => {
    const pathsIndex = new Map<string, any>([
      [
        "Beads Portfolio/Notidian-9pn.md",
        pathState({
          title: "Views: display properties (ADR 0016)",
          repo: "Notidian",
        }),
      ],
    ]);

    const result = discoverFrontmatterPropertiesFromPathStates(
      pathsIndex,
      ["Beads Portfolio/Notidian-9pn.md"],
      settings,
      [{ name: "title", type: "text" } as any],
      defaultContextSchemaID
    );

    expect(result.map((property) => property.name)).toEqual(["repo"]);
  });
});

describe("propertyMenuDiscoveryScope", () => {
  it("uses the context path when the source is the current context", () => {
    expect(propertyMenuDiscoveryScope("", "Beads Portfolio")).toBe(
      "Beads Portfolio"
    );
  });

  it("uses the selected space when an explicit source is chosen", () => {
    expect(propertyMenuDiscoveryScope("Relays & Devices", "Beads Portfolio")).toBe(
      "Relays & Devices"
    );
  });

  it("has no scope for $fm because a single file has no row set to discover from", () => {
    expect(propertyMenuDiscoveryScope("$fm", "Beads Portfolio")).toBeUndefined();
  });

  it("has no scope without a context path", () => {
    expect(propertyMenuDiscoveryScope("", undefined)).toBeUndefined();
  });
});

describe("filterPropertiesForNameQuery", () => {
  const discovered = [
    { name: "title" },
    { name: "repo" },
    { name: "status" },
  ];

  it("returns every suggestion for an empty query", () => {
    expect(filterPropertiesForNameQuery(discovered, "")).toEqual(discovered);
  });

  it("filters suggestions case-insensitively as the user types", () => {
    expect(filterPropertiesForNameQuery(discovered, "TIT")).toEqual([
      { name: "title" },
    ]);
    expect(filterPropertiesForNameQuery(discovered, "missing")).toEqual([]);
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

  it("updates legacy frontmatter column types from observed frontmatter values", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          sort_order: 2,
          ups: true,
        }),
      ],
    ]);

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...(defaultContextFields.rows as any),
          { name: "sort_order", type: "text", value: "", schemaId: "files" },
          { name: "ups", type: "text", value: "", schemaId: "files" },
        ],
        rows: [{ [PathPropertyName]: "a.md", sort_order: "2", ups: "true" }],
      },
      pathsIndex,
      ["a.md"],
      settings,
      true
    );

    expect(result.table.cols.slice(2)).toEqual([
      expect.objectContaining({
        name: "sort_order",
        type: "number",
        source: frontmatterPropertySource,
      }),
      expect.objectContaining({
        name: "ups",
        type: "boolean",
        source: frontmatterPropertySource,
      }),
    ]);
  });

  it("preserves explicit frontmatter-backed column types chosen by the user", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          status: "active",
        }),
      ],
    ]);

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: [
          ...(defaultContextFields.rows as any),
          {
            name: "status",
            type: "option",
            value: "",
            schemaId: "files",
            source: frontmatterPropertySource,
          },
        ],
        rows: [{ [PathPropertyName]: "a.md" }],
      },
      pathsIndex,
      ["a.md"],
      settings,
      true
    );

    expect(result.table.cols.find((col) => col.name === "status")).toEqual(
      expect.objectContaining({
        name: "status",
        type: "option",
        source: frontmatterPropertySource,
      })
    );
    expect(result.changed).toBe(false);
  });

  it("uses text when observed frontmatter values for one property have conflicting types", () => {
    const pathsIndex = new Map<string, any>([
      ["a.md", pathState({ voltage: 24 })],
      ["b.md", pathState({ voltage: "24V" })],
    ]);

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: defaultContextFields.rows as any,
        rows: [{ [PathPropertyName]: "a.md" }, { [PathPropertyName]: "b.md" }],
      },
      pathsIndex,
      ["a.md", "b.md"],
      settings,
      true
    );

    expect(result.table.cols.find((col) => col.name === "voltage")).toEqual(
      expect.objectContaining({
        type: "text",
        source: frontmatterPropertySource,
      })
    );
  });

  it("never re-types a computed column whose name collides with an observed frontmatter key", () => {
    const pathsIndex = new Map<string, any>([
      [
        "a.md",
        pathState({
          Status: "active",
          area: "Veg",
        }),
      ],
    ]);

    const computedCol = {
      name: "Status",
      type: "fileprop",
      value: "",
      schemaId: "files",
    };
    const sourceCols = [...(defaultContextFields.rows as any), computedCol];

    const result = materializeFrontmatterBackedContextTable(
      {
        schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
        cols: sourceCols,
        rows: [{ [PathPropertyName]: "a.md" }],
      },
      pathsIndex,
      ["a.md"],
      settings,
      true
    );

    const materializedStatus = result.table.cols.find(
      (col) => col.name === "Status"
    );
    // The computed column must be returned by IDENTITY — its type was NOT
    // overwritten and no source:"frontmatter" marker was stamped, so the
    // derived-value-skip classification survives (Notidian-0jq).
    expect(materializedStatus).toBe(computedCol);
    expect(materializedStatus).toEqual({
      name: "Status",
      type: "fileprop",
      value: "",
      schemaId: "files",
    });
    expect(materializedStatus).not.toHaveProperty(
      "source",
      frontmatterPropertySource
    );

    // Genuinely-new frontmatter keys are still discovered alongside it.
    const discoveredArea = result.table.cols.find((col) => col.name === "area");
    expect(discoveredArea).toEqual(
      expect.objectContaining({
        name: "area",
        type: "text",
        source: frontmatterPropertySource,
      })
    );
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
  it("removes projected and computed values but keeps file and context-only values", () => {
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
        {
          name: "manual",
          type: "text",
          value: "",
          schemaId: "files",
          source: notidianPropertySource,
        },
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
        }
      )
    ).toBe(true);
  });

  it("keeps explicitly Notidian-owned columns out of frontmatter", () => {
    expect(
      shouldWriteContextPropertyToFrontmatter(
        { name: "manual", type: "text", source: notidianPropertySource }
      )
    ).toBe(false);
  });

  it("never writes the file identity column as frontmatter", () => {
    expect(
      shouldWriteContextPropertyToFrontmatter(
        {
          name: PathPropertyName,
          type: "file",
          source: frontmatterPropertySource,
        }
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

describe("shouldImportFrontmatterColumns", () => {
  const defaultCols = defaultContextFields.rows as any;

  it("imports for a primary context with only default columns and discovered keys", () => {
    expect(shouldImportFrontmatterColumns({ primary: "true" }, defaultCols, 3)).toBe(
      true
    );
  });

  it("treats an empty persisted column list as a fresh context", () => {
    expect(shouldImportFrontmatterColumns({ primary: "true" }, [], 1)).toBe(true);
  });

  it("never imports for non-primary or missing schemas", () => {
    expect(shouldImportFrontmatterColumns({ primary: "" }, defaultCols, 3)).toBe(
      false
    );
    expect(shouldImportFrontmatterColumns({}, defaultCols, 3)).toBe(false);
    expect(shouldImportFrontmatterColumns(null, defaultCols, 3)).toBe(false);
    expect(shouldImportFrontmatterColumns(undefined, defaultCols, 3)).toBe(false);
  });

  it("never imports when discovery found nothing", () => {
    expect(shouldImportFrontmatterColumns({ primary: "true" }, defaultCols, 0)).toBe(
      false
    );
  });

  it("stays closed after the import persists discovered columns (loop safety)", () => {
    const persistedAfterImport = [
      ...defaultCols,
      {
        name: "status",
        type: "text",
        value: "",
        schemaId: "files",
        source: frontmatterPropertySource,
      },
    ];

    // Discovery excludes persisted columns, so it reports zero after the import.
    expect(
      shouldImportFrontmatterColumns({ primary: "true" }, persistedAfterImport, 0)
    ).toBe(false);
    // Even a stale discovery count cannot reopen the gate once a
    // non-default column is persisted.
    expect(
      shouldImportFrontmatterColumns({ primary: "true" }, persistedAfterImport, 3)
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
