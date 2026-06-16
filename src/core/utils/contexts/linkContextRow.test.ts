import { all, ConfigOptions, create, MathJsInstance } from "mathjs";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { formulas } from "core/utils/formula/formulas";
import { PathPropertyName } from "shared/types/context";
import { IndexMap } from "shared/types/indexMap";
import { DBRows, SpaceProperty } from "shared/types/mdb";
import { ContextState, PathState } from "shared/types/PathState";
import { MakeMDSettings } from "shared/types/settings";
import { serializeMultiString } from "utils/serializers";
import {
  linkContextProp,
  linkContextRow,
  mergeContextRows,
  propertyDependencies,
  syncContextRow,
} from "./linkContextRow";

// A REAL mathjs run-context, built the same way the live formula pipeline does
// (parser.ts: math.create(all, { matrix: "Array" }) + import(formulas, override)).
// Using the genuine engine — rather than mocking runFormulaWithContext — lets the
// flex-`fileprop` and `formulaFields` paths of linkContextRow actually execute, so
// these tests characterize the module's real wiring, not a stubbed collaborator.
const makeRunContext = (): MathJsInstance => {
  const config: ConfigOptions = { matrix: "Array" };
  const runContext = create(all, config);
  runContext.import(formulas, { override: true });
  return runContext;
};

const emptySettings = {} as MakeMDSettings;

const pathState = (
  property: Record<string, unknown>,
  tags?: string[]
): PathState =>
  ({
    path: "Folder/A.md",
    type: "path",
    metadata: { property },
    ...(tags ? { tags } : {}),
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

  it("serializes the PathState's .tags into a 'tags' field (case-insensitive name match)", () => {
    // linkContextRow.ts:107 — when `fields` contains a column whose name matches
    // /tags/i, syncContextRow projects the resolved PathState's `.tags` (a vault
    // authority value, not frontmatter) onto the row as a serialized multi-string.
    // The field is declared as "Tags" (capital) to pin the line-105
    // `name?.toLowerCase() == 'tags'` case-insensitive lookup; the emitted key
    // keeps the field's own casing (tagField.name), so the row carries "Tags".
    const tags = ["alpha", "beta", "alpha"];
    const paths = new Map<string, PathState>([
      ["Folder", spaceState],
      ["Folder/A.md", pathState({ title: "A" }, tags)],
    ]);

    const row = syncContextRow(
      paths,
      { [PathPropertyName]: "Folder/A.md" },
      [frontmatterField("Tags", "tags-multi")],
      spaceState
    );

    // The whole `.tags` list is spread + serialized verbatim (no dedupe/filter at
    // this layer — serializeMultiString round-trips the exact array).
    expect(row.Tags).toBe(serializeMultiString([...tags]));
    expect(JSON.parse(row.Tags as string)).toEqual(tags);
  });

  it("emits a serialized empty list for a 'tags' field when the PathState carries no tags", () => {
    // Same branch (line 107) with the `?? []` fallback: a resolved PathState with
    // no `.tags` yields an empty serialized multi-string, not an absent key.
    const paths = new Map<string, PathState>([
      ["Folder", spaceState],
      ["Folder/A.md", pathState({ title: "A" })],
    ]);

    const row = syncContextRow(
      paths,
      { [PathPropertyName]: "Folder/A.md" },
      [frontmatterField("tags", "tags-multi")],
      spaceState
    );

    expect(row.tags).toBe(serializeMultiString([]));
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

// ===========================================================================
// (E) ADVERSARIAL DEPTH — the aggregate / rollup / flex / formula machinery
//     (Notidian-0p26). The happy-path suite above pins relation projection and
//     the early-return guards; this block drives the deep, previously-uncovered
//     code: rowsForAggregate's four source-dispatch branches + its null returns,
//     filterRowsByGroups any/all logic and its pass-throughs, aggregateFields'
//     fieldCol resolution + calculateAggregate placement + space resolvePath,
//     flexFields' fileprop & aggregate branches + the {type,value,config} JSON
//     shape, and formulaFields' dependency ordering + fileprop-only filter.
//     All collaborators are real (mathjs engine, calculateAggregate, the filter
//     dispatcher) over plain-Map fakes — these characterize the genuine wiring
//     and lock it as a regression net (ADR 0029 relations/rollups correctness).
// ===========================================================================

// Helpers shared across the adversarial groups. A SpaceProperty whose .value is
// the configKeys-bearing JSON the live schema stores for that column type.
const aggregateField = (
  name: string,
  config: Record<string, unknown>
): SpaceProperty =>
  ({ name, type: "aggregate", value: JSON.stringify(config) } as SpaceProperty);

const relationField = (
  name: string,
  config: Record<string, unknown>,
  multi = true
): SpaceProperty =>
  ({
    name,
    type: multi ? "context-multi" : "context",
    value: JSON.stringify(config),
  } as SpaceProperty);

const flexField = (name: string): SpaceProperty =>
  ({ name, type: "flex", value: "" } as SpaceProperty);

const fileprop = (name: string, formula: string): SpaceProperty =>
  ({
    name,
    type: "fileprop",
    value: JSON.stringify({ value: formula, type: "string" }),
  } as SpaceProperty);

// Build a ContextState carrying both an `mdb` (schema/space aggregates read
// .mdb[schema]) and a `contextTable` ($items / ref aggregates read it).
const contextWith = (
  cfg: {
    mdb?: Record<string, { rows: DBRows; cols?: SpaceProperty[] }>;
    contextTable?: { rows: DBRows; cols?: SpaceProperty[] };
  }
): ContextState => cfg as unknown as ContextState;

const noopRunContext = null as unknown as MathJsInstance;

// ---------------------------------------------------------------------------
// (E1) rowsForAggregate — four source-dispatch branches + null returns,
//      observed through linkContextRow's aggregateFields output.
// ---------------------------------------------------------------------------
describe("linkContextRow › aggregate source dispatch (rowsForAggregate)", () => {
  const path = { path: "Home", type: "space" } as PathState;

  it("space+schema branch: sums a foreign space's schema rows", () => {
    // fieldValue.space && fieldValue.schema -> contextsMap.get(space).mdb[schema].rows
    const contextsMap = new Map<string, ContextState>([
      [
        "Other",
        contextWith({
          mdb: {
            tasks: {
              rows: [{ hours: "2" }, { hours: "3" }, { hours: "5" }],
              cols: [{ name: "hours", type: "number" } as SpaceProperty],
            },
          },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Other", { path: "Other", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("total", { space: "Other", schema: "tasks", field: "hours", fn: "sum" })],
      path,
      emptySettings
    );
    expect(result.total).toBe("10");
  });

  it("schema-only branch: falls back to the current path's context mdb", () => {
    // fieldValue.schema (no space) -> contextsMap.get(pathState.path).mdb[schema].rows
    const contextsMap = new Map<string, ContextState>([
      [
        "Home",
        contextWith({
          mdb: {
            files: {
              rows: [{ cost: "4" }, { cost: "6" }],
              cols: [{ name: "cost", type: "number" } as SpaceProperty],
            },
          },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("total", { schema: "files", field: "cost", fn: "sum" })],
      path,
      emptySettings
    );
    expect(result.total).toBe("10");
  });

  it("ref=='$items' branch: aggregates the row's own contextTable rows", () => {
    // fieldValue.ref == '$items' -> contextsMap.get(_row[File]).contextTable.rows
    const contextsMap = new Map<string, ContextState>([
      [
        "Home/A.md",
        contextWith({
          contextTable: {
            rows: [{ qty: "1" }, { qty: "2" }, { qty: "4" }],
            cols: [{ name: "qty", type: "number" } as SpaceProperty],
          },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("count", { ref: "$items", field: "qty", fn: "count" })],
      path,
      emptySettings
    );
    // count fn returns the row tally, regardless of column values.
    expect(result.count).toBe("3");
  });

  it("ref-based branch: follows a relation field's resolved rows then aggregates a column", () => {
    // ref names a sibling relation field; rowsForAggregate maps that relation's
    // computed propValues onto the related space's contextTable rows.
    const tasks = contextWith({
      contextTable: {
        rows: [
          { [PathPropertyName]: "Tasks/t1.md", points: "5" },
          { [PathPropertyName]: "Tasks/t2.md", points: "8" },
          { [PathPropertyName]: "Tasks/t3.md", points: "2" },
        ],
        cols: [{ name: "points", type: "number" } as SpaceProperty],
      },
    });
    const contextsMap = new Map<string, ContextState>([["Tasks", tasks]]);

    const fields = [
      relationField("rel", { space: "Tasks", field: "ignored" }),
      aggregateField("relSum", { ref: "rel", field: "points", fn: "sum" }),
    ];
    const row = {
      [PathPropertyName]: "Home/A.md",
      // Pre-existing relation values: t1 (5) + t3 (2) = 7 (t2 excluded).
      rel: serializeMultiString(["Tasks/t1.md", "Tasks/t3.md"]),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Tasks", { path: "Tasks", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      row,
      fields,
      path,
      emptySettings
    );
    expect(result.relSum).toBe("7");
  });

  it("null-return: a ref naming no existing field omits the aggregate entirely", () => {
    // rowsForAggregate returns null (missing refField) -> aggregateFields drops it.
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("ghost", { ref: "no-such-field", field: "x", fn: "sum" })],
      path,
      emptySettings
    );
    expect(result).not.toHaveProperty("ghost");
  });

  it("null-return: a ref field with no space (or no column) omits the aggregate", () => {
    // refField exists but its parsed value has no space -> null -> dropped.
    const fields = [
      // A context field whose JSON carries NO space key.
      relationField("rel", { field: "project" }),
      aggregateField("ghost", { ref: "rel", field: "points", fn: "sum" }),
    ];
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md", rel: serializeMultiString(["Tasks/t1.md"]) },
      fields,
      path,
      emptySettings
    );
    expect(result).not.toHaveProperty("ghost");
  });
});

// ---------------------------------------------------------------------------
// (E2) filterRowsByGroups — any (OR) / all (AND) logic, empty-filter
//      short-circuit, and missing-column pass-through, driven through an
//      aggregate's `filters` config.
// ---------------------------------------------------------------------------
describe("linkContextRow › aggregate filters (filterRowsByGroups)", () => {
  const path = { path: "Home", type: "space" } as PathState;

  // A space+schema context whose rows carry a numeric `points` and a text
  // `status`, plus cols so the filter dispatcher can resolve operators by type.
  const filteredContext = () =>
    new Map<string, ContextState>([
      [
        "Other",
        contextWith({
          mdb: {
            tasks: {
              rows: [
                { points: "1", status: "open" },
                { points: "5", status: "done" },
                { points: "9", status: "open" },
              ],
              cols: [
                { name: "points", type: "number" } as SpaceProperty,
                { name: "status", type: "text" } as SpaceProperty,
              ],
            },
          },
        }),
      ],
    ]);

  const run = (filters: unknown) =>
    linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Other", { path: "Other", type: "space" } as PathState]]),
      filteredContext(),
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [
        aggregateField("kept", {
          space: "Other",
          schema: "tasks",
          field: "points",
          fn: "count",
          filters,
        }),
      ],
      path,
      emptySettings
    );

  it("all (AND): every filter in the group must pass", () => {
    // status is 'open' AND points > 4 -> only the points:9 row survives.
    const result = run([
      {
        type: "all",
        filters: [
          { field: "status", fn: "is", value: "open", fType: "" },
          { field: "points", fn: "isGreatThan", value: "4", fType: "" },
        ],
      },
    ]);
    expect(result.kept).toBe("1");
  });

  it("any (OR): at least one filter in the group passes", () => {
    // status is 'done' OR points > 8 -> rows {5,done} and {9,open} survive.
    const result = run([
      {
        type: "any",
        filters: [
          { field: "status", fn: "is", value: "done", fType: "" },
          { field: "points", fn: "isGreatThan", value: "8", fType: "" },
        ],
      },
    ]);
    expect(result.kept).toBe("2");
  });

  it("empty-filter group short-circuits to keep every row (any branch)", () => {
    // group.type 'any' with filters: [] -> filters.length === 0 -> true for all.
    const result = run([{ type: "any", filters: [] }]);
    expect(result.kept).toBe("3");
  });

  it("missing-column filter passes through (col not found -> true)", () => {
    // 'all' group whose only filter targets a column absent from cols: the
    // dispatcher's `col ? ... : true` keeps every row (fail-open, ADR 0034).
    const result = run([
      {
        type: "all",
        filters: [{ field: "nonexistent", fn: "is", value: "zzz", fType: "" }],
      },
    ]);
    expect(result.kept).toBe("3");
  });

  it("a zero-length filters array (no groups) skips filtering entirely", () => {
    // fieldValue.filters.length === 0 -> rowsForAggregate never enters the filter
    // block, so the full row set is aggregated.
    const result = run([]);
    expect(result.kept).toBe("3");
  });

  it("ref-based aggregate resolves filter cols via the relation's space (IIFE branch)", () => {
    // When the aggregate is ref-based (not schema, not $items), rowsForAggregate's
    // filter block resolves `cols` through an IIFE: refField -> refField.space ->
    // contextsMap.get(space).contextTable.cols. This drives that previously-
    // uncovered cols-resolution path and the filter then narrows the related rows.
    const tasks = contextWith({
      contextTable: {
        rows: [
          { [PathPropertyName]: "Tasks/t1.md", points: "1", status: "open" },
          { [PathPropertyName]: "Tasks/t2.md", points: "9", status: "done" },
          { [PathPropertyName]: "Tasks/t3.md", points: "4", status: "open" },
        ],
        cols: [
          { name: "points", type: "number" } as SpaceProperty,
          { name: "status", type: "text" } as SpaceProperty,
        ],
      },
    });
    const contextsMap = new Map<string, ContextState>([["Tasks", tasks]]);
    const row = {
      [PathPropertyName]: "Home/A.md",
      rel: serializeMultiString(["Tasks/t1.md", "Tasks/t2.md", "Tasks/t3.md"]),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Tasks", { path: "Tasks", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      row,
      [
        relationField("rel", { space: "Tasks", field: "project" }),
        aggregateField("openSum", {
          ref: "rel",
          field: "points",
          fn: "sum",
          // Keep only status == 'open' rows: t1 (1) + t3 (4) = 5.
          filters: [
            { type: "all", filters: [{ field: "status", fn: "is", value: "open", fType: "" }] },
          ],
        }),
      ],
      path,
      emptySettings
    );
    expect(result.openSum).toBe("5");
  });
});

// ---------------------------------------------------------------------------
// (E3) aggregateFields — fieldCol resolution fallbacks + space resolvePath +
//      calculateAggregate result placement.
// ---------------------------------------------------------------------------
describe("linkContextRow › aggregateFields column resolution", () => {
  const path = { path: "Home", type: "space" } as PathState;

  it("uses the resolved schema column TYPE: a flex col unwraps flex-envelope cells before aggregating", () => {
    // fieldCol comes from contextsMap.get(space).mdb[schema].cols. Resolving a
    // col whose type is 'flex' triggers calculateAggregate's flex branch, which
    // parseFlexValue-unwraps each cell's {value} before summing. If the resolved
    // col were ignored (synthetic text fallback), the raw JSON strings would
    // parseFloat to NaN and the sum would be 0 — so a correct 7 PROVES the
    // mdb[schema].cols col.type drove the calculation.
    const flexCell = (v: string) => JSON.stringify({ type: "number", value: v, config: {} });
    const contextsMap = new Map<string, ContextState>([
      [
        "Other",
        contextWith({
          mdb: {
            log: {
              rows: [{ amt: flexCell("3") }, { amt: flexCell("4") }],
              cols: [{ name: "amt", type: "flex", value: "" } as SpaceProperty],
            },
          },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Other", { path: "Other", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("total", { space: "Other", schema: "log", field: "amt", fn: "sum" })],
      path,
      emptySettings
    );
    expect(result.total).toBe("7");
  });

  it("synthesizes a text column when the field's col definition is absent", () => {
    // No cols on the schema -> fieldCol is null -> fallback { type: 'text' }.
    // 'values' fn (any/none) then joins the distinct cell values as text.
    const contextsMap = new Map<string, ContextState>([
      [
        "Other",
        contextWith({
          mdb: { tags: { rows: [{ label: "a" }, { label: "b" }, { label: "a" }] } },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Other", { path: "Other", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("labels", { space: "Other", schema: "tags", field: "label", fn: "values" })],
      path,
      emptySettings
    );
    // 'values' uniq-joins -> "a, b".
    expect(result.labels).toBe("a, b");
  });

  it("resolves a relative './' space path before reading the foreign context", () => {
    // fieldValue.space './Sub' resolves against path.path 'Home' (a space) to
    // 'Home/Sub', so the aggregate reads contextsMap.get('Home/Sub').mdb[...].
    // Registering the rows ONLY under the RESOLVED key proves the resolvePath
    // call on the aggregate's space ran (a raw './Sub' lookup would miss -> 0).
    const contextsMap = new Map<string, ContextState>([
      [
        "Home/Sub",
        contextWith({
          mdb: {
            kids: {
              rows: [{ n: "10" }, { n: "20" }],
              cols: [{ name: "n", type: "number" } as SpaceProperty],
            },
          },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Home", { path: "Home", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("sum", { space: "./Sub", schema: "kids", field: "n", fn: "sum" })],
      path,
      emptySettings
    );
    expect(result.sum).toBe("30");
  });

  it("places null in the output when the aggregate fn is unknown", () => {
    // calculateAggregate returns null for an unregistered fn; aggregateFields
    // still writes the key (only rowsForAggregate's null short-circuits).
    const contextsMap = new Map<string, ContextState>([
      [
        "Other",
        contextWith({
          mdb: {
            tasks: {
              rows: [{ v: "1" }],
              cols: [{ name: "v", type: "number" } as SpaceProperty],
            },
          },
        }),
      ],
    ]);
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Other", { path: "Other", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      [aggregateField("weird", { space: "Other", schema: "tasks", field: "v", fn: "notAFunction" })],
      path,
      emptySettings
    );
    expect(result).toHaveProperty("weird");
    expect(result.weird).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (E4) flexFields — fileprop & aggregate type branches and the
//      {type,value,config} JSON envelope.
// ---------------------------------------------------------------------------
describe("linkContextRow › flexFields", () => {
  const path = { path: "Home", type: "space" } as PathState;

  it("fileprop flex: runs the formula in config.value and wraps {type,value,config}", () => {
    const runContext = makeRunContext();
    const row = {
      [PathPropertyName]: "Home/A.md",
      // A flex cell whose stored JSON declares a fileprop computing prop('a')+prop('b').
      total: JSON.stringify({
        type: "fileprop",
        value: "",
        config: { value: "prop('a') + prop('b')" },
      }),
      a: "2",
      b: "3",
    };
    const result = linkContextRow(
      runContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      row,
      [
        { name: "a", type: "number", value: "" } as SpaceProperty,
        { name: "b", type: "number", value: "" } as SpaceProperty,
        flexField("total"),
      ],
      path,
      emptySettings
    );
    const parsed = JSON.parse(result.total as string);
    expect(parsed.type).toBe("fileprop");
    // 2 + 3 computed by the real mathjs engine -> "5".
    expect(parsed.value).toBe("5");
    expect(parsed.config).toEqual({ value: "prop('a') + prop('b')" });
  });

  it("aggregate flex: computes via rowsForAggregate and wraps the envelope", () => {
    const contextsMap = new Map<string, ContextState>([
      [
        "Other",
        contextWith({
          mdb: {
            tasks: {
              rows: [{ pts: "4" }, { pts: "6" }],
              cols: [{ name: "pts", type: "number" } as SpaceProperty],
            },
          },
        }),
      ],
    ]);
    const row = {
      [PathPropertyName]: "Home/A.md",
      agg: JSON.stringify({
        type: "aggregate",
        value: "",
        config: { space: "Other", schema: "tasks", field: "pts", fn: "sum" },
      }),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Other", { path: "Other", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      row,
      [flexField("agg")],
      path,
      emptySettings
    );
    const parsed = JSON.parse(result.agg as string);
    expect(parsed.type).toBe("aggregate");
    expect(parsed.value).toBe("10");
    expect(parsed.config.fn).toBe("sum");
  });

  it("aggregate flex whose rowsForAggregate returns null is NOT recomputed — the raw _row value survives", () => {
    // CHARACTERIZATION (regression lock): config.ref names no field ->
    // rowsForAggregate returns null -> the flexFields reduce hits `if (!values)
    // return p`, so it never writes `agg`. But linkContextRow's final merge spreads
    // `..._row` FIRST, so the ORIGINAL raw flex JSON in _row.agg survives untouched
    // in the output. The contract is therefore "left as-is", not "dropped" and not
    // "recomputed to blank" — pin the exact passthrough so a refactor that starts
    // emitting a recomputed/blank envelope here is caught.
    const rawAgg = JSON.stringify({
      type: "aggregate",
      value: "",
      config: { ref: "missing", field: "x", fn: "sum" },
    });
    const row = { [PathPropertyName]: "Home/A.md", agg: rawAgg };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      row,
      [flexField("agg")],
      path,
      emptySettings
    );
    // Identical to the input — flexFields did not overwrite it.
    expect(result.agg).toBe(rawAgg);
  });

  it("aggregate flex via $items resolves fieldCol from the row's own contextTable cols", () => {
    // Drives the flex-branch fieldCol resolution for ref=='$items' (the col is
    // read from contextsMap.get(_row[File]).contextTable.cols). A flex col there
    // means calculateAggregate unwraps the flex cells before summing -> 7 proves
    // BOTH the $items rows path AND the $items col-type resolution ran.
    const flexCell = (v: string) => JSON.stringify({ type: "number", value: v, config: {} });
    const contextsMap = new Map<string, ContextState>([
      [
        "Home/A.md",
        contextWith({
          contextTable: {
            rows: [{ amt: flexCell("3") }, { amt: flexCell("4") }],
            cols: [{ name: "amt", type: "flex", value: "" } as SpaceProperty],
          },
        }),
      ],
    ]);
    const row = {
      [PathPropertyName]: "Home/A.md",
      agg: JSON.stringify({
        type: "aggregate",
        value: "",
        config: { ref: "$items", field: "amt", fn: "sum" },
      }),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      contextsMap,
      new IndexMap(),
      row,
      [flexField("agg")],
      path,
      emptySettings
    );
    expect(JSON.parse(result.agg as string).value).toBe("7");
  });

  it("aggregate flex via a ref relation resolves fieldCol from the related space cols", () => {
    // Drives the flex-branch ref-based fieldCol resolution: refField -> its
    // space -> contextsMap.get(space).contextTable.cols. A flex col there means
    // the summed cells are unwrapped first -> 5 proves the ref col-type path ran.
    const flexCell = (v: string) => JSON.stringify({ type: "number", value: v, config: {} });
    const tasks = contextWith({
      contextTable: {
        rows: [
          { [PathPropertyName]: "Tasks/t1.md", pts: flexCell("2") },
          { [PathPropertyName]: "Tasks/t2.md", pts: flexCell("3") },
        ],
        cols: [{ name: "pts", type: "flex", value: "" } as SpaceProperty],
      },
    });
    const contextsMap = new Map<string, ContextState>([["Tasks", tasks]]);
    const row = {
      [PathPropertyName]: "Home/A.md",
      rel: serializeMultiString(["Tasks/t1.md", "Tasks/t2.md"]),
      agg: JSON.stringify({
        type: "aggregate",
        value: "",
        config: { ref: "rel", field: "pts", fn: "sum" },
      }),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>([["Tasks", { path: "Tasks", type: "space" } as PathState]]),
      contextsMap,
      new IndexMap(),
      row,
      [relationField("rel", { space: "Tasks", field: "project" }), flexField("agg")],
      path,
      emptySettings
    );
    expect(JSON.parse(result.agg as string).value).toBe("5");
  });

  it("aggregate flex with no resolvable col falls back to a synthetic text col", () => {
    // No cols on the $items contextTable -> flex-branch fieldCol stays null ->
    // synthetic { type: 'text' } fallback. The 'values' fn then text-joins the
    // distinct cells, proving the text fallback (not a numeric pipeline) ran.
    const contextsMap = new Map<string, ContextState>([
      [
        "Home/A.md",
        contextWith({
          contextTable: { rows: [{ tag: "x" }, { tag: "y" }, { tag: "x" }] },
        }),
      ],
    ]);
    const row = {
      [PathPropertyName]: "Home/A.md",
      agg: JSON.stringify({
        type: "aggregate",
        value: "",
        config: { ref: "$items", field: "tag", fn: "values" },
      }),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      contextsMap,
      new IndexMap(),
      row,
      [flexField("agg")],
      path,
      emptySettings
    );
    expect(JSON.parse(result.agg as string).value).toBe("x, y");
  });

  it("a non-computed flex type passes its raw value through the envelope unchanged", () => {
    // type 'text' hits neither the fileprop nor aggregate branch: value is the
    // stored flex value verbatim, re-wrapped as {type,value,config}.
    const row = {
      [PathPropertyName]: "Home/A.md",
      note: JSON.stringify({ type: "text", value: "hello", config: { format: "x" } }),
    };
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      row,
      [flexField("note")],
      path,
      emptySettings
    );
    const parsed = JSON.parse(result.note as string);
    expect(parsed).toEqual({ type: "text", value: "hello", config: { format: "x" } });
  });
});

// ---------------------------------------------------------------------------
// (E5) formulaFields — dependency ordering + fileprop-only filter, and the
//      visibility of relation/aggregate/flex outputs inside the formula scope.
// ---------------------------------------------------------------------------
describe("linkContextRow › formulaFields", () => {
  const path = { path: "Home", type: "space" } as PathState;

  it("computes a fileprop that reads a relation value materialized earlier", () => {
    // The formula reads prop('rel') — the relationFields output — proving the
    // formula scope is fed {..._row, ...relationFields, ...aggregateFields,
    // ...flexFields, ...p}. count(...) over the multi-string list.
    const runContext = makeRunContext();
    const tasks = contextWith({
      contextTable: {
        rows: [
          { [PathPropertyName]: "Tasks/t1.md", project: serializeMultiString(["Home/A.md"]) },
          { [PathPropertyName]: "Tasks/t2.md", project: serializeMultiString(["Home/A.md"]) },
        ],
      },
    });
    const contextsMap = new Map<string, ContextState>([["Tasks", tasks]]);
    const paths = new Map<string, PathState>([
      ["Home", { path: "Home", type: "space" } as PathState],
      ["Home/A.md", { path: "Home/A.md", type: "path" } as PathState],
    ]);
    const fields = [
      relationField("rel", { space: "Tasks", field: "project" }),
      fileprop("relCount", "length(prop('rel'))"),
    ];
    const result = linkContextRow(
      runContext,
      paths,
      contextsMap,
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      fields,
      path,
      emptySettings
    );
    // Both tasks link back -> rel has 2 entries -> length 2.
    expect(result.relCount).toBe("2");
  });

  it("evaluates dependent fileprops in propertyDependencies order (base before derived)", () => {
    // derived = prop('base') * 2 ; base = 21. propertyDependencies must place
    // base before derived so prop('base') is in scope when derived evaluates.
    const runContext = makeRunContext();
    const fields = [
      fileprop("derived", "prop('base') * 2"),
      fileprop("base", "21"),
    ];
    const result = linkContextRow(
      runContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      fields,
      path,
      emptySettings
    );
    expect(result.base).toBe("21");
    expect(result.derived).toBe("42");
  });

  it("ignores non-fileprop fields in the formula pass (fileprop-only filter)", () => {
    // A 'text' field is not a fileprop, so formulaFields never touches it; its
    // raw _row value is returned untouched in the merged output.
    const result = linkContextRow(
      noopRunContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md", plain: "verbatim" },
      [{ name: "plain", type: "text", value: "" } as SpaceProperty],
      path,
      emptySettings
    );
    expect(result.plain).toBe("verbatim");
  });

  it("honors a caller-supplied dependencies order, bypassing propertyDependencies", () => {
    // linkContextRow's optional `dependencies` arg replaces the computed order.
    // Supplying only ['solo'] means only that fileprop is evaluated.
    const runContext = makeRunContext();
    const fields = [
      fileprop("solo", "7 * 6"),
      fileprop("skipped", "1 + 1"),
    ];
    const result = linkContextRow(
      runContext,
      new Map<string, PathState>(),
      new Map<string, ContextState>(),
      new IndexMap(),
      { [PathPropertyName]: "Home/A.md" },
      fields,
      path,
      emptySettings,
      ["solo"]
    );
    expect(result.solo).toBe("42");
    // 'skipped' was not in the dependency list, so formulaFields never computed
    // it — it is absent from the formula output (its only presence would be a
    // raw _row value, which we never set).
    expect(result.skipped).toBeUndefined();
  });
});
