import {
  parseDeclaredViews,
  selectDeclaredView,
} from "./notidianDeclaredView";

describe("folder-note declared views", () => {
  it("parses ordered declarations and reuses the public where grammar", () => {
    const parsed = parseDeclaredViews([
      {
        id: "gidi-active",
        base: { kind: "view", id: "active" },
        where: ["repo = Gidi", "status != done"],
        sort: [{ field: "updated", direction: "desc" }],
        groupBy: ["status"],
        columns: ["File", "status", "updated"],
        limit: 50,
        kind: "table",
      },
      {
        id: "gidi-open",
        base: { kind: "view", id: "active" },
        where: ["status = open"],
      },
    ]);

    expect(parsed.declarations.map((declaration) => declaration.id)).toEqual([
      "gidi-active",
      "gidi-open",
    ]);
    expect(selectDeclaredView(parsed, "gidi-active")).toEqual({
      kind: "declaration",
      declaration: expect.objectContaining({
        id: "gidi-active",
        base: { kind: "view", id: "active" },
        where: [
          { field: "repo", fn: "is", value: "Gidi", fType: "text" },
          { field: "status", fn: "isNot", value: "done", fType: "text" },
        ],
        sort: [{ field: "updated", direction: "desc" }],
        groupBy: ["status"],
        columns: ["File", "status", "updated"],
        limit: 50,
        kind: "table",
      }),
    });
    expect(selectDeclaredView(parsed, "native-only")).toEqual({ kind: "none" });
  });

  it("allows two declared ids to wrap one native base independently", () => {
    const parsed = parseDeclaredViews([
      { id: "mine", base: { kind: "table", id: "files" } },
      { id: "yours", base: { kind: "table", id: "files" } },
    ]);

    expect(selectDeclaredView(parsed, "mine")).toEqual({
      kind: "declaration",
      declaration: expect.objectContaining({
        id: "mine",
        base: { kind: "table", id: "files" },
      }),
    });
    expect(selectDeclaredView(parsed, "yours")).toEqual({
      kind: "declaration",
      declaration: expect.objectContaining({
        id: "yours",
        base: { kind: "table", id: "files" },
      }),
    });
  });

  it("makes an explicit declaration own a native id collision", () => {
    const parsed = parseDeclaredViews([
      { id: "active", base: { kind: "view", id: "canonical-active" } },
    ]);

    expect(selectDeclaredView(parsed, "active")).toEqual({
      kind: "declaration",
      declaration: expect.objectContaining({
        base: { kind: "view", id: "canonical-active" },
      }),
    });
  });

  it.each([
    {
      label: "invalid slug",
      views: [{ id: "Not Valid", base: { kind: "view", id: "active" } }],
      id: "Not Valid",
    },
    {
      label: "missing base",
      views: [{ id: "active" }],
      id: "active",
    },
    {
      label: "invalid base kind",
      views: [{ id: "active", base: { kind: "frame", id: "x" } }],
      id: "active",
    },
    {
      label: "unknown declaration key",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, wher: ["x = y"] },
      ],
      id: "active",
    },
    {
      label: "unknown base key",
      views: [
        { id: "active", base: { kind: "view", id: "x", target: "Other" } },
      ],
      id: "active",
    },
    {
      label: "where is not an ordered list",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, where: "x = y" },
      ],
      id: "active",
    },
    {
      label: "malformed where clause",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, where: ["not a clause"] },
      ],
      id: "active",
    },
    {
      label: "sort is not an ordered list",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, sort: "updated" },
      ],
      id: "active",
    },
    {
      label: "sort entry has an unknown key",
      views: [
        {
          id: "active",
          base: { kind: "view", id: "x" },
          sort: [{ field: "updated", direction: "desc", nulls: "last" }],
        },
      ],
      id: "active",
    },
    {
      label: "sort direction is unsupported",
      views: [
        {
          id: "active",
          base: { kind: "view", id: "x" },
          sort: [{ field: "updated", direction: "sideways" }],
        },
      ],
      id: "active",
    },
    {
      label: "sort fields are duplicated",
      views: [
        {
          id: "active",
          base: { kind: "view", id: "x" },
          sort: [
            { field: "updated", direction: "asc" },
            { field: "updated", direction: "desc" },
          ],
        },
      ],
      id: "active",
    },
    {
      label: "groupBy contains a non-text field",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, groupBy: [7] },
      ],
      id: "active",
    },
    {
      label: "columns contains duplicate fields",
      views: [
        {
          id: "active",
          base: { kind: "view", id: "x" },
          columns: ["File", "File"],
        },
      ],
      id: "active",
    },
    {
      label: "limit is zero",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, limit: 0 },
      ],
      id: "active",
    },
    {
      label: "limit is fractional",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, limit: 1.5 },
      ],
      id: "active",
    },
    {
      label: "display kind is not text",
      views: [
        { id: "active", base: { kind: "view", id: "x" }, kind: ["table"] },
      ],
      id: "active",
    },
  ])("fails the matching declaration closed for $label", ({ views, id }) => {
    const selected = selectDeclaredView(parseDeclaredViews(views), id);
    expect(selected.kind).toBe("error");
  });

  it("fails duplicate ids closed instead of choosing one", () => {
    const parsed = parseDeclaredViews([
      { id: "active", base: { kind: "view", id: "one" } },
      { id: "active", base: { kind: "view", id: "two" } },
    ]);

    expect(selectDeclaredView(parsed, "active")).toEqual({
      kind: "error",
      message: expect.stringContaining("duplicate"),
    });
  });

  it("fails self and multi-node declaration base cycles closed", () => {
    const self = parseDeclaredViews([
      { id: "active", base: { kind: "view", id: "active" } },
    ]);
    expect(selectDeclaredView(self, "active")).toEqual({
      kind: "error",
      message: expect.stringContaining("cycle"),
    });

    const pair = parseDeclaredViews([
      { id: "one", base: { kind: "view", id: "two" } },
      { id: "two", base: { kind: "view", id: "one" } },
    ]);
    expect(selectDeclaredView(pair, "one").kind).toBe("error");
    expect(selectDeclaredView(pair, "two").kind).toBe("error");
  });

  it("fails a malformed root views shape without guessing a native fallback", () => {
    const parsed = parseDeclaredViews({ active: { base: "files" } });
    expect(selectDeclaredView(parsed, "active")).toEqual({
      kind: "error",
      message: expect.stringContaining("ordered list"),
    });
  });

  it.each([
    ["non-object entry", ["active"]],
    ["entry without an id", [{ base: { kind: "view", id: "active" } }]],
  ])("fails an unidentifiable %s globally instead of silently dropping it", (_label, views) => {
    const parsed = parseDeclaredViews(views);
    expect(selectDeclaredView(parsed, "active")).toEqual({
      kind: "error",
      message: expect.stringContaining("id"),
    });
  });
});
