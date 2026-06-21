import {
  makeRowMatchesFilters,
  RowMatchesSpaceManager,
} from "core/utils/contexts/predicate/rowMatchesFilters";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { Filter } from "shared/types/predicate";

// A fake spaceManager exposing only the structural getPathState slice the
// matcher needs (Notidian-iguu). Records the paths it was asked for so a test
// can assert the tags-synthesis shim actually routed through it.
const fakeSpaceManager = (
  states: Record<string, { tags?: string[] } | null | undefined> = {}
): RowMatchesSpaceManager & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    getPathState: (path: string) => {
      asked.push(path);
      return states[path];
    },
  };
};

const col = (over: Partial<SpaceTableColumn>): SpaceTableColumn => ({
  name: "title",
  schemaId: "files",
  type: "text",
  table: "",
  ...over,
});

describe("makeRowMatchesFilters", () => {
  // (a) The ORIGINAL crash scenario (6ba6f3d / 5ond.5): no filters -> always
  // true, regardless of a null/undefined spaceCache.properties. The hoisted
  // reduce closed over spaceCache?.properties; a null cache took down the whole
  // context render. This must NEVER throw and must keep every row visible.
  it("no filters -> always true with null spaceProperties (original crash)", () => {
    const cases: (null | undefined)[] = [null, undefined];
    for (const properties of cases) {
      const match = makeRowMatchesFilters({
        filters: [],
        cols: [col({})],
        spaceManager: fakeSpaceManager(),
        properties,
      });
      expect(() => match({ [PathPropertyName]: "a.md", title: "X" })).not.toThrow();
      expect(match({ [PathPropertyName]: "a.md", title: "X" })).toBe(true);
    }
  });

  it("nullish filters list (null / undefined) -> always true, no throw", () => {
    const cases: (null | undefined)[] = [null, undefined];
    for (const filters of cases) {
      const match = makeRowMatchesFilters({
        filters,
        cols: [col({})],
        spaceManager: fakeSpaceManager(),
        properties: null,
      });
      expect(() => match({ [PathPropertyName]: "a.md" })).not.toThrow();
      expect(match({ [PathPropertyName]: "a.md" })).toBe(true);
    }
  });

  // (b) A property-typed filter with a null/undefined properties cache must NOT
  // throw (pairs with the az2p sink fix: fail-open per ADR 0034). This is the
  // exact crash class the bead locks at the integration seam.
  it("property-typed filter + null/undefined properties -> no throw", () => {
    const cols = [col({ name: "status", table: "" })];
    const filter: Filter = {
      field: "status",
      fn: "is",
      // For a property-fType filter the value is resolved from `properties`.
      value: "someProp",
      fType: "property",
    };
    const cases: (null | undefined)[] = [null, undefined];
    for (const properties of cases) {
      const match = makeRowMatchesFilters({
        filters: [filter],
        cols,
        spaceManager: fakeSpaceManager(),
        properties,
      });
      const row: DBRow = { [PathPropertyName]: "a.md", status: "anything" };
      expect(() => match(row)).not.toThrow();
      // fail-open: the property value resolves to undefined, stringEqual against
      // a present cell is false -> the row is NOT matched, but the render never
      // crashes. (The point of the bead is "no throw", not a particular verdict.)
      expect(match(row)).toBe(false);
    }
  });

  // (c) The tags-synthesis shim: when a "tags" column off the primary files
  // schema is present, the matcher projects the row's live tags (from
  // getPathState) onto the synthesized field so a tags filter can match.
  it("tags-synthesis shim resolves a tags column via getPathState", () => {
    // The shim writes the synthesized value at row[row.name]; the column and the
    // filter.field both key off that same name so the projected value is read.
    const cols = [
      col({ name: "tags", schemaId: defaultContextSchemaID, type: "tags-multi", table: "" }),
    ];
    const filter: Filter = {
      field: "tags",
      fn: "isAnyInList",
      value: "blue",
      fType: "",
    };
    const sm = fakeSpaceManager({ "note.md": { tags: ["red", "blue"] } });
    const match = makeRowMatchesFilters({
      filters: [filter],
      cols,
      spaceManager: sm,
      properties: {},
    });
    // The row's `name` is "tags" so the shim synthesizes row.tags from path
    // state; getPathState("note.md").tags includes "blue" -> match.
    const row: DBRow = { [PathPropertyName]: "note.md", name: "tags" };
    expect(match(row)).toBe(true);
    expect(sm.asked).toContain("note.md");

    // A path with no overlapping tag fails to match (still routed via the shim).
    const sm2 = fakeSpaceManager({ "other.md": { tags: ["green"] } });
    const match2 = makeRowMatchesFilters({
      filters: [filter],
      cols,
      spaceManager: sm2,
      properties: {},
    });
    expect(match2({ [PathPropertyName]: "other.md", name: "tags" })).toBe(false);
    expect(sm2.asked).toContain("other.md");
  });

  it("tags shim is null-safe when getPathState returns null/undefined", () => {
    const cols = [
      col({ name: "tags", schemaId: defaultContextSchemaID, type: "tags-multi", table: "" }),
    ];
    const filter: Filter = { field: "tags", fn: "isAnyInList", value: "blue", fType: "" };
    const sm = fakeSpaceManager({ "missing.md": null });
    const match = makeRowMatchesFilters({
      filters: [filter],
      cols,
      spaceManager: sm,
      properties: {},
    });
    const row: DBRow = { [PathPropertyName]: "missing.md", name: "tags" };
    expect(() => match(row)).not.toThrow();
    // tags -> [] -> no overlap -> not matched, but no crash.
    expect(match(row)).toBe(false);
  });

  // The tags shim only fires when a tags column off the PRIMARY files schema is
  // present; otherwise the row is passed through untouched and getPathState is
  // never consulted.
  it("no tags column -> shim inert, getPathState never called", () => {
    const sm = fakeSpaceManager({ "a.md": { tags: ["x"] } });
    const match = makeRowMatchesFilters({
      filters: [{ field: "title", fn: "is", value: "Hi", fType: "" }],
      cols: [col({ name: "title", table: "" })],
      spaceManager: sm,
      properties: {},
    });
    expect(match({ [PathPropertyName]: "a.md", title: "Hi" })).toBe(true);
    expect(sm.asked).toEqual([]);
  });

  // (d) A literal filter narrows correctly: a matching row passes, a
  // non-matching row is filtered out.
  it("literal filter narrows: matching row passes, non-matching fails", () => {
    const cols = [col({ name: "title", type: "text", table: "" })];
    const filter: Filter = { field: "title", fn: "is", value: "Keep", fType: "" };
    const match = makeRowMatchesFilters({
      filters: [filter],
      cols,
      spaceManager: fakeSpaceManager(),
      properties: null,
    });
    expect(match({ [PathPropertyName]: "k.md", title: "Keep" })).toBe(true);
    expect(match({ [PathPropertyName]: "d.md", title: "Drop" })).toBe(false);
  });

  // Multiple filters AND together (the reduce short-circuits to false on the
  // first miss) — the conjunction the inlined reduce produced.
  it("multiple filters AND together", () => {
    const cols = [
      col({ name: "title", type: "text", table: "" }),
      col({ name: "status", type: "text", table: "" }),
    ];
    const filters: Filter[] = [
      { field: "title", fn: "is", value: "Keep", fType: "" },
      { field: "status", fn: "is", value: "open", fType: "" },
    ];
    const match = makeRowMatchesFilters({
      filters,
      cols,
      spaceManager: fakeSpaceManager(),
      properties: null,
    });
    expect(match({ [PathPropertyName]: "1.md", title: "Keep", status: "open" })).toBe(true);
    expect(match({ [PathPropertyName]: "2.md", title: "Keep", status: "closed" })).toBe(false);
  });

  // A filter whose column does not exist fails open (filterReturnForCol's
  // `if (!col) return true` guard) — a stale predicate field never crashes.
  it("filter referencing an unknown column fails open (true)", () => {
    const match = makeRowMatchesFilters({
      filters: [{ field: "ghost", fn: "is", value: "x", fType: "" }],
      cols: [col({ name: "title", table: "" })],
      spaceManager: fakeSpaceManager(),
      properties: null,
    });
    expect(match({ [PathPropertyName]: "a.md", title: "anything" })).toBe(true);
  });
});
