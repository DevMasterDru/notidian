import { PathPropertyName } from "shared/types/context";
import { NotidianEmbedDescriptor } from "./notidianEmbed";
import {
  inspectDeclaredViewForEmbed,
  resolveDeclaredViewForEmbed,
} from "./notidianDeclaredViewRuntime";

const descriptor = (over: Partial<NotidianEmbedDescriptor> = {}) =>
  ({
    target: "Projects",
    kind: "view",
    id: "gidi-active",
    title: true,
    editable: false,
    ...over,
  } as NotidianEmbedDescriptor);

const viewDeclaration = {
  id: "gidi-active",
  base: { kind: "view", id: "active" },
  where: ["repo = Gidi", "status != done"],
};

const makeSuperstate = (opts: {
  notePath?: string;
  views?: unknown;
  includeViews?: boolean;
  tableSchemas?: any[];
  cachedSchemas?: any[];
  tables?: Record<string, any>;
  frames?: Record<string, any>;
} = {}) => {
  const notePath = opts.notePath ?? "Projects/Projects.md";
  const property: Record<string, unknown> = {};
  if (opts.includeViews !== false) property.views = opts.views ?? [viewDeclaration];
  const tables = opts.tables ?? {
    files: {
      schema: { id: "files", name: "Files", type: "db" },
      cols: [
        { name: PathPropertyName, type: "fileprop" },
        { name: "repo", type: "text" },
        { name: "status", type: "text" },
      ],
      rows: [] as any[],
    },
  };
  const frames = opts.frames ?? {
    active: {
      schema: {
        id: "active",
        name: "Active",
        type: "view",
        def: JSON.stringify({ db: "files" }),
      },
      cols: [],
      rows: [] as any[],
    },
  };
  const tableSchemas =
    opts.tableSchemas ?? Object.values(tables).map((table: any) => table.schema);

  return {
    spacesIndex: new Map([
      ["Projects", { space: { path: "Projects", notePath } }],
    ]),
    pathsIndex: new Map([[notePath, { metadata: { property } }]]),
    contextsIndex: new Map([
      ["Projects", { schemas: opts.cachedSchemas ?? tableSchemas }],
    ]),
    spaceManager: {
      uriByString: jest.fn(() => ({ basePath: "Projects" })),
      tablesForSpace: jest.fn(async () => tableSchemas),
      readTable: jest.fn(async (_path: string, id: string) => tables[id] ?? null),
      readFrame: jest.fn(async (_path: string, id: string) => frames[id] ?? null),
    },
  } as any;
};

describe("inspectDeclaredViewForEmbed", () => {
  it.each([
    "Projects/Projects.md",
    "Projects.md",
  ])("uses the indexed folder note path in either layout (%s)", (notePath) => {
    const superstate = makeSuperstate({ notePath });
    const inspected = inspectDeclaredViewForEmbed({
      superstate,
      sourcePath: "Topics/Gidi.md",
      descriptor: descriptor(),
    });

    expect(inspected.kind).toBe("declaration");
    expect((inspected as any).targetPath).toBe("Projects");
    expect(superstate.spaceManager.uriByString).toHaveBeenCalledWith(
      "Projects/#*gidi-active",
      "Topics/Gidi.md"
    );
  });

  it("returns the exact native descriptor when the folder note has no views key", () => {
    const native = descriptor();
    const inspected = inspectDeclaredViewForEmbed({
      superstate: makeSuperstate({ includeViews: false }),
      sourcePath: "Topic.md",
      descriptor: native,
    });

    expect(inspected).toEqual({ kind: "none", descriptor: native });
    expect((inspected as any).descriptor).toBe(native);
  });

  it("returns the exact native descriptor when no declaration id matches", () => {
    const native = descriptor({ id: "native-only" });
    const inspected = inspectDeclaredViewForEmbed({
      superstate: makeSuperstate(),
      sourcePath: "Topic.md",
      descriptor: native,
    });

    expect(inspected).toEqual({ kind: "none", descriptor: native });
    expect((inspected as any).descriptor).toBe(native);
  });

  it("surfaces a matching invalid declaration instead of falling back", () => {
    const inspected = inspectDeclaredViewForEmbed({
      superstate: makeSuperstate({
        views: [
          { id: "gidi-active", base: { kind: "view", id: "active" }, wher: [] },
        ],
      }),
      sourcePath: "Topic.md",
      descriptor: descriptor(),
    });

    expect(inspected.kind).toBe("error");
  });
});

describe("resolveDeclaredViewForEmbed", () => {
  it("resolves rich declaration tokens against the native schema", async () => {
    const superstate = makeSuperstate({
      views: [
        {
          id: "gidi-active",
          base: { kind: "view", id: "active" },
          where: ["repo = Gidi"],
          sort: [{ field: "updated", direction: "desc" }],
          groupBy: ["status"],
          columns: ["File", "status", "updated"],
          limit: 50,
          kind: "table",
        },
      ],
      tables: {
        files: {
          schema: { id: "files", name: "Files", type: "db" },
          cols: [
            { name: PathPropertyName, type: "fileprop" },
            { name: "repo", type: "text" },
            { name: "status", type: "text" },
            { name: "updated", type: "date" },
          ],
          rows: [],
        },
      },
    });
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved).toEqual({
      ok: true,
      descriptor: expect.objectContaining({ kind: "view", id: "active" }),
      predicateOverlay: {
        filters: [
          { field: "repo", fn: "is", value: "Gidi", fType: "text" },
        ],
        sort: [{ field: "updated", fn: "latest" }],
        groupBy: ["status"],
        colsOrder: ["File", "status", "updated"],
        colsHidden: ["repo"],
        limit: 50,
        view: "table",
        listView: "",
        listGroup: "",
        listItem: "",
      },
    });
  });

  it("leaves omitted rich projection keys absent", async () => {
    const superstate = makeSuperstate();
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.predicateOverlay).toEqual({
        filters: [
          { field: "repo", fn: "is", value: "Gidi", fType: "text" },
          { field: "status", fn: "isNot", value: "done", fType: "text" },
        ],
      });
      expect(resolved.predicateOverlay).not.toHaveProperty("sort");
      expect(resolved.predicateOverlay).not.toHaveProperty("colsOrder");
      expect(resolved.predicateOverlay).not.toHaveProperty("view");
    }
  });

  it("resolves an explicit native view and orders declaration filters before embed filters", async () => {
    const superstate = makeSuperstate();
    const embed = descriptor({
      where: [{ field: "priority", fn: "is", value: "urgent", fType: "text" }],
    });
    // Add the embed-only field to the target schema so validation is honest.
    (superstate.spaceManager.readTable as jest.Mock).mockResolvedValue({
      schema: { id: "files", type: "db" },
      cols: [
        { name: PathPropertyName, type: "fileprop" },
        { name: "repo", type: "text" },
        { name: "status", type: "text" },
        { name: "priority", type: "text" },
      ],
      rows: [],
    });
    const inspected = inspectDeclaredViewForEmbed({
      superstate,
      sourcePath: "Topic.md",
      descriptor: embed,
    });
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspected,
    });

    expect(resolved).toEqual({
      ok: true,
      descriptor: expect.objectContaining({
        target: "Projects",
        kind: "view",
        id: "active",
        where: [
          { field: "repo", fn: "is", value: "Gidi", fType: "text" },
          { field: "status", fn: "isNot", value: "done", fType: "text" },
          { field: "priority", fn: "is", value: "urgent", fType: "text" },
        ],
      }),
      predicateOverlay: {
        filters: [
          { field: "repo", fn: "is", value: "Gidi", fType: "text" },
          { field: "status", fn: "isNot", value: "done", fType: "text" },
          { field: "priority", fn: "is", value: "urgent", fType: "text" },
        ],
      },
    });
  });

  it("resolves an explicit table base", async () => {
    const superstate = makeSuperstate({
      views: [
        { id: "gidi-active", base: { kind: "table", id: "files" }, where: ["repo = Gidi"] },
      ],
    });
    const embed = descriptor();
    const inspection = inspectDeclaredViewForEmbed({
      superstate,
      sourcePath: "Topic.md",
      descriptor: embed,
    });
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection,
    });

    expect(resolved).toEqual({
      ok: true,
      descriptor: expect.objectContaining({ kind: "table", id: "files" }),
      predicateOverlay: {
        filters: [
          { field: "repo", fn: "is", value: "Gidi", fType: "text" },
        ],
      },
    });
  });

  it("consults live table schemas when the context cache does not contain the base", async () => {
    const superstate = makeSuperstate({
      cachedSchemas: [],
      views: [
        { id: "gidi-active", base: { kind: "table", id: "files" }, where: ["repo = Gidi"] },
      ],
    });
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved.ok).toBe(true);
    expect(superstate.spaceManager.tablesForSpace).toHaveBeenCalledWith("Projects");
  });

  it("fails a missing native base closed", async () => {
    const superstate = makeSuperstate({
      frames: {},
      views: [
        { id: "gidi-active", base: { kind: "view", id: "missing" } },
      ],
    });
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved).toEqual({
      ok: false,
      message: expect.stringContaining("missing"),
    });
  });

  it("fails an unknown declaration or embed field closed", async () => {
    const superstate = makeSuperstate({
      views: [
        { id: "gidi-active", base: { kind: "view", id: "active" }, where: ["secret = yes"] },
      ],
    });
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved).toEqual({
      ok: false,
      message: expect.stringContaining("secret"),
    });
  });

  it.each([
    {
      label: "unknown sort field",
      column: null,
      token: { sort: [{ field: "missing", direction: "asc" }] },
      message: "missing",
    },
    {
      label: "schema-hidden requested column",
      column: { name: "secret", type: "text", hidden: "true" },
      token: { columns: ["File", "secret"] },
      message: "secret",
    },
    {
      label: "unsupported sort column type",
      column: { name: "payload", type: "object" },
      token: { sort: [{ field: "payload", direction: "asc" }] },
      message: "payload",
    },
    {
      label: "unsupported display kind",
      column: null,
      token: { kind: "spreadsheet" },
      message: "spreadsheet",
    },
    {
      label: "system-only cross-database row key",
      column: null,
      token: { columns: ["File", "_notidianSourceContext"] },
      message: "_notidianSourceContext",
    },
  ])("fails $label closed", async ({ column, token, message }) => {
    const baseTable = {
      schema: { id: "files", name: "Files", type: "db" },
      cols: [
        { name: PathPropertyName, type: "fileprop" },
        { name: "repo", type: "text" },
        { name: "status", type: "text" },
        ...(column ? [column] : []),
      ],
      rows: [] as any[],
    };
    const superstate = makeSuperstate({
      views: [
        {
          id: "gidi-active",
          base: { kind: "view", id: "active" },
          ...token,
        },
      ],
      tables: { files: baseTable },
    });
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved).toEqual({
      ok: false,
      message: expect.stringContaining(message),
    });
  });

  it("validates cross-database view clauses against canonical projection fields", async () => {
    const superstate = makeSuperstate({
      views: [
        { id: "gidi-active", base: { kind: "view", id: "combined" }, where: ["status = open"] },
      ],
      frames: {
        combined: {
          schema: {
            id: "combined",
            name: "Combined",
            type: "view",
            def: JSON.stringify({
              sources: [
                { context: "One", db: "files", fields: { status: "State" } },
                { context: "Two", db: "files", fields: { status: "Status" } },
              ],
            }),
          },
          cols: [],
          rows: [],
        },
      },
    });
    const embed = descriptor();
    const resolved = await resolveDeclaredViewForEmbed({
      superstate,
      descriptor: embed,
      inspection: inspectDeclaredViewForEmbed({
        superstate,
        sourcePath: "Topic.md",
        descriptor: embed,
      }),
    });

    expect(resolved.ok).toBe(true);
    expect(superstate.spaceManager.readTable).not.toHaveBeenCalled();
  });
});
