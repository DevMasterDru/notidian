import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { PathPropertyName } from "shared/types/context";
import { IndexMap } from "shared/types/indexMap";
import { DBRows, SpaceProperty } from "shared/types/mdb";
import { ContextState, PathState } from "shared/types/PathState";
import { serializeMultiString } from "utils/serializers";
import {
  linkContextProp,
  linkContextRow,
  mergeContextRows,
  propertyDependencies,
  syncContextRow,
} from "./linkContextRow";

const pathState = (property: Record<string, unknown>): PathState =>
  ({
    path: "Folder/A.md",
    type: "path",
    metadata: { property },
  } as unknown as PathState);

const spaceState = {
  path: "Folder",
  type: "space",
} as PathState;

const frontmatterField = (
  name: string,
  type: string
): SpaceProperty =>
  ({
    name,
    type,
    value: "",
    schemaId: "files",
    source: frontmatterPropertySource,
  } as SpaceProperty);

describe("syncContextRow", () => {
  it("uses explicit frontmatter-backed column types when projecting row values", () => {
    const paths = new Map<string, PathState>([
      ["Folder", spaceState],
      [
        "Folder/A.md",
        pathState({
          refText: "[[Home]]",
          refLink: "[[Home]]",
          done: false,
        }),
      ],
    ]);

    const row = syncContextRow(
      paths,
      { [PathPropertyName]: "Folder/A.md" },
      [
        frontmatterField("refText", "text"),
        frontmatterField("refLink", "link"),
        frontmatterField("done", "boolean"),
      ],
      spaceState
    );

    expect(row.refText).toBe("[[Home]]");
    expect(row.refLink).toBe("Home");
    expect(row.done).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// (A) linkContextProp — project related-row values to a uniq, non-empty,
//     serialized multi-string. Pins dedupe, falsy filtering, missing-path drop,
//     and the serializeMultiString round-trip.
// ---------------------------------------------------------------------------
describe("linkContextProp", () => {
  const contextTableRows: DBRows = [
    { [PathPropertyName]: "S/a.md", title: "Alpha" },
    { [PathPropertyName]: "S/b.md", title: "Beta" },
    { [PathPropertyName]: "S/c.md", title: "" },
    { [PathPropertyName]: "S/d.md", title: "Alpha" },
  ];

  it("projects propType values for the referenced rows, de-duplicated", () => {
    const result = linkContextProp(
      "title",
      serializeMultiString(["S/a.md", "S/b.md", "S/d.md"]),
      contextTableRows
    );
    // S/d.md repeats "Alpha" — uniq collapses it.
    expect(result).toBe(serializeMultiString(["Alpha", "Beta"]));
  });

  it("drops empty/falsy projected values", () => {
    const result = linkContextProp(
      "title",
      serializeMultiString(["S/a.md", "S/c.md"]),
      contextTableRows
    );
    // S/c.md's title is "" and is filtered out.
    expect(result).toBe(serializeMultiString(["Alpha"]));
  });

  it("ignores referenced paths that are absent from the context table", () => {
    const result = linkContextProp(
      "title",
      serializeMultiString(["S/a.md", "S/does-not-exist.md"]),
      contextTableRows
    );
    expect(result).toBe(serializeMultiString(["Alpha"]));
  });

  it("returns a serialized empty list when no related rows match", () => {
    expect(linkContextProp("title", "", contextTableRows)).toBe(
      serializeMultiString([])
    );
    // The output is a serializeMultiString round-trip (JSON string array).
    expect(JSON.parse(linkContextProp("title", "", contextTableRows))).toEqual(
      []
    );
  });
});

// ---------------------------------------------------------------------------
// (B) propertyDependencies — fileprop/tags dependency graph parsed via mathjs
//     prop() and topologically sorted (dependencies before dependents).
//     ADVERSARIAL: self-dep skipped, real cycle throws, malformed swallowed.
// ---------------------------------------------------------------------------
describe("propertyDependencies", () => {
  // A fileprop whose serialized value carries a mathjs formula string.
  const fileprop = (name: string, formula: string): SpaceProperty =>
    ({
      name,
      type: "fileprop",
      value: JSON.stringify({ value: formula, type: "string" }),
    } as SpaceProperty);

  const plain = (name: string): SpaceProperty =>
    ({ name, type: "text", value: "" } as SpaceProperty);

  it("orders dependencies before the fields that reference them", () => {
    // A depends on B (prop('B')); B has no deps; C is a plain non-formula field.
    const result = propertyDependencies([
      fileprop("A", "prop('B')"),
      fileprop("B", "1"),
      plain("C"),
    ]);
    expect(result).toEqual(["B", "A", "C"]);
    expect(result.indexOf("B")).toBeLessThan(result.indexOf("A"));
    // Non-fileprop/non-tags fields still appear as graph nodes.
    expect(result).toContain("C");
  });

  it("skips a self-dependency without reporting a false cycle", () => {
    expect(propertyDependencies([fileprop("S", "prop('S')")])).toEqual(["S"]);
  });

  it("throws on a genuine A->B->A circular dependency", () => {
    expect(() =>
      propertyDependencies([
        fileprop("X", "prop('Y')"),
        fileprop("Y", "prop('X')"),
      ])
    ).toThrow("Circular dependency detected");
  });

  it("swallows an unparseable formula and yields the node with no deps", () => {
    // "prop(" is not valid mathjs — the parse throws and is caught; no throw,
    // the field still appears, contributing no edges.
    expect(propertyDependencies([fileprop("M", "prop(")])).toEqual(["M"]);
  });

  it("collects a tags-prefixed field as a node even when type is not fileprop", () => {
    // A 'tags'-named field is included by name.toLowerCase().startsWith('tags').
    // As a 'text' field, parseFieldValue surfaces no formula value, so it
    // contributes no dependency edge — it still appears as a graph node.
    const result = propertyDependencies([
      {
        name: "tags",
        type: "text",
        value: JSON.stringify({ value: "prop('A')", type: "string" }),
      } as SpaceProperty,
      fileprop("A", "1"),
    ]);
    expect(result).toContain("tags");
    expect(result).toContain("A");
    // No edge from tags to A (text type yields no parsed value), so the order
    // follows the field declaration order.
    expect(result).toEqual(["tags", "A"]);
  });

  it("orders a fileprop-typed tags field after the field it depends on", () => {
    // When the tags-prefixed field is a fileprop, its formula value IS parsed,
    // so the dependency edge places A before tags.
    const result = propertyDependencies([
      fileprop("tags", "prop('A')"),
      fileprop("A", "1"),
    ]);
    expect(result).toEqual(["A", "tags"]);
    expect(result.indexOf("A")).toBeLessThan(result.indexOf("tags"));
  });
});

// ---------------------------------------------------------------------------
// (C) mergeContextRows — keep valid existing rows in DB order, drop rows whose
//     resolved path is gone, append {File} stubs for paths missing from rows.
// ---------------------------------------------------------------------------
describe("mergeContextRows", () => {
  const spacePath = { path: "Folder", type: "space" } as PathState;

  it("preserves DB order, drops stale rows, and appends missing-path stubs", () => {
    const rows: DBRows = [
      { [PathPropertyName]: "Folder/keep1.md", rank: "0" },
      { [PathPropertyName]: "Folder/drop.md", rank: "1" },
      { [PathPropertyName]: "Folder/keep2.md", rank: "2" },
    ];
    // paths order intentionally differs from row order to prove that existing
    // rows keep their original (rank) order rather than following `paths`.
    const paths = ["Folder/keep2.md", "Folder/keep1.md", "Folder/new.md"];

    const merged = mergeContextRows(
      paths,
      rows,
      new Map<string, PathState>(),
      new IndexMap(),
      spacePath
    );

    expect(merged).toEqual([
      { [PathPropertyName]: "Folder/keep1.md", rank: "0" },
      { [PathPropertyName]: "Folder/keep2.md", rank: "2" },
      { [PathPropertyName]: "Folder/new.md" },
    ]);
    // Folder/drop.md is not in paths and is removed.
    expect(
      merged.find((r) => r[PathPropertyName] === "Folder/drop.md")
    ).toBeUndefined();
    // The appended stub carries only the path property.
    expect(merged[2]).toEqual({ [PathPropertyName]: "Folder/new.md" });
  });

  it("applies resolvePath to each row path against path.path before matching", () => {
    // A relative './' path resolves against the space path; the resolved value
    // must be what's compared with `paths` and emitted as the existing path.
    const rows: DBRows = [{ [PathPropertyName]: "./rel.md", rank: "0" }];
    const pathStates = new Map<string, PathState>([["Folder", spacePath]]);

    // With Folder a space, resolvePath('./rel.md', 'Folder', isSpace) => 'Folder/rel.md'.
    const merged = mergeContextRows(
      ["Folder/rel.md"],
      rows,
      pathStates,
      new IndexMap(),
      spacePath
    );
    // The relative row is retained because its RESOLVED path is in `paths`,
    // and no stub is appended (the resolved path already covers it).
    expect(merged).toEqual([{ [PathPropertyName]: "./rel.md", rank: "0" }]);
  });
});

// ---------------------------------------------------------------------------
// (D) linkContextRow — early-return guards and relation-field projection.
// ---------------------------------------------------------------------------
describe("linkContextRow", () => {
  const noop = null as unknown as math.MathJsInstance;
  const settings = {} as Parameters<typeof linkContextRow>[7];

  it("returns {} for a null _row (first guard)", () => {
    const result = linkContextRow(
      noop,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      null as unknown as Record<string, string>,
      [],
      null as unknown as PathState,
      settings
    );
    expect(result).toEqual({});
  });

  it("returns _row unchanged for a null path (second guard)", () => {
    const row = { [PathPropertyName]: "x.md", a: "1" };
    const result = linkContextRow(
      noop,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      row,
      [],
      null as unknown as PathState,
      settings
    );
    expect(result).toBe(row);
  });

  it("projects inverse relation rows (multi merges + uniq, single takes first)", () => {
    const path = { path: "Projects", type: "space" } as PathState;
    const paths = new Map<string, PathState>([
      ["Projects", path],
      [
        "Projects/Alpha.md",
        { path: "Projects/Alpha.md", type: "path" } as PathState,
      ],
    ]);

    // Other space "Tasks": rows whose "project" field links back to Alpha.
    const tasksContext = {
      path: "Tasks",
      contextTable: {
        rows: [
          {
            [PathPropertyName]: "Tasks/t1.md",
            project: serializeMultiString(["Projects/Alpha.md"]),
          },
          {
            [PathPropertyName]: "Tasks/t2.md",
            project: serializeMultiString(["Projects/Other.md"]),
          },
          {
            [PathPropertyName]: "Tasks/t3.md",
            project: serializeMultiString(["Projects/Alpha.md"]),
          },
        ],
      },
    } as unknown as ContextState;
    const contextsMap = new Map<string, ContextState>([
      ["Tasks", tasksContext],
    ]);

    const multiField = {
      name: "tasks",
      type: "context-multi",
      value: JSON.stringify({ space: "Tasks", field: "project" }),
    } as SpaceProperty;

    // Existing value t1 is also an inverse hit — uniq must collapse it.
    const multiRow = {
      [PathPropertyName]: "Projects/Alpha.md",
      tasks: serializeMultiString(["Tasks/t1.md"]),
    };
    const multiResult = linkContextRow(
      noop,
      paths,
      contextsMap,
      new IndexMap(),
      multiRow,
      [multiField],
      path,
      settings
    );
    expect(multiResult.tasks).toBe(
      serializeMultiString(["Tasks/t1.md", "Tasks/t3.md"])
    );

    const singleField = {
      name: "task",
      type: "context",
      value: JSON.stringify({ space: "Tasks", field: "project" }),
    } as SpaceProperty;
    const singleRow = { [PathPropertyName]: "Projects/Alpha.md" };
    const singleResult = linkContextRow(
      noop,
      paths,
      contextsMap,
      new IndexMap(),
      singleRow,
      [singleField],
      path,
      settings
    );
    // Single-value relation takes the first inverse hit.
    expect(singleResult.task).toBe("Tasks/t1.md");
  });
});
