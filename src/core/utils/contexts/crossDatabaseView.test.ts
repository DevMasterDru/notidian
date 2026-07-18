import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  assembleCrossDatabaseView,
  CrossDatabaseLoadedSource,
  crossDatabasePropertySource,
  filterCrossDatabaseLoadedSource,
  isCrossDatabaseViewReadOnly,
  normalizeCrossDatabaseSources,
  persistCrossDatabaseSources,
} from "./crossDatabaseView";

const table = (
  context: string,
  rows: SpaceTable["rows"],
  columns: Array<{ name: string; type: string; source?: string }>
): CrossDatabaseLoadedSource => ({
  source: { context, db: "files", label: context, fields: {} },
  table: {
    schema: { id: "files", name: "Items", type: "db", primary: "true" },
    cols: [
      {
        name: PathPropertyName,
        type: "fileprop",
        schemaId: "files",
        primary: "true",
      },
      ...columns.map((column) => ({ ...column, schemaId: "files" })),
    ],
    rows,
  } as SpaceTable,
});

describe("cross-database saved-view projection", () => {
  it("marks only active cross-database projections read-only", () => {
    expect(isCrossDatabaseViewReadOnly(true)).toBe(true);
    expect(isCrossDatabaseViewReadOnly(false)).toBe(false);
  });
  it("normalizes valid sources and drops malformed or duplicate definitions", () => {
    expect(
      normalizeCrossDatabaseSources([
        {
          context: " Routines ",
          db: " files ",
          label: " Routines ",
          fields: { priority: " priority ", status: "" },
        },
        { context: "", db: "files", fields: {} },
        { context: "Routines", db: "files", fields: { state: "state" } },
        { context: "Events", db: "", fields: { date: "start" } },
      ])
    ).toEqual([
      {
        context: "Routines",
        db: "files",
        label: "Routines",
        fields: { priority: "priority" },
      },
      {
        context: "Events",
        db: "files",
        label: "Events",
        fields: { date: "start" },
      },
    ]);
  });

  it("normalizes native source filters without rewriting legacy definitions or mutating input", () => {
    const legacy = {
      context: "Routines",
      db: "files",
      label: "Routines",
      fields: { priority: "priority_num" },
    };
    const filtered = {
      context: "Memos",
      db: "files",
      label: "Memos",
      fields: { priority: "priority" },
      filters: [
        { field: " status ", fn: " is ", value: "active", fType: " text " },
      ],
    };
    const input = [legacy, filtered];

    expect(normalizeCrossDatabaseSources(input)).toEqual([
      legacy,
      {
        ...filtered,
        filters: [
          { field: "status", fn: "is", value: "active", fType: "text" },
        ],
      },
    ]);
    expect(filtered.filters[0].field).toBe(" status ");
  });

  it("filters canonical rows before mapping and first-source duplicate precedence", () => {
    const first = table(
      "Primary",
      [
        { [PathPropertyName]: "Shared/One.md", state: "closed" },
        { [PathPropertyName]: "Primary/Open.md", state: "open" },
      ],
      [{ name: "state", type: "text", source: "frontmatter" }]
    );
    first.source.fields = { status: "state" };
    (first.source as any).filters = [
      { field: "state", fn: "is", value: "open", fType: "text" },
    ];
    const second = table(
      "Secondary",
      [{ [PathPropertyName]: "Shared/One.md", state: "open" }],
      [{ name: "state", type: "text", source: "frontmatter" }]
    );
    second.source.fields = { status: "state" };

    first.source = normalizeCrossDatabaseSources([first.source])[0];
    const filteredFirst = filterCrossDatabaseLoadedSource(first, {
      getPathState: () => undefined,
    });
    const projection = assembleCrossDatabaseView([
      filteredFirst.loaded,
      second,
    ]);

    expect(filteredFirst.issue).toBeUndefined();
    expect(projection.rows).toEqual([
      expect.objectContaining({
        [PathPropertyName]: "Primary/Open.md",
        status: "open",
        Source: "Primary",
      }),
      expect.objectContaining({
        [PathPropertyName]: "Shared/One.md",
        status: "open",
        Source: "Secondary",
      }),
    ]);
  });

  it.each([
    [
      "unknown operator",
      { field: "state", fn: "futureFn", value: "open", fType: "text" },
    ],
    [
      "missing schema field",
      { field: "missing", fn: "is", value: "open", fType: "text" },
    ],
    [
      "operator incompatible with field type",
      { field: "state", fn: "isGreatThan", value: "1", fType: "number" },
    ],
    [
      "operator value type mismatch",
      { field: "state", fn: "is", value: "open", fType: "date" },
    ],
    [
      "malformed filter",
      { field: 42, fn: "is", value: "open", fType: "text" },
    ],
  ])("fails a source closed with one bounded issue for an %s", (_name, filter) => {
    const source = table(
      "Primary",
      [{ [PathPropertyName]: "Primary/One.md", state: "open" }],
      [{ name: "state", type: "text", source: "frontmatter" }]
    );
    (source.source as any).filters = [filter];

    source.source = normalizeCrossDatabaseSources([source.source])[0];
    const result = filterCrossDatabaseLoadedSource(source, {
      getPathState: () => undefined,
    });

    expect(result.loaded.table.rows).toEqual([]);
    expect(result.issue).toEqual(
      expect.objectContaining({
        sourceContext: "Primary",
        sourceDb: "files",
        code: "invalid-source-filter",
      })
    );
  });

  it("maps different source fields into one canonical column with provenance", () => {
    const routines = table(
      "Routines",
      [{ [PathPropertyName]: "Routines/Walk.md", priority_num: "1" }],
      [{ name: "priority_num", type: "number", source: "frontmatter" }]
    );
    routines.source.fields = { priority: "priority_num" };
    const events = table(
      "Events",
      [{ [PathPropertyName]: "Events/Dinner.md", importance: "2" }],
      [{ name: "importance", type: "number", source: "frontmatter" }]
    );
    events.source.fields = { priority: "importance" };

    const projection = assembleCrossDatabaseView([routines, events]);

    expect(projection.cols.map((column) => column.name)).toEqual([
      PathPropertyName,
      "priority",
      "Source",
    ]);
    expect(projection.cols[1]).toEqual(
      expect.objectContaining({
        type: "number",
        source: crossDatabasePropertySource,
      })
    );
    expect(projection.rows).toEqual([
      expect.objectContaining({
        [PathPropertyName]: "Routines/Walk.md",
        priority: "1",
        Source: "Routines",
        _notidianSourceContext: "Routines",
        _notidianSourceDb: "files",
      }),
      expect.objectContaining({
        [PathPropertyName]: "Events/Dinner.md",
        priority: "2",
        Source: "Events",
        _notidianSourceContext: "Events",
        _notidianSourceDb: "files",
      }),
    ]);
  });

  it("reconciles incompatible mapped types to text", () => {
    const first = table(
      "A",
      [{ [PathPropertyName]: "A/One.md", score: "1" }],
      [{ name: "score", type: "number", source: "frontmatter" }]
    );
    first.source.fields = { value: "score" };
    const second = table(
      "B",
      [{ [PathPropertyName]: "B/Two.md", score: "high" }],
      [{ name: "score", type: "text", source: "frontmatter" }]
    );
    second.source.fields = { value: "score" };

    expect(assembleCrossDatabaseView([first, second]).cols[1].type).toBe(
      "text"
    );
  });

  it("deduplicates a file present in multiple sources using first-source precedence", () => {
    const first = table(
      "Primary",
      [{ [PathPropertyName]: "Shared/One.md", state: "open" }],
      [{ name: "state", type: "text", source: "frontmatter" }]
    );
    first.source.fields = { status: "state" };
    const second = table(
      "Secondary",
      [{ [PathPropertyName]: "Shared/One.md", state: "closed" }],
      [{ name: "state", type: "text", source: "frontmatter" }]
    );
    second.source.fields = { status: "state" };

    expect(assembleCrossDatabaseView([first, second]).rows).toEqual([
      expect.objectContaining({ status: "open", Source: "Primary" }),
    ]);
  });

  it("returns an empty projection for no successfully loaded sources", () => {
    const projection = assembleCrossDatabaseView([]);
    expect(projection.rows).toEqual([]);
    expect(projection.cols.map((column) => column.name)).toEqual([
      PathPropertyName,
      "Source",
    ]);
  });

  it("persists optional filters in frameSchema.def.sources without rewriting a legacy source", async () => {
    let persisted: any;
    const saveSchema = jest.fn(async (schema: any): Promise<void> => {
      persisted = schema;
    });
    const setFrameSchema = jest.fn();
    const sources = normalizeCrossDatabaseSources([
      {
        context: "Routines",
        db: "files",
        label: "Routines",
        fields: { priority: "priority_num" },
      },
      {
        context: "Events",
        db: "files",
        label: "Events",
        fields: { priority: "importance" },
        filters: [
          {
            field: "importance",
            fn: "isGreatThan",
            value: "1",
            fType: "number",
          },
        ],
      },
    ]);

    await persistCrossDatabaseSources({
      frameSchema: {
        id: "next",
        name: "Next",
        type: "view",
        def: { db: "legacy", icon: "ui//list" },
      },
      sources,
      saveSchema,
      setFrameSchema,
    });

    expect(persisted.def).toEqual({
      db: "files",
      icon: "ui//list",
      sources,
    });
    expect(persisted.def.sources[0]).not.toHaveProperty("filters");
    expect(persisted.def.sources[1].filters).toEqual(sources[1].filters);
    expect(setFrameSchema).toHaveBeenCalledWith(persisted);
  });
});
